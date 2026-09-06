import { api } from "./api.js";

const qs = (s, root = document) => root.querySelector(s);
const qsa = (s, root = document) => [...root.querySelectorAll(s)];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let currentState = { unlocked: {}, receiverId: "", firstContact: "" };

function playResultSound(success) {
  const el = qs(success ? "#sfx-correct" : "#sfx-incorrect");
  if (!el) return;
  el.currentTime = 0;
  el.play().catch(() => {});
}

function beep() {
  const a = qs("#ui-beep");
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

function glitch(el) {
  if (prefersReducedMotion || !el) return;
  el.classList.remove("glitch-flash");
  // Force reflow so the animation can re-trigger on repeated calls.
  void el.offsetWidth;
  el.classList.add("glitch-flash");
}

let currentPageName = "transmissions";

function showPage(name) {
  currentPageName = name;
  qsa(".page").forEach((p) => p.classList.remove("active-page"));
  qsa(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  const page = qs(`#page-${name}`);
  if (page) page.classList.add("active-page");
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  loadPage(name);
}

async function refreshState() {
  currentState = await api.state();
  qs("#receiver-id").textContent = currentState.receiverId;
  qs("#first-contact").textContent = new Date(currentState.firstContact).toLocaleString();
  const unlockedCount = Object.values(currentState.unlocked).filter(Boolean).length;
  qs("#files-unlocked").textContent = `${unlockedCount} / 4`;
  qs("#exposure").textContent = `${3 + unlockedCount * 21}%`;
  qs("#memory-state").textContent = currentState.unlocked.restricted
    ? "DUPLICATED"
    : unlockedCount >= 2
    ? "UNSTABLE"
    : "UNCONFIRMED";

  if (currentState.unlocked.restricted) {
    applyDepartmentB();
  }
}

function applyDepartmentB() {
  if (document.body.classList.contains("department-b")) return;
  document.body.classList.add("department-b");
  qs("#header-logo").src = "/assets/branding/seraph-logo-red.png";
  qs("#dept-state").textContent = "DEPARTMENT B";
  qs("#alert-bar").textContent = "ARCHIVE OWNERSHIP CONFLICT // YOU ARE VIEWING THE SECOND VERSION";
  qs("#footer-status").textContent = "CONTAINMENT WAS THE FIRST COPY.";
}

/* ---------------- Transmissions / Archive (shared) ---------------- */
let transmissionsCache = null;
const expandedByList = {}; // listId -> currently expanded transmission id, or null

async function getTransmissions() {
  if (!transmissionsCache) transmissionsCache = await api.transmissions();
  return transmissionsCache;
}

function invalidateTransmissionsCache() {
  transmissionsCache = null;
}

function renderTransmissionList(list, listId) {
  const container = qs(`#${listId}`);
  expandedByList[listId] = null;

  container.innerHTML = list
    .map((t) => {
      if (t.locked) {
        return `<article class="record locked" tabindex="0" aria-disabled="true">
          <div class="record-id">TX-${t.number}</div>
          <div><div class="record-title">${t.title}</div><div class="system-note">${t.recovery_state}</div></div>
          <div class="record-meta">${t.signal_condition}</div>
        </article>`;
      }
      if (t.media_type === "public_tiktok" && t.public_state !== "playable") {
        const metaText = t.public_state === "not_yet_recovered" ? "TRANSMISSION NOT YET RECOVERED" : "TRANSMISSION LINK PENDING";
        return `<article class="record locked" tabindex="0" aria-disabled="true">
          <div class="record-id">TX-${t.number}</div>
          <div><div class="record-title">${t.title}</div><div class="system-note">${t.arc || ""}</div></div>
          <div class="record-meta">${metaText}</div>
        </article>`;
      }
      return `<article class="record" tabindex="0" data-tx="${t.id}" aria-expanded="false">
        <div class="record-id">TX-${t.number}</div>
        <div><div class="record-title">${t.title}</div><div class="system-note">${t.recovery_state}</div></div>
        <div class="record-meta">${t.signal_condition}</div>
      </article>
      <div class="record-expand" id="expand-${listId}-${t.id}"></div>`;
    })
    .join("");

  qsa("[data-tx]", container).forEach((el) => {
    const activate = () => toggleTransmission(list.find((t) => t.id === el.dataset.tx), listId);
    el.addEventListener("click", activate);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") activate(); });
  });
}

async function loadTransmissions() {
  const all = await getTransmissions();
  renderTransmissionList(all.filter((t) => t.section !== "archive"), "transmission-list");
}

async function loadArchive() {
  const all = await getTransmissions();
  renderTransmissionList(all.filter((t) => t.section === "archive"), "archive-list");
}

function collapseExpanded(listId, attr = "data-tx") {
  const openId = expandedByList[listId];
  if (!openId) return;
  const slot = qs(`#expand-${listId}-${openId}`);
  const row = qs(`[${attr}="${openId}"]`, qs(`#${listId}`));
  if (slot) slot.innerHTML = "";
  if (row) { row.classList.remove("expanded"); row.setAttribute("aria-expanded", "false"); }
  expandedByList[listId] = null;
}

function toggleTransmission(t, listId) {
  if (!t) return;
  const alreadyOpen = expandedByList[listId] === t.id;

  // Closing whatever's currently open, whether it's this record or another —
  // only one expanded record per list at a time keeps a long archive readable.
  collapseExpanded(listId);
  if (alreadyOpen) return; // second click on the same record just closes it

  beep();
  const slot = qs(`#expand-${listId}-${t.id}`);
  const row = qs(`[data-tx="${t.id}"]`, qs(`#${listId}`));
  slot.innerHTML = renderTransmissionDetail(t);
  row.classList.add("expanded");
  row.setAttribute("aria-expanded", "true");
  expandedByList[listId] = t.id;
  wireTransmissionDetail(t, slot);
  glitch(slot);
}

function renderTransmissionDetail(t) {
  if (t.media_type === "public_tiktok") {
    return `
      <div class="record-detail">
        <h3>TX-${t.number} // ${t.title}</h3>
        <div class="crt-frame">
          <span class="crt-label">SIGNAL ACQUIRED</span>
          ${t.tiktok_url
            ? `<blockquote class="tiktok-embed" cite="${t.tiktok_url}" data-video-id="">
                 <section><a target="_blank" href="${t.tiktok_url}">View on TikTok</a></section>
               </blockquote>`
            : `<div style="color:#8FD19E;padding:16px;font-size:0.8rem;">PUBLIC EPISODE LINK NOT YET CONFIGURED FOR THIS RECORD.</div>`}
        </div>
        ${t.tiktok_url ? `<a class="external-link" href="${t.tiktok_url}" target="_blank" rel="noopener">${t.external_fallback_label || "Open transmission externally"} &rarr;</a>` : ""}
      </div>`;
  }
  if (t.media_type === "secret_hosted" && t.stream_endpoint) {
    return `
      <div class="record-detail">
        <h3>TX-${t.number} // ${t.title}</h3>
        <div class="crt-frame">
          <span class="crt-label">RESTRICTED STREAM</span>
          <video controls controlsList="nodownload" disablePictureInPicture preload="none" crossorigin="anonymous">
            <source src="${t.stream_endpoint}" />
            ${t.captions_endpoint ? `<track kind="captions" src="${t.captions_endpoint}" srclang="en" label="English" />` : ""}
          </video>
        </div>
        <p class="system-note">This record is streamed only and is not available for download. Captions are provided.</p>
        ${t.transcript_endpoint ? `<button data-show-transcript="${t.id}" style="margin-top:8px;">SHOW TEXT TRANSCRIPT</button><div class="audio-transcript" id="transcript-tx-${t.id}" style="display:none;margin-top:8px;"></div>` : ""}
      </div>`;
  }
  return "";
}

function wireTransmissionDetail(t, slot) {
  if (t.media_type === "public_tiktok" && t.tiktok_url && !document.querySelector('script[src*="tiktok.com/embed.js"]')) {
    const s = document.createElement("script");
    s.src = "https://www.tiktok.com/embed.js";
    s.async = true;
    document.body.appendChild(s);
  }
  if (t.transcript_endpoint) {
    qs(`[data-show-transcript="${t.id}"]`, slot)?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const box = qs(`#transcript-tx-${t.id}`, slot);
      if (box.style.display === "none") {
        if (!box.dataset.loaded) {
          const res = await fetch(t.transcript_endpoint, { credentials: "same-origin" });
          const data = await res.json();
          box.textContent = data.success ? data.transcript : (data.message || "Transcript unavailable.");
          box.dataset.loaded = "1";
        }
        box.style.display = "block";
      } else {
        box.style.display = "none";
      }
    });
  }
}

