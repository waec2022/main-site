"use strict";

/* =========================================================
   CONFIG — platform durations & target sizes (easy to edit)
   ========================================================= */
const PLATFORMS = {
  whatsapp: {
    name: "WhatsApp Status",
    icon: "wa",
    maxDuration: 30,        // seconds per part
    targetSizeMB: 16,       // configurable target, not an official guarantee
    metaLabel: "30 sec per part",
  },
  tiktok: {
    name: "TikTok",
    icon: "tt",
    maxDuration: 600,
    targetSizeMB: 287,
    metaLabel: "Up to 10 minutes",
  },
  instagram: {
    name: "Instagram Reels",
    icon: "ig",
    maxDuration: 90,
    targetSizeMB: 450,
    metaLabel: "Up to 90 seconds",
  },
};

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const FFMPEG_VERSION = "0.12.10";
const FFMPEG_CORE_VERSION = "0.12.6";
const FFMPEG_UTIL_VERSION = "0.12.1";

/* =========================================================
   STATE
   ========================================================= */
const state = {
  file: null,
  fileURL: null,
  duration: 0,
  width: 0,
  height: 0,
  selected: new Set(),
  ffmpeg: null,
  ffmpegLoaded: false,
  cancelled: false,
  processing: false,
  results: [],        // {platform, index, count, start, end, sizeBytes, blob, url, filename}
  activeFilter: "all",
};

/* =========================================================
   DOM HELPERS
   ========================================================= */
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.hidden = s.id !== id;
  });
  window.scrollTo(0, 0);
}

function showToast(message, isError) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", !!isError);
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 3200);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function sanitizeBaseName(name) {
  const base = name.replace(/\.[^/.]+$/, "");
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || "video";
}

/* =========================================================
   THEME
   ========================================================= */
function initTheme() {
  const saved = safeLocalStorageGet("fitra-theme");
  const theme = saved === "light" || saved === "dark" ? saved : "dark";
  applyTheme(theme);

  $("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    safeLocalStorageSet("fitra-theme", next);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("iconMoon").hidden = theme !== "dark";
  $("iconSun").hidden = theme === "dark";
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* ignore (private browsing etc.) */
  }
}

/* =========================================================
   SCREEN 1 — HOME / UPLOAD
   ========================================================= */
function initHome() {
  const fileInput = $("fileInput");
  const dropZone = $("dropZone");

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFileSelected(file);
  });

  ["dragover", "dragenter"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
    })
  );
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });

  $("removeVideoBtn").addEventListener("click", (e) => {
    e.preventDefault();
    resetVideoSelection();
  });

  $("continueBtn").addEventListener("click", () => {
    if (!state.file) return;
    renderPlatformList();
    showScreen("screen-platform");
  });
}

function handleFileSelected(file) {
  if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
    showToast("Please choose a valid video file.", true);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showToast("This video is larger than the 2GB limit.", true);
    return;
  }

  resetVideoSelection(true);
  state.file = file;
  state.fileURL = URL.createObjectURL(file);

  const probe = $("videoThumb");
  probe.src = state.fileURL;

  probe.onloadedmetadata = () => {
    state.duration = probe.duration || 0;
    state.width = probe.videoWidth || 0;
    state.height = probe.videoHeight || 0;
    revealVideoInfo(file);
  };
  probe.onerror = () => {
    showToast("This video couldn't be read by your browser.", true);
    resetVideoSelection();
  };
}

