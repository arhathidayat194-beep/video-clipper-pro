/* ================================================
   Video Clipper Pro — app.js
   FFmpeg.wasm 0.11.x | JSZip | FileSaver
   ================================================ */

const { createFFmpeg, fetchFile } = FFmpeg;

const state = {
  ffmpeg: null,
  ffmpegReady: false,
  videoInfo: null,
  processedClips: [],
  manualSegments: [{ start: "00:00:00", end: "00:01:00" }],
};

/* ── Utilities ──────────────────────────────────── */
const pad   = (n) => String(Math.floor(n)).padStart(2, "0");

function toHMS(secs) {
  return `${pad(secs / 3600)}:${pad((secs % 3600) / 60)}:${pad(secs % 60)}`;
}

function fmtDur(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}j ${m}m ${s}d`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s} detik`;
}

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeToSec(str) {
  if (!str) return 0;
  const p = String(str).split(":").map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + (p[2] || 0);
  if (p.length === 2) return p[0] * 60 + (p[1] || 0);
  return p[0] || 0;
}

function getExt(url) {
  const u = (url || "").toLowerCase();
  if (u.includes(".webm")) return "webm";
  if (u.includes(".mov"))  return "mov";
  return "mp4";
}

/* ── FFmpeg Init ────────────────────────────────── */
async function initFFmpeg() {
  if (state.ffmpegReady) return;
  state.ffmpeg = createFFmpeg({
    log: false,
    corePath: "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js",
    progress: ({ ratio }) => setProgress(Math.min(95, Math.round(ratio * 100))),
  });
  state.ffmpeg.setLogger(({ message }) => {
    const el = document.getElementById("ffLog");
    if (el) { el.style.display = "block"; el.textContent = message; el.scrollTop = el.scrollHeight; }
  });
  await state.ffmpeg.load();
  state.ffmpegReady = true;
}

/* ── Clip Calculator ────────────────────────────── */
function calcClips() {
  const mode = document.getElementById("clipMode").value;
  const duration = state.videoInfo?.duration || 0;

  if (mode === "manual") {
    return state.manualSegments
      .map((seg, i) => {
        const start = timeToSec(seg.start);
        const end   = timeToSec(seg.end);
        return { index: i + 1, start, end, duration: end - start };
      })
      .filter((c) => c.duration > 0);
  }

  if (!duration) return [];

  let clipSecs;
  if (mode === "duration") {
    const val  = parseInt(document.getElementById("clipDuration").value) || 30;
    const unit = document.getElementById("durUnit").value;
    clipSecs = unit === "m" ? val * 60 : val;
  } else {
    const count = parseInt(document.getElementById("clipCount").value) || 3;
    clipSecs = Math.ceil(duration / count);
  }
  clipSecs = Math.max(1, clipSecs);

  const clips = [];
  let start = 0, idx = 1;
  while (start < duration) {
    const end = Math.min(start + clipSecs, duration);
    clips.push({ index: idx++, start, end, duration: end - start });
    start = end;
  }
  return clips;
}

function updateClipPreview() {
  const clips  = calcClips();
  const list   = document.getElementById("clipList");
  if (!clips.length) {
    list.innerHTML = '<p class="muted-sm">Akan muncul setelah info video diambil</p>';
    return;
  }
  list.innerHTML = clips.map((c) =>
    `<div class="clip-item">
      <span class="clip-num">#${c.index}</span>
      <span class="clip-time">${toHMS(c.start)} → ${toHMS(c.end)}</span>
      <span class="clip-dur">${fmtDur(c.duration)}</span>
    </div>`
  ).join("");
}

/* ── Fetch Video Info ───────────────────────────── */
async function fetchVideoInfo(url) {
  const resp = await fetch("/.netlify/functions/get-video-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${resp.status}`);
  }
  return resp.json();
}