/* ---------------- Incidents ---------------- */
async function loadIncidents() {
  const list = await api.incidents();
  const container = qs("#incident-list");
  expandedByList["incident-list"] = null;
  container.innerHTML = list
    .map((i) => {
      if (i.locked) {
        return `<article class="record locked" tabindex="0"><div class="record-id">${i.id}</div><div class="record-title">${i.title}</div><div></div></article>`;
      }
      return `<article class="record" tabindex="0" data-incident="${i.id}" aria-expanded="false"><div class="record-id">${i.id}</div><div><div class="record-title">${i.title}</div><div class="system-note">${i.date_time}</div></div><div class="record-meta">${i.classification}</div></article>
      <div class="record-expand" id="expand-incident-list-${i.id}"></div>`;
    })
    .join("");

  qsa("[data-incident]", container).forEach((el) => {
    const activate = () => toggleIncident(list.find((i) => i.id === el.dataset.incident));
    el.addEventListener("click", activate);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") activate(); });
  });
}

function toggleIncident(record) {
  if (!record) return;
  const listId = "incident-list";
  const alreadyOpen = expandedByList[listId] === record.id;
  collapseExpanded(listId, "data-incident");
  if (alreadyOpen) return;

  beep();
  const slot = qs(`#expand-${listId}-${record.id}`);
  const row = qs(`[data-incident="${record.id}"]`, qs(`#${listId}`));
  slot.innerHTML = `
    <div class="record-detail">
      <h3>${record.id} // ${record.title}</h3>
      <div class="field-row"><span class="field-label">Date / time</span><span>${record.date_time}</span></div>
      <div class="field-row"><span class="field-label">Location</span><span>${record.location}</span></div>
      <div class="field-row"><span class="field-label">Classification</span><span>${record.classification}</span></div>
      <div class="department-versions">
        <div class="department-version a"><h4>DEPARTMENT A</h4>${record.body_a.map((p) => `<p>${p}</p>`).join("")}</div>
        <div class="department-version b"><h4>DEPARTMENT B</h4>${record.body_b.map((p) => `<p>${p}</p>`).join("")}</div>
      </div>
      ${record.redactions && record.redactions.length ? `<p class="system-note">REDACTED: ${record.redactions.join(" ")}</p>` : ""}
    </div>`;
  row.classList.add("expanded");
  row.setAttribute("aria-expanded", "true");
  expandedByList[listId] = record.id;
  glitch(slot);
}

