import crypto from "node:crypto";

// In-memory session store. Fine for a single-instance homelab deployment.
// If this ever needs to survive restarts or run across replicas, swap this
// module for a small file-backed or Redis-backed store — the interface
// below (get/create/touch) is the only thing callers depend on.

const sessions = new Map();
const SESSION_COOKIE = "seraph_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function makeReceiverId() {
  const n = 100000 + Math.floor(Math.random() * 899999);
  return `R-${n}`;
}

function createSession() {
  const id = crypto.randomUUID();
  const session = {
    id,
    receiverId: makeReceiverId(),
    firstContact: new Date().toISOString(),
    unlocked: { incident: false, personnel: false, audio: false, restricted: false },
    attempts: [], // timestamps, for rate limiting
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const id = cookies[SESSION_COOKIE];
  if (id && sessions.has(id)) {
    const s = sessions.get(id);
    s.lastSeen = Date.now();
    return s;
  }
  return null;
}

function getOrCreateSession(req, res) {
  let session = getSession(req);
  if (!session) {
    session = createSession();
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    );
  }
  return session;
}

function parseCookies(header) {
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

// Periodic cleanup of stale sessions so the Map doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id);
  }
}, 1000 * 60 * 60).unref();

export { getOrCreateSession, getSession, SESSION_COOKIE };