/* ── Process Video ──────────────────────────────── */
async function processVideo() {
  const clips = calcClips();
  if (!clips.length) {
    alert("Tidak ada klip yang bisa diproses. Periksa pengaturan durasi.");
    return;
  }

  show("sec-progress");
  hide("sec-results");
  hide("sec-error");
  setProgress(0);
  setProgText("Menginisialisasi FFmpeg (download ~20 MB, sekali saja)…");

  try {
    await initFFmpeg();
    setProgText("Mengunduh video ke browser… (sabar, bisa beberapa menit)");

    let videoData;
    try {
      videoData = await fetchFile(state.videoInfo.downloadUrl);
    } catch (e) {
      throw new Error(
        "Gagal mengunduh video. Kemungkinan penyebab: CORS diblokir atau URL sudah kadaluarsa. " +
        "Coba lagi atau gunakan link MP4 langsung."
      );
    }

    const ext      = getExt(state.videoInfo.downloadUrl);
    const inFile   = `input.${ext}`;
    const outFmt   = document.getElementById("outFmt").value;

    state.ffmpeg.FS("writeFile", inFile, videoData);

    const results = [];
    for (let i = 0; i < clips.length; i++) {
      const c       = clips[i];
      const outFile = `clip_${String(i + 1).padStart(3, "0")}.${outFmt}`;

      setProgText(`Memotong bagian ${i + 1} / ${clips.length}…`);
      setProgress(Math.round(5 + (i / clips.length) * 88));

      await state.ffmpeg.run(
        "-ss", toHMS(c.start),
        "-i", inFile,
        "-t", String(Math.ceil(c.duration)),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-y", outFile
      );

      const data = state.ffmpeg.FS("readFile", outFile);
      const blob = new Blob([data.buffer], { type: `video/${outFmt}` });
      results.push({
        index: c.index, filename: outFile, blob,
        url: URL.createObjectURL(blob),
        size: data.length, start: c.start, end: c.end, duration: c.duration,
      });
      state.ffmpeg.FS("unlink", outFile);
    }

    state.ffmpeg.FS("unlink", inFile);
    setProgress(100);
    state.processedClips = results;
    renderResults(results);

  } catch (err) {
    showError(err.message);
  }
}

/* ── Render Results ─────────────────────────────── */
function renderResults(clips) {
  document.getElementById("resSummary").textContent =
    `${clips.length} bagian berhasil dibuat!`;

  document.getElementById("resList").innerHTML = clips.map((c) =>
    `<div class="result-item">
      <div class="result-top">
        <span class="result-title">🎬 Bagian ${c.index}</span>
        <span class="result-meta">${toHMS(c.start)} → ${toHMS(c.end)} &nbsp;|&nbsp; ${fmtDur(c.duration)} &nbsp;|&nbsp; ${fmtSize(c.size)}</span>
      </div>
      <video class="result-video" controls src="${c.url}" preload="metadata"></video>
      <div class="result-actions">
        <a href="${c.url}" download="${c.filename}" class="btn btn-primary btn-sm">⬇️ Download ${c.filename}</a>
      </div>
    </div>`
  ).join("");

  hide("sec-progress");
  show("sec-results");
}