/* ---------------- Personnel ---------------- */
async function loadPersonnel() {
  const list = await api.personnel();
  const container = qs("#personnel-list");
  expandedByList["personnel-list"] = null;
  container.innerHTML = list
    .map((p) => {
      if (p.locked) {
        return `<article class="record locked" tabindex="0"><div class="record-id">${p.id}</div><div class="record-title">${p.name}</div><div></div></article>`;
      }
      return `<article class="record" tabindex="0" data-person="${p.id}" aria-expanded="false"><div class="record-id">${p.id}</div><div><div class="record-title">${p.name}</div><div class="system-note">${p.role}</div></div><div class="record-meta">${p.clearance}</div></article>
      <div class="record-expand" id="expand-personnel-list-${p.id}"></div>`;
    })
    .join("");

  qsa("[data-person]", container).forEach((el) => {
    const activate = () => togglePersonnel(list.find((p) => p.id === el.dataset.person));
    el.addEventListener("click", activate);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") activate(); });
  });
}

function togglePersonnel(record) {
  if (!record) return;
  const listId = "personnel-list";
  const alreadyOpen = expandedByList[listId] === record.id;
  collapseExpanded(listId, "data-person");
  if (alreadyOpen) return;

  beep();
  const slot = qs(`#expand-${listId}-${record.id}`);
  const row = qs(`[data-person="${record.id}"]`, qs(`#${listId}`));
  slot.innerHTML = `
    <div class="record-detail">
      <h3>${record.id} // ${record.name}</h3>
      <div class="field-row"><span class="field-label">Role</span><span>${record.role}</span></div>
      <div class="field-row"><span class="field-label">Date of entry</span><span>${record.date_of_entry}</span></div>
      <div class="field-row"><span class="field-label">Clearance</span><span>${record.clearance}</span></div>
      <div class="field-row"><span class="field-label">Status (Dept A)</span><span>${record.status_a}</span></div>
      <div class="field-row"><span class="field-label">Status (Dept B)</span><span>${record.status_b}</span></div>
      <p class="system-note">${record.notes || ""}</p>
      <div id="personnel-video-slot"></div>
    </div>`;
  row.classList.add("expanded");
  row.setAttribute("aria-expanded", "true");
  expandedByList[listId] = record.id;
  glitch(slot);

  if (record.id === "CCD-0417") {
    getTransmissions().then((list) => {
      const t = list.find((tx) => tx.id === "TX-SECRET-VALE");
      const videoSlot = qs("#personnel-video-slot", slot);
      if (!videoSlot || !t || !t.stream_endpoint) return;
      videoSlot.innerHTML = `
        <h4 style="margin-top:16px;">RECOVERED FRAGMENT</h4>
        <div class="crt-frame">
          <span class="crt-label">TX-${t.number}</span>
          <video controls controlsList="nodownload" disablePictureInPicture preload="none" crossorigin="anonymous">
            <source src="${t.stream_endpoint}" />
            ${t.captions_endpoint ? `<track kind="captions" src="${t.captions_endpoint}" srclang="en" label="English" />` : ""}
          </video>
        </div>`;
    });
  }
}

