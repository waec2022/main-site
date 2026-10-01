/* ==========================================================
   CAMPUS GUIDE — static frontend, no backend.
   Content lives in /data/*.json, edited directly on GitHub by
   trusted staff. This script only reads that data — it never
   writes anything back.
   ========================================================== */

const DATA_FILES = {
  lecturer: "data/lecturers.json",
  course: "data/courses.json",
  department: "data/departments.json",
  faculty: "data/faculties.json",
  building: "data/buildings.json",
  office: "data/offices.json",
  service: "data/services.json",
};

const ENTITY_LABELS = {
  lecturer: "Lecturers",
  course: "Courses",
  department: "Departments",
  faculty: "Faculties",
  building: "Buildings",
  office: "Offices",
  service: "Services",
};

// How to turn one record into (a) the text searched against and
// (b) the line shown in a result row / page title.
const DISPLAY = {
  lecturer: (r) => r.name,
  course: (r) => `${r.code} — ${r.title}`,
  department: (r) => r.name,
  faculty: (r) => r.name,
  building: (r) => r.name,
  office: (r) => r.name,
  service: (r) => r.name,
};

/* ----------------------------------------------------------
   Fuzzy search utility — exact > word match > partial > typo
   tolerant. Pure functions, no dependency on how data was fetched.
   ---------------------------------------------------------- */