function revealVideoInfo(file) {
  $("infoName").textContent = file.name;
  const meta = [
    formatBytes(file.size),
    formatTime(state.duration),
    state.width && state.height ? `${state.width}x${state.height}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  $("infoMeta").textContent = meta;
  $("videoInfo").hidden = false;
  $("continueBtn").hidden = false;
  $("dropZone").style.display = "none";
}

function resetVideoSelection(keepScreen) {
  if (state.fileURL) URL.revokeObjectURL(state.fileURL);
  state.file = null;
  state.fileURL = null;
  state.duration = 0;
  state.width = 0;
  state.height = 0;
  $("fileInput").value = "";
  $("videoInfo").hidden = true;
  $("continueBtn").hidden = true;
  $("dropZone").style.display = "flex";
  if (!keepScreen) showScreen("screen-home");
}

/* =========================================================
   SCREEN 2 — PLATFORM SELECTION
   ========================================================= */
function renderPlatformList() {
  const list = $("platformList");
  list.innerHTML = "";

  Object.entries(PLATFORMS).forEach(([key, p]) => {
    const card = document.createElement("div");
    card.className = "platform-card" + (state.selected.has(key) ? " selected" : "");
    card.dataset.key = key;
    card.innerHTML = `
      <div class="platform-icon" style="background:${platformIconBg(key)}">${platformIconSVG(p.icon)}</div>
      <div class="platform-info">
        <p class="platform-name"></p>
        <p class="platform-meta">${p.metaLabel} · ~${p.targetSizeMB}MB target</p>
      </div>
      <div class="checkbox">${checkSVG()}</div>
    `;
    card.querySelector(".platform-name").textContent = p.name;
    card.addEventListener("click", () => togglePlatform(key, card));
    list.appendChild(card);
  });

  updatePrepareButton();
}

function togglePlatform(key, card) {
  if (state.selected.has(key)) {
    state.selected.delete(key);
    card.classList.remove("selected");
  } else {
    state.selected.add(key);
    card.classList.add("selected");
  }
  updatePrepareButton();
}

function updatePrepareButton() {
  $("prepareBtn").disabled = state.selected.size === 0;
}

function platformIconSVG(kind) {
  if (kind === "wa") {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20Zm4.4-5.9c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.4.1-.5.1-.1.2-.3.4-.4.1-.1.2-.2.2-.4.1-.1 0-.3 0-.4C10.3 8.9 10 8 9.8 7.6c-.2-.4-.3-.3-.5-.3h-.4c-.1 0-.4 0-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.1 1.7 2.6 4 3.6.6.2 1 .4 1.4.5.6.2 1.1.1 1.5.1.5-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1-.1-.1-.2-.2-.5-.3Z"/></svg>`;
  }
  if (kind === "tt") {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M16.6 5.2c-.9-.6-1.5-1.5-1.7-2.6h-3v13c0 1.4-1.1 2.5-2.5 2.5S6.9 17 6.9 15.6s1.1-2.5 2.5-2.5c.3 0 .5 0 .8.1V9.9c-.3 0-.5-.1-.8-.1-3 0-5.5 2.5-5.5 5.5S6.4 21 9.4 21s5.5-2.5 5.5-5.5V9.1c1.1.8 2.5 1.3 4 1.3V7.4c-.9 0-1.7-.3-2.3-.7 0 0-.9-.6 0 0Z"/></svg>`;
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4" fill="#000"/><circle cx="17.2" cy="6.8" r="1.1" fill="#000"/></svg>`;
}

function platformIconBg(key) {
  if (key === "whatsapp") return "#25D366";
  if (key === "tiktok") return "#111111";
  return "linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)";
}

function checkSVG() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}

/* =========================================================
   SEGMENT PLANNING
   ========================================================= */
function computeSegments(totalDuration, maxDuration) {
  const segments = [];
  if (totalDuration <= maxDuration + 0.001) {
    segments.push({ start: 0, end: totalDuration });
    return segments;
  }
  let start = 0;
  while (start < totalDuration - 0.001) {
    const end = Math.min(start + maxDuration, totalDuration);
    segments.push({ start, end });
    start = end;
  }
  return segments;
}

function buildJobPlan() {
  const jobs = [];
  state.selected.forEach((key) => {
    const platform = PLATFORMS[key];
    const segments = computeSegments(state.duration, platform.maxDuration);
    segments.forEach((seg, i) => {
      jobs.push({
        platformKey: key,
        platform,
        index: i,
        count: segments.length,
        start: seg.start,
        end: seg.end,
      });
    });
  });
  return jobs;
}

/* =========================================================
   SCREEN 3 — PROCESSING (real ffmpeg.wasm work)
   ========================================================= */
async function loadFFmpegLazy(onLog) {
  if (state.ffmpegLoaded && state.ffmpeg) return state.ffmpeg;

  const { FFmpeg } = await import(
    `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`
  );
  const { toBlobURL, fetchFile } = await import(
    `https://unpkg.com/@ffmpeg/util@${FFMPEG_UTIL_VERSION}/dist/esm/index.js`
  );
  state.fetchFile = fetchFile;

  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on("log", onLog);

  const baseURL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  state.ffmpeg = ffmpeg;
  state.ffmpegLoaded = true;
  return ffmpeg;
}

