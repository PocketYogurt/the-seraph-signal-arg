import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSolutions } from "./contentStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, "..", "secret-media");

// mediaId -> folder name on disk under secret-media/. Each folder holds
// video.mp4, captions.vtt, and transcript.txt (the transcript is the
// text-accessible alternative required by the blueprint for every audio
// or video-only clue — it must be reachable without playing the video).
const MEDIA_ITEMS = {
  secret_vale_recovery: {},
  secret_archive_minus_one: {},
  secret_floor_zero_override: {},
  secret_transmission_zero: {},
};

function canStream(mediaId, session) {
  const rules = getSolutions().stream_access_rules || {};
  const rule = rules[mediaId];
  if (!rule) return false;
  return (rule.requires || []).every((key) => session.unlocked[key]);
}

function streamFile(req, res, filePath, mime) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("RECORD NOT YET RESTORED TO ARCHIVE.");
    return;
  }

  const stat = fs.statSync(filePath);
  const commonHeaders = {
    "Content-Type": mime,
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
    // Deliberately no Content-Disposition: attachment — this keeps it a
    // stream, not a save-target, in browsers that respect the header.
    "X-Content-Type-Options": "nosniff",
  };

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { ...commonHeaders, "Content-Length": stat.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

  res.writeHead(206, {
    ...commonHeaders,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Content-Length": end - start + 1,
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

function handleStream(req, res, mediaId, session) {
  if (!MEDIA_ITEMS[mediaId]) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("RECORD NOT FOUND.");
    return;
  }
  if (!canStream(mediaId, session)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("ACCESS DENIED // RECORD NOT YET RESTORED.");
    return;
  }
  streamFile(req, res, path.join(MEDIA_DIR, mediaId, "video.mp4"), "video/mp4");
}

function handleCaptions(req, res, mediaId, session) {
  if (!MEDIA_ITEMS[mediaId]) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("RECORD NOT FOUND.");
    return;
  }
  if (!canStream(mediaId, session)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("");
    return;
  }
  streamFile(req, res, path.join(MEDIA_DIR, mediaId, "captions.vtt"), "text/vtt");
}

function handleTranscript(req, res, mediaId, session) {
  if (!MEDIA_ITEMS[mediaId]) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "Record not found." }));
    return;
  }
  if (!canStream(mediaId, session)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "RECORD NOT YET RESTORED." }));
    return;
  }
  const transcriptPath = path.join(MEDIA_DIR, mediaId, "transcript.txt");
  if (!fs.existsSync(transcriptPath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "No transcript available." }));
    return;
  }
  const text = fs.readFileSync(transcriptPath, "utf-8");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, transcript: text.trim() }));
}

export { handleStream, handleCaptions, handleTranscript };