/* ---------------- Audio Lab ---------------- */
async function loadAudioLab() {
  const list = await api.audio();
  const container = qs("#audio-list");
  container.innerHTML = list
    .map((a) => {
      if (a.locked) {
        return `<div class="panel"><strong class="record-title">[LOCKED RECORD]</strong></div>`;
      }
      return `
        <div class="panel">
          <h3>${a.title}</h3>
          <audio id="audio-${a.id}" preload="none" src="/assets/audio/${a.file}"></audio>
          <div class="audio-controls">
            <button data-play="${a.id}">PLAY</button>
            <button data-pause="${a.id}">PAUSE</button>
            <button data-reverse="${a.id}">REVERSE / DECODE</button>
          </div>
          <div class="audio-transcript" id="transcript-${a.id}">DISPLAYED TRANSCRIPT: ${a.shown_transcript}</div>
          <p class="system-note">Accessible alternative: ${a.accessibility_alternative}</p>
        </div>`;
    })
    .join("");

  list.filter((a) => !a.locked).forEach((a) => {
    const audioEl = () => qs(`#audio-${a.id}`);
    qs(`[data-play="${a.id}"]`)?.addEventListener("click", () => { const el = audioEl(); el.currentTime = 0; el.play().catch(() => {}); });
    qs(`[data-pause="${a.id}"]`)?.addEventListener("click", () => audioEl().pause());
    qs(`[data-reverse="${a.id}"]`)?.addEventListener("click", async () => {
      // Plays the source audio in reverse for anyone who wants the audio
      // experience, and separately requests the text-accessible decoded
      // transcript from the server so the puzzle is never audio-only.
      audioEl().pause();
      const result = await api.decodeAudio(a.id).catch(() => null);
      const transcriptEl = qs(`#transcript-${a.id}`);
      if (result && result.success) {
        transcriptEl.textContent = `DECODED TRANSCRIPT: ${result.transcript}`;
      } else {
        transcriptEl.textContent = "DECODE UNAVAILABLE // RECORD NOT YET RESTORED.";
      }
    });
  });

  // Archive Minus One — recovered video attached to Audio Lab access per
  // the client's unlock mapping, shown alongside the raw audio fragments.
  if (currentState.unlocked.audio) {
    const txList = await getTransmissions();
    const t = txList.find((tx) => tx.id === "TX-SECRET-AM1");
    if (t && t.stream_endpoint) {
      const slot = document.createElement("div");
      slot.className = "panel";
      slot.innerHTML = `
        <h3>${t.title}</h3>
        <div class="crt-frame">
          <span class="crt-label">TX-${t.number}</span>
          <video controls controlsList="nodownload" disablePictureInPicture preload="none" crossorigin="anonymous">
            <source src="${t.stream_endpoint}" />
            ${t.captions_endpoint ? `<track kind="captions" src="${t.captions_endpoint}" srclang="en" label="English" />` : ""}
          </video>
        </div>
        <p class="system-note">Streamed only, not available for download. Captions provided.</p>`;
      container.appendChild(slot);
    }
  }
}

