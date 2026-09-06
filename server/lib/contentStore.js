import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "..", "content");
const PRIVATE_DIR = path.join(__dirname, "..", "private");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// Public content types the admin UI and frontend are allowed to read/write.
// "solutions" deliberately does not appear here.
const PUBLIC_TYPES = ["transmissions", "personnel", "incidents", "audio", "puzzles", "canon"];

function contentPath(type) {
  if (!PUBLIC_TYPES.includes(type)) throw new Error(`Unknown or restricted content type: ${type}`);
  return path.join(CONTENT_DIR, `${type}.json`);
}

function getContent(type) {
  return readJson(contentPath(type));
}

function setContent(type, data) {
  writeJson(contentPath(type), data);
}

function getSolutions() {
  return readJson(path.join(PRIVATE_DIR, "solutions.json"));
}

// Returns a record's public-safe view: hides hosted_media_id resolution and
// any body/attachment content that requires an unlock the session doesn't have.
function isUnlocked(record, session) {
  const requires = record.unlock_requires || [];
  return requires.every((key) => session.unlocked[key]);
}

function publicTransmissions(session) {
  return getContent("transmissions")
    .filter((t) => t.publish_state === "published")
    .map((t) => {
      const unlocked = isUnlocked(t, session);
      const base = {
        id: t.id,
        number: t.number,
        section: t.section,
        title: unlocked || t.media_type === "public_tiktok" ? t.title : "[LOCKED RECORD]",
        arc: t.arc,
        recovery_state: t.recovery_state,
        signal_condition: t.signal_condition,
        classification: t.classification,
        media_type: t.media_type,
        teaser: t.teaser,
        locked: t.media_type === "secret_hosted" ? !unlocked : false,
      };
      if (t.media_type === "public_tiktok") {
        base.release_status = t.release_status; // "produced" | "planned"
        base.tiktok_url = t.tiktok_url;
        base.external_fallback_label = t.external_fallback_label;
        // Three states per the client's public-links spec:
        // planned -> not yet recovered; produced+no url -> link pending;
        // produced+url -> playable.
        if (t.release_status === "planned") {
          base.public_state = "not_yet_recovered";
        } else if (!t.tiktok_url) {
          base.public_state = "link_pending";
        } else {
          base.public_state = "playable";
        }
      }
      if (t.media_type === "secret_hosted" && unlocked) {
        // Client gets stream/caption/transcript *endpoints*, never a raw file path.
        base.stream_endpoint = `/api/stream/${t.hosted_media_id}`;
        base.captions_endpoint = `/api/stream/${t.hosted_media_id}/captions.vtt`;
        base.transcript_endpoint = `/api/stream/${t.hosted_media_id}/transcript`;
      }
      return base;
    });
}

function publicPersonnel(session) {
  return getContent("personnel")
    .filter((p) => p.publish_state === "published")
    .map((p) => {
      const unlocked = isUnlocked(p, session);
      if (!unlocked) {
        return { id: p.id, name: "[LOCKED RECORD]", locked: true };
      }
      const { unlock_requires, ...rest } = p;
      return { ...rest, locked: false };
    });
}

function publicIncidents(session) {
  return getContent("incidents")
    .filter((i) => i.publish_state === "published")
    .map((i) => {
      const unlocked = isUnlocked(i, session);
      if (!unlocked) {
        return { id: i.id, title: "[LOCKED RECORD]", locked: true };
      }
      const { unlock_requires, puzzle_note, ...rest } = i;
      // puzzle_note is a dev-facing annotation, never sent to the client.
      return { ...rest, locked: false };
    });
}

function publicAudio(session) {
  return getContent("audio")
    .filter((a) => a.publish_state === "published")
    .map((a) => {
      const unlocked = isUnlocked(a, session);
      if (!unlocked) {
        return { id: a.id, title: "[LOCKED RECORD]", locked: true };
      }
      const { unlock_requires, ...rest } = a;
      return { ...rest, locked: false };
    });
}

export {
  getContent,
  setContent,
  getSolutions,
  publicTransmissions,
  publicPersonnel,
  publicIncidents,
  publicAudio,
  PUBLIC_TYPES,
};
