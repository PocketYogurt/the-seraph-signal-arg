# The Seraph Signal — ARG Website

Phase-one build against `The_Seraph_Signal_ARG_Developer_Blueprint`. This is a working scaffold: the
full launch puzzle chain, content model, streaming/embed split, and admin editor are implemented and
tested. Episode art integration, final TikTok URLs, and secret media files are still placeholders —
see "What's still a placeholder" below.

## Architecture at a glance

- **Server** (`/server`): a single Node.js process, **zero external dependencies** — built entirely on
  Node's `http`, `fs`, and `crypto` core modules. No `npm install`, no lockfile, nothing to drift.
  Serves the static frontend, the public content API, puzzle verification, secret media streaming, and
  the admin API, all from one port.
- **Content** (`/server/content`): the public content model as JSON — transmissions, incidents,
  personnel, audio, puzzle hints, canon. Editable by hand or through `/admin`.
- **Private solutions** (`/server/private/solutions.json`): puzzle answers and true audio transcripts.
  **Never served to any client route.** This is the file that keeps unreleased answers out of the
  public bundle, per the blueprint's security requirement.
- **Frontend** (`/public`): vanilla HTML/CSS/JS, no build step. Fetches content from the API at
  runtime rather than hardcoding records into markup.
- **Admin** (`/admin`): a minimal password-gated JSON editor for the content types above.

This intentionally avoids a framework. Given zero content really needs client-side routing beyond a
single-page nav, and the blueprint explicitly allows "plain HTML/CSS/JavaScript," a dependency-free
server means nothing to break on `npm install`, no version drift, and one less moving part in your
Docker pipeline.

## Running it locally

```bash
cd server
SERAPH_ADMIN_PASSWORD=choose-a-password PORT=3000 node server.js
```

Visit `http://localhost:3000`. Admin editor at `http://localhost:3000/admin`.

No build step, no `npm install` — the server has no dependencies to install.

## Running it in Docker

```bash
echo "SERAPH_ADMIN_PASSWORD=choose-a-password" > .env
docker compose up --build
```

The compose file binds to `127.0.0.1:3010` by default, for Caddy to reverse-proxy — adjust the port
mapping or switch to a shared Docker network if that doesn't match how Caddy reaches your other HNM
containers. Content, private solutions, and secret media are bind-mounted so admin-panel edits and
manually dropped-in media files persist across rebuilds.

**Not yet build-tested against a real Docker daemon** — the sandbox this was built in doesn't have
Docker available. Please run `docker compose up --build` on HNM infra as your first check before
anything else.

## The puzzle chain (unchanged from the blueprint)

```
0716980217 -> VALE -> 110487 -> reverse the Vale audio (or use decode control) -> FLOORZERO
```

All five steps verified end-to-end against the live server, including normalisation (uppercase, strip
spaces/punctuation/hyphens), the `FLOOR ZERO` / `FLOORZERO` equivalence, and the Department A → B
switch on the final step. Answers live only in `server/private/solutions.json`.

## Editing content

Either edit the JSON files in `server/content/` directly, or use `/admin` (password from
`SERAPH_ADMIN_PASSWORD`). The admin editor is intentionally raw-JSON rather than a form-per-field —
faster to build, and matches the field structure already documented in `ARG_Content_Templates.md`.
Puzzle answers are **not** editable from `/admin` on purpose; edit `solutions.json` by hand so
answers never pass through a web-accessible form.

## Public vs. secret transmissions

Per the client brief: public episodes embed from TikTok inside a CRT-style frame with a required
"Open transmission externally" fallback link. Secret ARG-only transmissions are streamed directly
from `server/secret-media/`, gated by server-side session state — never a direct/static file link,
range-requests supported for seeking, no `Content-Disposition: attachment`, `controlsList="nodownload"`
on the `<video>` element. This is a deterrent, not a guarantee — nothing in-browser fully stops a
determined viewer from capturing a stream, but there's no easy "save as" path.

## What's still a placeholder

- `tiktok_url` fields in `server/content/transmissions.json` are blank for all 145 "produced" public episodes — this is intentional per the client's handoff, not a gap. As each episode goes live on TikTok, paste its share URL into that record's `tiktok_url` field (via `/admin` or directly in the JSON) and it flips from "TRANSMISSION LINK PENDING" to playable automatically. The remaining 80 records are marked `"release_status": "planned"` and show "TRANSMISSION NOT YET RECOVERED" until their `release_status` is changed to `"produced"`.
- Episode art from `03_Asset_Library/Episode_Art` still hasn't been wired into any page — no site-map section currently calls for it outside the transmission records themselves. Worth a decision on whether it becomes thumbnails on transmission records, a separate gallery, or stays unused for now.

## Secret media (resolved)

All four secret videos from the client's final media handoff are integrated, gated, and tested end-to-end:

| Unlock code | Video | Surfaces on |
|---|---|---|
| `VALE` | Vale Recovery Fragment | Personnel record (Vale) + Transmissions archive |
| `110487` | Archive Minus One | Audio Laboratory + Transmissions archive |
| `FLOORZERO` | Floor Zero Override | Level 7 + Transmissions archive |
| *(auto, after `FLOORZERO`)* | Transmission 000 | Level 7 + Transmissions archive |

Each is stored under `server/secret-media/<id>/` as `video.mp4`, `captions.vtt` (converted from the client's `.srt`), and `transcript.txt` (served via a dedicated gated endpoint as the text-accessible alternative). Gating lives in `server/private/solutions.json` under `stream_access_rules`, matching the client's `Secret_Media_Manifest.json` exactly. Verified: all four correctly return 403 before their unlock condition is met, and 200 with working range-requests immediately after.

## Known limitations, called out deliberately

- Sessions and rate-limit buckets are in-memory. Fine for a single-instance homelab deployment;
  restarting the container clears everyone's puzzle progress. If that's undesirable, this needs a
  small persistence layer (a JSON-per-session file or SQLite) — flagging as a joint decision per the
  blueprint's ownership split, since it's a scope/cost question, not just an implementation one.
- No automated test suite yet — everything above was verified manually via curl during this build
  session. Given the size of the project, I'd recommend a small smoke-test script before each deploy
  (curl the puzzle chain, check for 200s) rather than skipping verification entirely.
- The admin panel's raw-JSON editor works fine for the smaller content types (personnel, incidents,
  audio, puzzles) but is impractical for `transmissions.json` now that it holds 229 records — pasting
  a single TikTok URL means finding the right object inside a huge textarea. If pasting TikTok links
  in as episodes go live becomes a regular task, it's worth a small follow-up: a dedicated admin view
  that's just "search by transmission number, paste URL, save" rather than the full JSON blob. Happy
  to build that next if it'd help.