function setProgressUI(fraction, platformName, partLabel, statusText) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  $("ringPercent").textContent = `${pct}%`;
  $("barFill").style.width = `${pct}%`;
  const circumference = 389.6;
  $("ringFg").style.strokeDashoffset = String(circumference * (1 - pct / 100));
  if (platformName !== undefined) $("processingPlatform").textContent = platformName;
  if (partLabel !== undefined) $("processingPart").textContent = partLabel;
  if (statusText !== undefined) $("processingStatus").textContent = statusText;
}

async function runProcessing() {
  state.cancelled = false;
  state.processing = true;
  state.results.forEach((r) => r.url && URL.revokeObjectURL(r.url));
  state.results = [];

  showScreen("screen-processing");
  setProgressUI(0, "Loading engine…", "", "Preparing the video engine for your device…");
  $("cancelBtn").disabled = false;

  let ffmpeg;
  try {
    ffmpeg = await loadFFmpegLazy();
  } catch (err) {
    finishWithError("Couldn't load the video engine. Check your connection and try again.");
    return;
  }
  if (state.cancelled) return;

  const jobs = buildJobPlan();
  const totalJobs = jobs.length;
  const baseName = sanitizeBaseName(state.file.name);
  const inputName = "input_source.mp4";

  try {
    setProgressUI(0.02, "Reading video…", "", "Loading your video into the engine…");
    await ffmpeg.writeFile(inputName, await state.fetchFile(state.file));
  } catch (err) {
    finishWithError("Couldn't read this video. It may be corrupted or unsupported.");
    return;
  }
  if (state.cancelled) return;

  for (let i = 0; i < totalJobs; i++) {
    if (state.cancelled) return;
    const job = jobs[i];
    const partLabel = job.count > 1 ? `Part ${job.index + 1} of ${job.count}` : "Preparing file";

    setProgressUI(
      i / totalJobs,
      `Processing ${job.platform.name}`,
      partLabel,
      "Splitting and compressing your video…"
    );

    let progressHandler = ({ progress }) => {
      if (state.cancelled) return;
      const jobFraction = Math.max(0, Math.min(1, progress || 0));
      const overall = (i + jobFraction) / totalJobs;
      setProgressUI(overall);
    };
    ffmpeg.on("progress", progressHandler);

    try {
      const result = await processSegment(ffmpeg, inputName, job, baseName);
      state.results.push(result);
    } catch (err) {
      ffmpeg.off("progress", progressHandler);
      if (state.cancelled) return;
      finishWithError("Something went wrong while processing this video. Please try again.");
      return;
    }
    ffmpeg.off("progress", progressHandler);

    if (state.cancelled) return;
    setProgressUI((i + 1) / totalJobs);
  }

  try {
    await ffmpeg.deleteFile(inputName);
  } catch (e) {
    /* non-fatal cleanup */
  }

  if (state.cancelled) return;

  setProgressUI(1, "Done", "", "Finishing up…");
  state.processing = false;
  renderResults();
  showScreen("screen-results");
}

