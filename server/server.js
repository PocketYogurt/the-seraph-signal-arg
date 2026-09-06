import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { getOrCreateSession, getSession } from "./lib/sessions.js";
import { checkLimit } from "./lib/rateLimiter.js";
import {
  getContent,
  setContent,
  getSolutions,
  publicTransmissions,
  publicPersonnel,
  publicIncidents,
  publicAudio,
  PUBLIC_TYPES,
} from "./lib/contentStore.js";
import { verifyCode } from "./lib/puzzleEngine.js";
import { handleStream, handleCaptions, handleTranscript } from "./lib/streamHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ADMIN_DIR = path.join(__dirname, "..", "admin");
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.SERAPH_ADMIN_PASSWORD || null;
const ADMIN_COOKIE = "seraph_admin";
const adminTokens = new Set();

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAdminAuthed(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return Boolean(cookies[ADMIN_COOKIE] && adminTokens.has(cookies[ADMIN_COOKIE]));
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function serveStatic(req, res, rootDir, urlPath) {
  let filePath = path.join(rootDir, decodeURIComponent(urlPath));
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA-style fallback for the frontend so client-side routing (if any)
      // and direct deep-links to pages both resolve.
      if (rootDir === PUBLIC_DIR) {
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, data) => {
          if (e2) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.writeHead(200, { "Content-Type": STATIC_MIME[".html"] });
          res.end(data);
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": STATIC_MIME[ext] || "application/octet-stream",
      // Always revalidate — this is a small homelab deployment, not a CDN
      // scenario, and stale cached JS/CSS after a deploy causes more
      // confusion ("it still does the old thing") than the perf cost of
      // skipping long-lived caching is worth.
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // ---- Public content API ----
    if (p === "/api/state" && req.method === "GET") {
      const session = getOrCreateSession(req, res);
      return send(res, 200, {
        receiverId: session.receiverId,
        firstContact: session.firstContact,
        unlocked: session.unlocked,
      });
    }

    if (p === "/api/reset" && req.method === "POST") {
      const session = getOrCreateSession(req, res);
      session.unlocked = { incident: false, personnel: false, audio: false, restricted: false };
      return send(res, 200, { ok: true });
    }

    if (p === "/api/transmissions" && req.method === "GET") {
      const session = getOrCreateSession(req, res);
      return send(res, 200, publicTransmissions(session));
    }

    if (p === "/api/personnel" && req.method === "GET") {
      const session = getOrCreateSession(req, res);
      return send(res, 200, publicPersonnel(session));
    }

    if (p === "/api/incidents" && req.method === "GET") {
      const session = getOrCreateSession(req, res);
      return send(res, 200, publicIncidents(session));
    }

    if (p === "/api/audio" && req.method === "GET") {
      const session = getOrCreateSession(req, res);
      return send(res, 200, publicAudio(session));
    }

    if (p === "/api/puzzles" && req.method === "GET") {
      return send(res, 200, getContent("puzzles"));
    }

    // Text-accessible alternative for audio-manipulation puzzle steps. Only
    // returns the true transcript once the same unlock_requires gate the
    // audio record itself has already been satisfied — so it is an
    // accessible *alternative* to reversing the audio, not a shortcut past
    // the puzzle prerequisites.
    if (p.startsWith("/api/audio/") && p.endsWith("/decode") && req.method === "GET") {
      const session = getOrCreateSession(req, res);
      const audioId = p.replace("/api/audio/", "").replace("/decode", "");
      const audioRecord = getContent("audio").find((a) => a.id === audioId);
      if (!audioRecord) return send(res, 404, { success: false, message: "Record not found." });
      const requires = audioRecord.unlock_requires || [];
      const unlocked = requires.every((key) => session.unlocked[key]);
      if (!unlocked) {
        return send(res, 403, { success: false, message: "RECORD NOT YET RESTORED." });
      }
      const transcripts = getSolutions().true_transcripts || {};
      const transcript = transcripts[audioId];
      if (!transcript) return send(res, 404, { success: false, message: "No decoded transcript available." });
      return send(res, 200, { success: true, transcript });
    }

    if (p === "/api/verify" && req.method === "POST") {
      const session = getOrCreateSession(req, res);
      const ip = clientIp(req);
      const limit = checkLimit(`verify:${session.id}:${ip}`, { windowMs: 60_000, max: 15 });
      if (!limit.allowed) {
        return send(res, 429, {
          success: false,
          message: "TOO MANY ATTEMPTS // WAIT BEFORE RETRYING.",
          retryAfterMs: limit.retryAfterMs,
        });
      }
      const body = await readBody(req);
      const result = verifyCode(body.code, session);
      return send(res, 200, result);
    }

    // ---- Secret media streaming ----
    if (p.startsWith("/api/stream/") && (req.method === "GET" || req.method === "HEAD")) {
      const session = getOrCreateSession(req, res);
      const ip = clientIp(req);
      const limit = checkLimit(`stream:${session.id}:${ip}`, { windowMs: 60_000, max: 30 });
      if (!limit.allowed) {
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end("TOO MANY REQUESTS.");
        return;
      }

      if (p.endsWith("/captions.vtt")) {
        const mediaId = p.replace("/api/stream/", "").replace("/captions.vtt", "");
        return handleCaptions(req, res, mediaId, session);
      }
      if (p.endsWith("/transcript")) {
        const mediaId = p.replace("/api/stream/", "").replace("/transcript", "");
        return handleTranscript(req, res, mediaId, session);
      }

      const mediaId = p.replace("/api/stream/", "");
      return handleStream(req, res, mediaId, session);
    }

    // ---- Admin API ----
    if (p === "/api/admin/login" && req.method === "POST") {
      const ip = clientIp(req);
      const limit = checkLimit(`admin-login:${ip}`, { windowMs: 60_000, max: 5 });
      if (!limit.allowed) {
        return send(res, 429, { success: false, message: "Too many attempts." });
      }
      if (!ADMIN_PASSWORD) {
        return send(res, 500, { success: false, message: "Admin password not configured on server." });
      }
      const body = await readBody(req);
      if (body.password !== ADMIN_PASSWORD) {
        return send(res, 401, { success: false, message: "Incorrect password." });
      }
      const token = crypto.randomUUID();
      adminTokens.add(token);
      res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
      return send(res, 200, { success: true });
    }

    if (p.startsWith("/api/admin/content/")) {
      if (!isAdminAuthed(req)) {
        return send(res, 401, { success: false, message: "Not authenticated." });
      }
      const type = p.replace("/api/admin/content/", "");
      if (!PUBLIC_TYPES.includes(type)) {
        return send(res, 400, { success: false, message: "Unknown content type." });
      }
      if (req.method === "GET") {
        return send(res, 200, getContent(type));
      }
      if (req.method === "PUT") {
        const body = await readBody(req);
        if (!Array.isArray(body) && typeof body !== "object") {
          return send(res, 400, { success: false, message: "Invalid content payload." });
        }
        setContent(type, body);
        return send(res, 200, { success: true });
      }
    }

    // ---- Admin static UI ----
    if (p === "/admin" || p.startsWith("/admin/")) {
      const rel = p === "/admin" ? "/index.html" : p.replace("/admin", "");
      return serveStatic(req, res, ADMIN_DIR, rel || "/index.html");
    }

    // ---- Frontend static files ----
    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, PUBLIC_DIR, p);
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    console.error(err);
    send(res, 500, { success: false, message: "Internal error." });
  }
});

server.listen(PORT, () => {
  console.log(`The Seraph Signal server listening on :${PORT}`);
  if (!ADMIN_PASSWORD) {
    console.warn("SERAPH_ADMIN_PASSWORD is not set — the admin panel will refuse logins until it is.");
  }
});