/* ---------------- Boot / code entry ---------------- */
function initBoot() {
  const ack = qs("#acknowledge");
  const disc = qs("#disconnect");
  ack.addEventListener("click", () => {
    qs("#boot-screen").classList.add("hidden");
    beep();
  });
  disc.addEventListener("click", () => {
    beep();
    const msg = qs("#disconnect-message");
    msg.textContent = "DISCONNECTION REQUEST ACCEPTED...";
    setTimeout(() => { msg.textContent = "DISCONNECTION IS NO LONGER AVAILABLE."; }, 900);
  });
}

function initCodeEntry() {
  const submit = async () => {
    const input = qs("#access-code");
    const result = await api.verify(input.value);
    qs("#code-response").textContent = result.message;
    playResultSound(result.success);
    if (result.success) {
      input.value = "";
      await refreshState();
      glitch(document.body);
      invalidateTransmissionsCache();
      loadPage(currentPageName); // re-render whichever page is currently open
    }
  };
  qs("#submit-code").addEventListener("click", submit);
  qs("#access-code").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  qs("#hint-toggle")?.addEventListener("click", async () => {
    const box = qs("#hint-box");
    box.hidden = !box.hidden;
    if (!box.hidden && !box.dataset.loaded) {
      const puzzles = await api.puzzles();
      const unlockedKeys = Object.entries(currentState.unlocked).filter(([, v]) => v).map(([k]) => k);
      const next = puzzles.find((p) => p.unlock_key && !unlockedKeys.includes(p.unlock_key));
      if (next) {
        box.innerHTML = `<p><strong>${next.title}</strong></p><p>${next.hint_1 || ""}</p><p>${next.hint_2 || ""}</p>`;
      } else {
        box.textContent = "NO FURTHER HINTS AVAILABLE.";
      }
      box.dataset.loaded = "1";
    }
  });
}

function initReceiverStatus() {
  qs("#reset-progress").addEventListener("click", async () => {
    await api.reset();
    location.reload();
  });
}

function initClock() {
  let seconds = 0;
  setInterval(() => {
    seconds = (seconds + 1) % 60;
    const el = qs("#system-time");
    if (el) el.textContent = `02:17:${String(seconds).padStart(2, "0")}`;
  }, 1000);
}

async function loadLevel7() {
  const container = qs("#level7-content");
  if (!currentState.unlocked.restricted) {
    container.innerHTML = `<p class="system-note">LEVEL 7 ACCESS: LOCKED. Solve the recovery chain to continue.</p>`;
    return;
  }
  const list = await getTransmissions();
  const items = list.filter((t) => t.id === "TX-SECRET-FZO" || t.id === "TX-000");
  container.innerHTML = `
    <p class="system-note">ARCHIVE OWNERSHIP CONFLICT CONFIRMED. THE CONTAINMENT STORY MAY ITSELF BE A COPIED NARRATIVE.</p>
    ${items
      .map(
        (t) => `
        <div style="margin-top:16px;">
          <h3 class="record-title">${t.title}</h3>
          ${
            t.stream_endpoint
              ? `<div class="crt-frame">
                  <span class="crt-label">TX-${t.number}</span>
                  <video controls controlsList="nodownload" disablePictureInPicture preload="none" crossorigin="anonymous">
                    <source src="${t.stream_endpoint}" />
                    ${t.captions_endpoint ? `<track kind="captions" src="${t.captions_endpoint}" srclang="en" label="English" />` : ""}
                  </video>
                </div>
                <p class="system-note" style="margin-top:8px;">Streamed only, not available for download. Captions provided.</p>`
              : `<p class="system-note">[LOCKED RECORD]</p>`
          }
        </div>`
      )
      .join("")}`;
}

function loadPage(name) {
  const loaders = {
    transmissions: loadTransmissions,
    archive: loadArchive,
    incidents: loadIncidents,
    personnel: loadPersonnel,
    audio: loadAudioLab,
    level7: loadLevel7,
  };
  loaders[name]?.();
}

function initNav() {
  qsa(".nav-item").forEach((b) => b.addEventListener("click", () => { beep(); showPage(b.dataset.page); }));
}

async function boot() {
  initBoot();
  initNav();
  initCodeEntry();
  initReceiverStatus();
  initClock();
  await refreshState();
  showPage("transmissions");
}

boot();