async function processSegment(ffmpeg, inputName, job, baseName) {
  const { start, end, platformKey, platform, index, count } = job;
  const duration = Math.max(0.1, end - start);
  const outName = `out_${platformKey}_${index}.mp4`;

  // Pass 1: fast stream-copy trim (no re-encode)
  await ffmpeg.exec([
    "-ss", start.toFixed(3),
    "-to", end.toFixed(3),
    "-i", inputName,
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    outName,
  ]);

  let data = await ffmpeg.readFile(outName);
  let sizeBytes = data.byteLength || data.length;
  const targetBytes = platform.targetSizeMB * 1024 * 1024;

  // Pass 2: if over target, re-encode with a calculated bitrate
  if (sizeBytes > targetBytes && sizeBytes > 0) {
    await ffmpeg.deleteFile(outName);
    const audioBitrateBps = 128000;
    const overheadFactor = 0.94; // leave headroom for container/muxing overhead
    const targetBits = targetBytes * 8 * overheadFactor;
    let videoBitrateBps = Math.floor(targetBits / duration - audioBitrateBps);
    videoBitrateBps = Math.max(150000, videoBitrateBps);

    const compressedName = `compressed_${platformKey}_${index}.mp4`;
    await ffmpeg.exec([
      "-ss", start.toFixed(3),
      "-to", end.toFixed(3),
      "-i", inputName,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-b:v", String(videoBitrateBps),
      "-maxrate", String(Math.floor(videoBitrateBps * 1.5)),
      "-bufsize", String(Math.floor(videoBitrateBps * 2)),
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      compressedName,
    ]);

    data = await ffmpeg.readFile(compressedName);
    sizeBytes = data.byteLength || data.length;
    await ffmpeg.deleteFile(compressedName);
  } else {
    await ffmpeg.deleteFile(outName);
  }

  const blob = new Blob([data], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const filename =
    count > 1
      ? `${baseName}_${platformKey}_part_${String(index + 1).padStart(2, "0")}.mp4`
      : platformKey === "instagram"
      ? `${baseName}_instagram_reel.mp4`
      : `${baseName}_${platformKey}.mp4`;

  return {
    platformKey,
    platformName: platform.name,
    index,
    count,
    start,
    end,
    sizeBytes,
    blob,
    url,
    filename,
  };
}

function finishWithError(message) {
  state.processing = false;
  showToast(message, true);
  showScreen("screen-platform");
}

function cancelProcessing() {
  if (!state.processing) return;
  state.cancelled = true;
  state.processing = false;
  try {
    if (state.ffmpeg) {
      state.ffmpeg.terminate();
    }
  } catch (e) {
    /* ignore */
  }
  state.ffmpeg = null;
  state.ffmpegLoaded = false;
  showToast("Processing cancelled.");
  showScreen("screen-platform");
}

/* =========================================================
   SCREEN 4 — RESULTS
   ========================================================= */
function renderResults() {
  const wrap = $("resultsSummary");
  wrap.innerHTML = "";

  const byPlatform = groupResultsByPlatform();

  Object.entries(byPlatform).forEach(([key, items]) => {
    const platform = PLATFORMS[key];
    const avgMB = items.reduce((sum, r) => sum + r.sizeBytes, 0) / items.length / (1024 * 1024);
    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML = `
      <div class="platform-icon" style="background:${platformIconBg(key)}">${platformIconSVG(platform.icon)}</div>
      <div class="result-info">
        <p class="result-name"></p>
        <p class="result-meta">${
          items.length > 1
            ? `${items.length} parts created · ~${avgMB.toFixed(1)}MB each`
            : `1 video created · ~${avgMB.toFixed(1)}MB`
        }</p>
      </div>
      <div class="result-check">${checkSVG()}</div>
    `;
    row.querySelector(".result-name").textContent = platform.name;
    wrap.appendChild(row);
  });
}

function groupResultsByPlatform() {
  const groups = {};
  state.results.forEach((r) => {
    if (!groups[r.platformKey]) groups[r.platformKey] = [];
    groups[r.platformKey].push(r);
  });
  Object.values(groups).forEach((arr) => arr.sort((a, b) => a.index - b.index));
  return groups;
}

/* =========================================================
   SCREEN 5 — FILES
   ========================================================= */
function renderFileFilters() {
  const wrap = $("fileFilters");
  wrap.innerHTML = "";
  const present = [...new Set(state.results.map((r) => r.platformKey))];
  const filters = [{ key: "all", label: "All" }, ...present.map((k) => ({ key: k, label: PLATFORMS[k].name.split(" ")[0] }))];

  filters.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn" + (state.activeFilter === f.key ? " active" : "");
    btn.textContent = f.label;
    btn.addEventListener("click", () => {
      state.activeFilter = f.key;
      renderFileFilters();
      renderFileGroups();
    });
    wrap.appendChild(btn);
  });
}