/* ── Download All ZIP ───────────────────────────── */
async function downloadAllZip() {
  const btn = document.getElementById("dlAllBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Membuat ZIP…";

  try {
    const zip = new JSZip();
    const title = (state.videoInfo?.title || "video")
      .replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 40) || "video";

    state.processedClips.forEach((c) => zip.file(c.filename, c.blob));
    const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    saveAs(content, `${title}_clips.zip`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "📦 Download Semua (ZIP)";
  }
}

/* ── Manual Segments ────────────────────────────── */
function renderSegments() {
  document.getElementById("segList").innerHTML = state.manualSegments.map((seg, i) =>
    `<div class="seg-row">
      <span>Segmen ${i + 1}</span>
      <input type="text" value="${seg.start}" placeholder="00:00:00" class="time-input"
        onchange="state.manualSegments[${i}].start=this.value;updateClipPreview();" />
      <span>→</span>
      <input type="text" value="${seg.end}" placeholder="00:00:00" class="time-input"
        onchange="state.manualSegments[${i}].end=this.value;updateClipPreview();" />
      ${state.manualSegments.length > 1
        ? `<button class="btn btn-danger btn-sm"
             onclick="state.manualSegments.splice(${i},1);renderSegments();updateClipPreview();">✕</button>`
        : ""}
    </div>`
  ).join("");
}

/* ── UI Helpers ─────────────────────────────────── */
const show = (id) => document.getElementById(id).classList.remove("hidden");
const hide = (id) => document.getElementById(id).classList.add("hidden");

function setProgress(p) {
  document.getElementById("progFill").style.width = `${p}%`;
  document.getElementById("progPct").textContent  = `${p}%`;
}
function setProgText(t) { document.getElementById("progText").textContent = t; }

function showError(msg) {
  document.getElementById("errMsg").textContent = msg;
  hide("sec-progress");
  show("sec-error");
}

/* ── Bootstrap ──────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

  // Warm up FFmpeg in background
  initFFmpeg().catch(() => {});

  /* Fetch video info */
  document.getElementById("fetchBtn").addEventListener("click", async () => {
    const url = document.getElementById("videoUrl").value.trim();
    if (!url) { alert("Masukkan URL video terlebih dahulu."); return; }

    const btn = document.getElementById("fetchBtn");
    btn.disabled = true; btn.textContent = "⏳ Mengambil…";

    try {
      const info = await fetchVideoInfo(url);
      state.videoInfo = info;

      document.getElementById("vTitle").textContent = info.title || "Video";
      document.getElementById("vDurationTag").textContent =
        "⏱ " + (info.duration ? fmtDur(info.duration) : "Tidak diketahui");
      document.getElementById("vQualityTag").textContent =
        "📺 " + (info.quality || "—");

      const thumb  = document.getElementById("vThumb");
      const tPlaceholder = document.getElementById("thumbPlaceholder");
      if (info.thumbnail) {
        thumb.src = info.thumbnail;
        thumb.onload  = () => tPlaceholder.style.display = "none";
        thumb.onerror = () => { thumb.style.display = "none"; tPlaceholder.style.display = "flex"; };
      } else {
        thumb.style.display = "none";
        tPlaceholder.style.display = "flex";
      }

      show("sec-info");
      show("sec-settings");
      hide("sec-error");
      updateClipPreview();
    } catch (e) {
      alert("❌ " + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Ambil Info`;
    }
  });

  /* Mode toggle */
  document.getElementById("clipMode").addEventListener("change", (e) => {
    const m = e.target.value;
    document.getElementById("f-duration").classList.toggle("hidden", m !== "duration");
    document.getElementById("f-count").classList.toggle("hidden", m !== "count");
    document.getElementById("f-manual").classList.toggle("hidden", m !== "manual");
    if (m === "manual") renderSegments();
    updateClipPreview();
  });

  ["clipDuration", "clipCount"].forEach((id) =>
    document.getElementById(id).addEventListener("input", updateClipPreview)
  );
  document.getElementById("durUnit").addEventListener("change", updateClipPreview);

  document.getElementById("addSegBtn").addEventListener("click", () => {
    state.manualSegments.push({ start: "00:00:00", end: "00:01:00" });
    renderSegments(); updateClipPreview();
  });

  /* Enter key on URL input */
  document.getElementById("videoUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("fetchBtn").click();
  });

  document.getElementById("processBtn").addEventListener("click", processVideo);
  document.getElementById("dlAllBtn").addEventListener("click", downloadAllZip);
  document.getElementById("newBtn").addEventListener("click", () => location.reload());
  document.getElementById("retryBtn").addEventListener("click", () => {
    hide("sec-error"); show("sec-settings");
  });
});
