const BASE = "/api";

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

export const api = {
  state: () => getJson("/state"),
  reset: () => postJson("/reset"),
  transmissions: () => getJson("/transmissions"),
  personnel: () => getJson("/personnel"),
  incidents: () => getJson("/incidents"),
  audio: () => getJson("/audio"),
  puzzles: () => getJson("/puzzles"),
  verify: (code) => postJson("/verify", { code }),
  decodeAudio: (id) => getJson(`/audio/${id}/decode`),
};