function normalize(str) {
  return str.toLowerCase().trim().replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function matchScore(query, target) {
  const q = normalize(query);
  const t = normalize(target);
  if (!q || !t) return 0;
  if (t === q) return 4;
  if (t.includes(q) || q.includes(t)) return 3;

  const qWords = q.split(" ");
  const tWords = t.split(" ");
  if (qWords.some((w) => tWords.some((tw) => tw.includes(w) || w.includes(tw)))) return 2;

  const tolerance = Math.max(1, Math.floor(t.length * 0.25));
  if (levenshtein(q, t) <= tolerance) return 1;

  return 0;
}

/* ----------------------------------------------------------
   App state
   ---------------------------------------------------------- */

const state = {
  theme: localStorage.getItem("campus-guide-theme") || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
  view: "home",
  query: "",
  activeFilter: "all",
  results: null,
  selected: null, // { type, id }
  data: null,     // filled once loaded
  notifications: [],
};

const root = document.getElementById("app");

/* ----------------------------------------------------------
   Data loading — fetched once, kept in memory. This is a
   university directory, not a huge dataset, so loading it once
   is simpler and still fast; nothing here invents records.
   ---------------------------------------------------------- */

async function loadData() {
  const entries = Object.entries(DATA_FILES);
  const responses = await Promise.all(entries.map(([, path]) => fetch(path).then((r) => r.json())));
  const data = {};
  entries.forEach(([type], i) => { data[type] = responses[i]; });
  state.data = data;
}

async function loadNotifications() {
  try {
    const res = await fetch("data/notifications.json", { cache: "no-store" });
    state.notifications = await res.json();
  } catch {
    state.notifications = [];
  }
  render();
}

function getActiveNotifications() {
  const now = Date.now();
  return (state.notifications || []).filter((n) => new Date(n.expiresAt).getTime() > now);
}

/* ----------------------------------------------------------
   Search
   ---------------------------------------------------------- */

function performSearch(term) {
  const trimmed = term.trim();
  if (!trimmed) {
    state.view = "home";
    state.results = null;
    render();
    return;
  }

  const combined = {};
  let total = 0;
  Object.keys(DATA_FILES).forEach((type) => {
    const rows = (state.data[type] || [])
      .map((r) => ({ id: r.id, label: DISPLAY[type](r), score: matchScore(trimmed, DISPLAY[type](r)) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    combined[type] = rows;
    total += rows.length;
  });

  state.results = combined;
  state.view = "search";
  state.resultsStatus = total > 0 ? "results" : "no-results";
  render();
}

let debounceId = null;
function onSearchInput(value) {
  state.query = value;
  clearTimeout(debounceId);
  debounceId = setTimeout(() => performSearch(value), 350);
}

/* ----------------------------------------------------------
   Rendering — each view returns an HTML string; render() swaps
   #app's content and re-attaches the handful of event listeners
   that view needs. Simple innerHTML re-render is plenty fast for
   a directory this size — no framework needed.
   ---------------------------------------------------------- */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderHeader() {
  return `
    <header class="header">
      <button type="button" class="brand-mark" id="go-home">CAMPUS<span class="brand-accent">GUIDE</span></button>
      <div class="header-actions">
        <span class="verified-badge">Verified Information</span>
        <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">${state.theme === "dark" ? "☀" : "☾"}</button>
      </div>
    </header>
  `;
}

function renderNotificationBanner() {
  const active = getActiveNotifications();
  if (active.length === 0) return "";
  return `
    <div class="notification-banner">
      ${active.map((n) => `<p class="notification-message">${escapeHtml(n.message)}</p>`).join("")}
    </div>
  `;
}

const HOME_PLACEHOLDERS = [
  "Ask anything about your campus...",
  "Search a lecturer...",
  "Search a course...",
  "Find an office...",
];
let placeholderIndex = 0;
let placeholderTimer = null;

function renderHome() {
  return `
    <main class="search-stage">
      <div class="orb" aria-hidden="true"></div>
      <h1 class="hero-title">Your campus.<span class="accent">Any answer.</span></h1>
      <p class="hero-subtitle">Search for lecturers, courses, offices, departments and everything about your university.</p>
      <form class="search-form" id="home-search-form">
        <div class="search-shell">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input type="text" class="search-input" id="home-search-input" placeholder="${HOME_PLACEHOLDERS[placeholderIndex]}"
            value="${escapeHtml(state.query)}" autocomplete="off" spellcheck="false" aria-label="Search Campus Guide" />
          <button type="submit" class="search-button" aria-label="Search">→</button>
        </div>
      </form>
      <div class="try-searching">
        <p class="try-searching-label">Try searching:</p>
        <div class="chip-row">
          <button type="button" class="suggestion-chip" data-chip="Who teaches CSC 201?">Who teaches CSC 201?</button>
          <button type="button" class="suggestion-chip" data-chip="Where is the Bursary?">Where is the Bursary?</button>
          <button type="button" class="suggestion-chip" data-chip="Find Computer Science lecturers">Find Computer Science lecturers</button>
        </div>
      </div>
    </main>
  `;
}

const FILTERS = ["all", "office", "lecturer", "course", "department", "faculty", "building", "service"];
const FILTER_LABELS = { all: "All", office: "Offices", lecturer: "Lecturers", course: "Courses", department: "Departments", faculty: "Faculties", building: "Buildings", service: "Services" };

function renderSearchResults() {
  const tabs = FILTERS.map(
    (f) => `<button type="button" class="filter-tab ${state.activeFilter === f ? "is-active" : ""}" data-filter="${f}">${FILTER_LABELS[f]}</button>`
  ).join("");

  let body;
  if (state.resultsStatus === "no-results") {
    body = `<div class="card"><div class="empty-state">
      <p class="empty-state-title">No verified information found</p>
      <p class="empty-state-message">We couldn't find published information matching "${escapeHtml(state.query)}". Try a different search.</p>
    </div></div>`;
  } else {
    const groups = Object.entries(state.results)
      .filter(([type]) => state.activeFilter === "all" || state.activeFilter === type)
      .filter(([, rows]) => rows.length > 0)
      .map(
        ([type, rows]) => `
          <div class="card result-group">
            <p class="detail-section-title">${ENTITY_LABELS[type]}</p>
            <ul class="result-list">
              ${rows.map((r) => `<li><button type="button" class="result-row" data-select="${type}:${r.id}">${escapeHtml(r.label)}</button></li>`).join("")}
            </ul>
          </div>`
      )
      .join("");
    body = groups || `<div class="card"><div class="empty-state"><p class="empty-state-title">Nothing in this category</p></div></div>`;
  }

  return `
    <div class="results-page">
      <form class="search-form" id="results-search-form">
        <div class="search-shell">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input type="text" class="search-input" id="results-search-input" placeholder="Search a lecturer, course, office, department..."
            value="${escapeHtml(state.query)}" autocomplete="off" aria-label="Search Campus Guide" />
          ${state.query ? `<button type="button" class="search-clear" id="clear-search" aria-label="Clear search">×</button>` : ""}
          <button type="submit" class="search-button" aria-label="Search">→</button>
        </div>
      </form>
      <div class="filter-tabs" role="tablist">${tabs}</div>
      <div class="results-groups">${body}</div>
    </div>
  `;
}

function renderDetail() {
  const { type, id } = state.selected;
  const record = (state.data[type] || []).find((r) => r.id === id);

  if (!record) {
    return `
      <div class="detail-page">
        <button type="button" class="back-link" id="back-to-search">← Back to search</button>
        <div class="card"><div class="empty-state">
          <p class="empty-state-title">No verified information found</p>
          <p class="empty-state-message">This ${type} page will appear here once it has been published.</p>
        </div></div>
      </div>`;
  }

  const fieldRows = Object.entries(record)
    .filter(([key]) => !["id", "name", "code", "title", "courses", "lecturers", "departments", "offices", "services"].includes(key))
    .filter(([, value]) => value)
    .map(([key, value]) => `
      <div>
        <p class="field-label">${escapeHtml(key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()))}</p>
        <p class="field-value">${escapeHtml(value)}</p>
      </div>`)
    .join("");

  const listFields = ["courses", "lecturers", "departments", "offices", "services"]
    .filter((key) => Array.isArray(record[key]) && record[key].length > 0)
    .map(
      (key) => `
        <div class="card">
          <p class="detail-section-title">${key.charAt(0).toUpperCase() + key.slice(1)}</p>
          <div class="chip-row">${record[key].map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>
        </div>`
    )
    .join("");

  return `
    <div class="detail-page">
      <button type="button" class="back-link" id="back-to-search">← Back to search</button>
      <div class="detail-header">
        <h1 class="detail-name">${escapeHtml(DISPLAY[type](record))}</h1>
      </div>
      <div class="card"><div class="field-grid">${fieldRows}</div></div>
      ${listFields}
    </div>
  `;
}

/* ----------------------------------------------------------
   Main render + event wiring
   ---------------------------------------------------------- */

function render() {
  document.documentElement.setAttribute("data-theme", state.theme);

  let viewHtml = "";
  if (state.view === "home") viewHtml = renderHome();
  else if (state.view === "search") viewHtml = renderSearchResults();
  else if (state.view === "detail") viewHtml = renderDetail();

  const showBanner = state.view === "home" || state.view === "search";

  root.innerHTML = `
    <div class="page">
      ${renderHeader()}
      ${showBanner ? renderNotificationBanner() : ""}
      ${viewHtml}
    </div>
  `;

  attachHandlers();
}

function attachHandlers() {
  document.getElementById("go-home")?.addEventListener("click", () => {
    state.view = "home";
    state.query = "";
    render();
  });

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("campus-guide-theme", state.theme);
    render();
  });

  const homeForm = document.getElementById("home-search-form");
  if (homeForm) {
    const input = document.getElementById("home-search-input");
    homeForm.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(debounceId); performSearch(input.value); });
    input.addEventListener("input", (e) => onSearchInput(e.target.value));
    document.querySelectorAll(".suggestion-chip").forEach((chip) => {
      chip.addEventListener("click", () => { const term = chip.dataset.chip; state.query = term; performSearch(term); });
    });
  }

  const resultsForm = document.getElementById("results-search-form");
  if (resultsForm) {
    const input = document.getElementById("results-search-input");
    resultsForm.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(debounceId); performSearch(input.value); });
    input.addEventListener("input", (e) => onSearchInput(e.target.value));
    document.getElementById("clear-search")?.addEventListener("click", () => { state.query = ""; performSearch(""); state.view = "search"; state.resultsStatus = "no-results"; render(); });
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => { state.activeFilter = tab.dataset.filter; render(); });
    });
    document.querySelectorAll("[data-select]").forEach((row) => {
      row.addEventListener("click", () => {
        const [type, id] = row.dataset.select.split(":");
        state.selected = { type, id };
        state.view = "detail";
        render();
      });
    });
  }

  document.getElementById("back-to-search")?.addEventListener("click", () => {
    state.view = "search";
    render();
  });
}

/* ----------------------------------------------------------
   Startup
   ---------------------------------------------------------- */

async function init() {
  render(); // show something immediately while data loads
  await loadData();
  render();
  await loadNotifications();
  setInterval(loadNotifications, 60000); // periodic check — no push/Realtime without a backend

  // Rotate the home placeholder only while idle on the home screen.
  placeholderTimer = setInterval(() => {
    if (state.view === "home" && !state.query) {
      placeholderIndex = (placeholderIndex + 1) % HOME_PLACEHOLDERS.length;
      const input = document.getElementById("home-search-input");
      if (input) input.placeholder = HOME_PLACEHOLDERS[placeholderIndex];
    }
  }, 2800);
}

init();