function renderFileGroups() {
  const wrap = $("fileGroups");
  wrap.innerHTML = "";

  const byPlatform = groupResultsByPlatform();
  const keys = Object.keys(byPlatform).filter(
    (k) => state.activeFilter === "all" || state.activeFilter === k
  );

  if (keys.length === 0) {
    wrap.innerHTML = `<p class="screen-sub">No files in this category.</p>`;
    return;
  }

  keys.forEach((key) => {
    const items = byPlatform[key];
    const totalMB = items.reduce((sum, r) => sum + r.sizeBytes, 0) / (1024 * 1024);

    const title = document.createElement("div");
    title.className = "file-group-title";
    title.innerHTML = `<span></span><span>~${totalMB.toFixed(0)}MB</span>`;
    title.querySelector("span").textContent = `${PLATFORMS[key].name} (${items.length})`;
    wrap.appendChild(title);

    items.forEach((r) => {
      const row = document.createElement("div");
      row.className = "file-row";
      row.innerHTML = `
        <div class="file-thumb" title="Preview">${playSVG()}</div>
        <div class="file-details">
          <p class="file-name"></p>
          <p class="file-meta"></p>
        </div>
        <div class="file-actions">
          <button class="icon-btn small" type="button" aria-label="Preview">${eyeSVG()}</button>
          <button class="icon-btn small" type="button" aria-label="Download">${downloadSVG()}</button>
        </div>
      `;
      row.querySelector(".file-name").textContent =
        r.count > 1 ? `Part ${r.index + 1}` : r.platformName;
      row.querySelector(".file-meta").textContent = `${formatTime(r.start)} – ${formatTime(
        r.end
      )} · ${formatBytes(r.sizeBytes)}`;

      const openPreview = () => showPreview(r.url);
      row.querySelector(".file-thumb").addEventListener("click", openPreview);
      row.querySelectorAll(".file-actions button")[0].addEventListener("click", openPreview);
      row.querySelectorAll(".file-actions button")[1].addEventListener("click", () =>
        downloadFile(r)
      );

      wrap.appendChild(row);
    });
  });
}

function playSVG() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>`;
}
function eyeSVG() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function downloadSVG() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
}

function downloadFile(r) {
  const a = document.createElement("a");
  a.href = r.url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function showPreview(url) {
  const modal = $("previewModal");
  const video = $("previewVideo");
  video.src = url;
  modal.hidden = false;
  video.play().catch(() => {});
}

function hidePreview() {
  const modal = $("previewModal");
  const video = $("previewVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  modal.hidden = true;
}

/* =========================================================
   DOWNLOAD ALL (ZIP)
   ========================================================= */
function loadJSZipLazy() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js";
    script.onload = () => resolve(window.JSZip);
    script.onerror = () => reject(new Error("Failed to load ZIP library"));
    document.head.appendChild(script);
  });
}

async function downloadAllZip(triggerBtn) {
  if (state.results.length === 0) return;
  const originalText = triggerBtn.innerHTML;
  triggerBtn.disabled = true;
  triggerBtn.textContent = "Building ZIP…";

  try {
    const JSZip = await loadJSZipLazy();
    const zip = new JSZip();
    const root = zip.folder("Fitra-Export");

    const byPlatform = groupResultsByPlatform();
    Object.entries(byPlatform).forEach(([key, items]) => {
      const folder = root.folder(PLATFORMS[key].name.replace(/\s+/g, "-"));
      items.forEach((r) => folder.file(r.filename, r.blob));
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeBaseName(state.file ? state.file.name : "fitra")}-export.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    showToast("Couldn't build the ZIP file. Please try again.", true);
  } finally {
    triggerBtn.disabled = false;
    triggerBtn.innerHTML = originalText;
  }
}

/* =========================================================
   START OVER
   ========================================================= */
function startOver() {
  state.results.forEach((r) => r.url && URL.revokeObjectURL(r.url));
  state.results = [];
  state.selected = new Set();
  state.activeFilter = "all";
  resetVideoSelection(true);
  showScreen("screen-home");
}

/* =========================================================
   WIRE UP EVENTS
   ========================================================= */
function initEvents() {
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back));
  });

  $("prepareBtn").addEventListener("click", () => {
    if (state.selected.size === 0) return;
    runProcessing();
  });

  $("cancelBtn").addEventListener("click", cancelProcessing);

  $("downloadAllBtn").addEventListener("click", (e) => downloadAllZip(e.currentTarget));
  $("downloadAllBtn2").addEventListener("click", (e) => downloadAllZip(e.currentTarget));

  $("viewFilesBtn").addEventListener("click", () => {
    state.activeFilter = "all";
    renderFileFilters();
    renderFileGroups();
    showScreen("screen-files");
  });

  $("startOverBtn").addEventListener("click", startOver);

  $("previewClose").addEventListener("click", hidePreview);
  $("previewBackdrop").addEventListener("click", hidePreview);
}

/* =========================================================
   INIT
   ========================================================= */
function init() {
  initTheme();
  initHome();
  initEvents();
  showScreen("screen-home");
}

document.addEventListener("DOMContentLoaded", init);