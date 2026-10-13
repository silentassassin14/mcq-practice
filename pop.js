"use strict";

/* How the list of quiz files is found (no extra steps for you – just upload .json files to the repo folder):
   1. GitHub: the page asks GitHub which .json files are in this folder of the repo. The owner / repo are
      worked out from the site address (https://OWNER.github.io/REPO/). Only fill GH below if you use a
      custom domain or the auto-detection is wrong.
   2. files.json (optional manual list) if GitHub cannot be asked.
   3. questions.json as a last resort. */
const GH = { owner: "silentassassin14", repo: "mcq-practice", path: "", branch: "main" };   // e.g. { owner: "don", repo: "mcq", path: "", branch: "main" }
const FOLDER = "qp";   // quiz files live in this folder, next to index.html and app.js
const RAW_BASE = "https://raw.githubusercontent.com/" + GH.owner + "/" + GH.repo + "/" + GH.branch + "/";   // where new files are downloaded from
const CACHE_PREFIX = "mcq_cache:";    // saved copies of downloaded files (used when offline)
const LIST_CACHE_KEY = "mcq_filelist_saved";   // saved list of quiz file names (used when offline)
const MANIFEST_URL = "files.json";   // optional, also inside the qp folder
const FALLBACK_FILE = "questions.json";
const SKIP_FILES = ["files.json", "package.json", "package-lock.json", "manifest.json", "tsconfig.json", "composer.json"];
const LAST_FILE_KEY = "mcq_last_file";
let availableFiles = [];                  // every quiz file found, e.g. ["oceanography.json", "physics.json"]
let currentFile = "";                     // the file the person has chosen

/* ───────── Config ───────── */
const LETTERS = ["A", "B", "C", "D"];
/* Settings come from the iframe tag on the blog page (data-user, data-pass, data-title, data-blog).
   These defaults are only used when this file is opened on its own for testing. */
const CFG = (function () {
  const d = { user: "admin", pass: "admin123", title: "mcq-data", blog: "https://doninternationalwebsite.blogspot.com" };
  try {
    const ds = window.frameElement && window.frameElement.dataset;
    if (ds) {
      if (ds.user) d.user = ds.user;
      if (ds.pass) d.pass = ds.pass;
      if (ds.title) d.title = ds.title;
      if (ds.blog) d.blog = ds.blog.replace(/\/+$/, "");
    }
  } catch (e) { /* not inside an iframe */ }
  return d;
})();
const DRAFT_KEY = "mcq_blogger_draft_v1";
const draftKey = () => DRAFT_KEY + ":" + currentFile;   // one draft per file
const SESSION_KEY = "mcq_admin_session";
const NAV_USER = [["Dashboard", "dashboard"], ["View Questions", "view"], ["Take Quiz", "quiz"]];
const NAV_ADMIN = [
  ["Dashboard", "dashboard"], ["Publish to Blog", "publish"], ["Add Question", "add"], ["Edit Question", "edit"],
  ["Delete Question", "delete"], ["View Questions", "view"], ["Take Quiz", "quiz"],
];

/* ───────── State ───────── */
let questions = [];          // what this person is looking at (live list, or the admin's working copy)
let blogList = [];           // the list currently live on the blog
let draft = null;            // admin's unpublished working copy
let bankInfo = null;         // {updated, count, name}
let loadState = "loading";   // loading | ready | empty | error | nodb
let loadError = "";
let isAdmin = false;
let current = "dashboard";
let quiz = freshQuiz();
let pending = null;

function freshQuiz() {
  return { active: false, results: false, retest: false, list: [], idx: 0, score: 0,
           wrong: [], details: [], opts: null, answered: false, chosen: "" };
}

/* ───────── Helpers ───────── */
const $ = (s, r = document) => r.querySelector(s);
const page = $("#page");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sortById = arr => [...arr].sort((a, b) => a.id - b.id);
const nextId = () => questions.length ? Math.max(...questions.map(q => q.id)) + 1 : 1;
const findQ = id => questions.find(q => q.id === id) || null;
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtDate = iso => { try { return new Date(iso).toLocaleString(); } catch (e) { return ""; } };
const errText = e => (e && e.message) ? e.message : "Something went wrong.";

function toast(msg, kind = "info") {
  const t = $("#toast");
  t.className = "toast show " + kind;
  t.textContent = msg;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = "toast"; }, 3600);
}

const header = (title, sub) =>
  `<h2 class="title">${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : `<div style="height:16px"></div>`}`;
const notice = (text, kind = "info") => `<div class="notice ${kind}">${esc(text)}</div>`;

/* ───────── Rich text for passages and questions (NEW) ─────────
   Plain lines become paragraphs. Lines that start with "|" become a table, e.g.
       | List-I        | List-II          |
       |---------------|------------------|
       | A. SDG 5      | 2. Gender Equality |
   Everything is escaped, so the JSON can never inject HTML. */
const hasTable = t => /^\s*\|/m.test(String(t));
function richText(text) {
  const isSep = r => r.every(c => /^:?-{2,}:?$/.test(c));
  let out = "", para = [], rows = [];
  const flushPara = () => { if (para.length) { out += `<p>${esc(para.join("\n"))}</p>`; para = []; } };
  const flushRows = () => {
    if (!rows.length) return;
    const head = rows.length > 1 && isSep(rows[1]);
    const body = rows.filter(r => !isSep(r));
    out += `<div class="tscroll"><table class="ptable">` + body.map((r, i) =>
      `<tr>${r.map(c => i === 0 && head ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join("")}</tr>`).join("") + `</table></div>`;
    rows = [];
  };
  String(text).replace(/\r/g, "").split("\n").forEach(line => {
    const t = line.trim();
    if (t.startsWith("|")) { flushPara(); rows.push(t.replace(/^\||\|$/g, "").split("|").map(c => c.trim())); }
    else { flushRows(); if (t === "") flushPara(); else para.push(line); }
  });
  flushPara(); flushRows();
  return out;
}
/* Question text: unchanged markup for plain questions, table-aware only when a "|" row is present */
const questionHtml = t => hasTable(t)
  ? `<div class="qbig qrich rich">${richText(t)}</div>`
  : `<p class="qbig">${esc(t)}</p>`;

function qcard(q, showAnswer = true) {
  const opts = LETTERS.map(l => {
    const ok = showAnswer && l === q.answer;
    return `<div class="${ok ? "correct" : ""}">${l}. ${esc(q.options[l])}${ok ? "  ✓" : ""}</div>`;
  }).join("");
  return `<div class="card qcard">
    <div class="qtop"><span class="qid">ID #${q.id}${q.group ? ` · Set ${esc(q.group)}` : ""}</span>${showAnswer ? `<span class="badge">Answer: ${q.answer}</span>` : ""}</div>
    ${hasTable(q.question) ? `<div class="qtext qrich rich">${richText(q.question)}</div>` : `<div class="qtext">${esc(q.question)}</div>`}
    ${q.passage ? `<details class="qpassage"><summary>Show passage</summary><div class="rich">${richText(q.passage)}</div></details>` : ""}
    <div class="qopts">${opts}</div></div>`;
}

const metric = (v, c, color) => `<div class="metric"><div class="v" style="color:${color}">${esc(v)}</div><div class="c">${esc(c)}</div></div>`;
const idOptions = () => sortById(questions).map(q => `<option value="${q.id}">ID ${q.id}</option>`).join("");
const optionInputs = (prefix, starred) => LETTERS.map(l =>
  `<div class="cell"><small>${l}${starred ? " *" : ""}</small><input type="text" id="${prefix}${l}" autocomplete="off"></div>`).join("");


/* ───────── Validation ───────── */
function normalize(data) {
  if (!Array.isArray(data) && data && Array.isArray(data.questions)) data = data.questions;
  if (!Array.isArray(data)) throw new Error("The file must contain a list of questions.");

  /* Step 1 (NEW) – flatten passage sets.
     A set looks like  { "passage": "...", "title": "...", "questions": [ {question, options, answer}, ... ] }
     and becomes several ordinary questions that share the same `group` id and `passage`.
     Ordinary questions pass through untouched, so the old format keeps working. */
  const flat = [];
  data.forEach((item, i) => {
    const n = i + 1;
    if (item && typeof item === "object" && Array.isArray(item.questions)) {
      if (typeof item.passage !== "string" || !item.passage.trim()) throw new Error(`Item ${n} is a passage set, so it needs "passage" text.`);
      if (!item.questions.length) throw new Error(`Item ${n} is a passage set with no questions inside it.`);
      const group = String(item.group !== undefined ? item.group : "set" + n);
      item.questions.forEach((sub, j) => {
        const extra = { group, passage: item.passage };
        if (typeof item.title === "string" && item.title.trim()) extra.passageTitle = item.title;
        flat.push({ label: `Item ${n} (question ${j + 1} of the set)`, q: (sub && typeof sub === "object") ? { ...sub, ...extra } : sub });
      });
    } else flat.push({ label: `Item ${n}`, q: item });
  });

  /* Step 2 – the original checks. Missing ids are filled in without clashing with explicit ones. */
  const used = new Set(flat.filter(f => f.q && f.q.id !== undefined).map(f => Number(f.q.id)));
  const list = flat.map(({ label, q }, k) => {
    if (!q || typeof q !== "object") throw new Error(`${label} is not a question object.`);
    if (typeof q.question !== "string" || !q.question.trim()) throw new Error(`${label} has no "question" text.`);
    if (!q.options || LETTERS.some(l => typeof q.options[l] !== "string")) throw new Error(`${label} needs options A, B, C and D.`);
    if (!LETTERS.includes(q.answer)) throw new Error(`${label} needs an "answer" of A, B, C or D.`);
    if (q.passage !== undefined && typeof q.passage !== "string") throw new Error(`${label} has a "passage" that is not text.`);
    let id;
    if (q.id !== undefined) id = Number(q.id);
    else { id = k + 1; while (used.has(id)) id++; used.add(id); }
    const out = { ...q, id };
    if (out.group !== undefined && out.group !== null && String(out.group) !== "") out.group = String(out.group);
    else delete out.group;
    return out;
  });

  /* Step 3 (NEW) – flat files may repeat `group` and give the passage only once: share it with the whole group. */
  const info = new Map();
  list.forEach(q => { if (q.group && q.passage && !info.has(q.group)) info.set(q.group, { passage: q.passage, title: q.passageTitle }); });
  list.forEach(q => {
    const g = q.group && info.get(q.group);
    if (!g) return;
    if (!q.passage) q.passage = g.passage;
    if (q.passage === g.passage && !q.passageTitle && g.title) q.passageTitle = g.title;
  });
  return list;
}


/* Shown on pages that need questions when none are available */
function bankProblem() {
  if (loadState === "loading") return notice("Loading the question bank…", "info");
  if (loadState === "error") return notice("Could not load the question bank. " + loadError, "error");
  if (loadState === "nodb") return notice("The blog data is not available in this view. Open the blog page, or load a file from the sidebar.", "warn");
  return notice(isAdmin
    ? "No questions are live on the blog yet. Add some, then use Publish to Blog."
    : "No questions have been published yet. Please check back soon.", "info");
}

/* ───────── Draft storage (admin only) ───────── */
function getDraft() { try { const s = localStorage.getItem(draftKey()); return s ? normalize(JSON.parse(s)) : null; } catch (e) { return null; } }
function setDraft(list) { try { localStorage.setItem(draftKey(), JSON.stringify(list)); } catch (e) {} }
function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (e) {} }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function applyWorking() { questions = (isAdmin && draft) ? draft : blogList; }

/* ───────── Load the live list from the blog ───────── */
function blogBase() {
  if (CFG.blog) return CFG.blog;
  try { const o = window.parent.location.origin; if (o && /^https?:/.test(o)) return o; } catch (e) {}
  return "";
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "__mcq_cb" + Date.now();
    const s = document.createElement("script");
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error("The blog did not respond in time.")); }, 15000);
    window[cb] = d => { done(); resolve(d); };
    s.onerror = () => { done(); reject(new Error("Could not reach the blog feed.")); };
    s.src = url + "&callback=" + cb;
    document.head.appendChild(s);
  });
}

/* Work out where this site lives on GitHub: returns a list of {owner, repo, path} guesses */
const sub = base => [base, FOLDER].filter(Boolean).join("/");   // adds the qp folder to a path
function ghCandidates() {
  if (GH.owner && GH.repo) return [{ owner: GH.owner, repo: GH.repo, path: sub(GH.path || "") }];
  const host = location.hostname.toLowerCase();
  if (!host.endsWith(".github.io")) return [];
  const owner = host.split(".")[0];
  const seg = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (seg.length && seg[seg.length - 1].includes(".")) seg.pop();          // drop index.html
  const list = [];
  if (seg.length) list.push({ owner, repo: seg[0], path: sub(seg.slice(1).join("/")) });   // project site
  list.push({ owner, repo: owner + ".github.io", path: sub(seg.join("/")) });              // user site
  return list;
}

/* Download a file from GitHub and keep a copy on the phone.
   Order: 1) GitHub (latest)  2) the copy saved last time  3) the copy bundled inside the app.
   Returns { data, source } where source is "online", "saved" or "bundled". */
async function loadJSON(path) {
  const key = CACHE_PREFIX + path;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);          // give up after 8 seconds
    const res = await fetch(RAW_BASE + path.split("/").map(encodeURIComponent).join("/") + "?t=" + Date.now(),
                            { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const data = JSON.parse(text);                                // make sure it is valid JSON
    try { localStorage.setItem(key, text); } catch (e) { /* storage full: still use the fresh data */ }
    return { data, source: "online" };
  } catch (err) {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return { data: JSON.parse(saved), source: "saved" };
    } catch (e) {}
    const res = await fetch(path.split("/").map(encodeURIComponent).join("/"));   // file bundled in the app
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { data: await res.json(), source: "bundled" };
  }
}

async function listFromGitHub() {
  for (const c of ghCandidates()) {
    const cacheKey = "mcq_gh_" + [c.owner, c.repo, c.path, GH.branch].join("/");
    try {
      const hit = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.list;       // keeps GitHub's hourly limit safe
    } catch (e) {}
    try {
      const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path.split("/").map(encodeURIComponent).join("/")}` +
                  (GH.branch ? `?ref=${encodeURIComponent(GH.branch)}` : "");
      const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) continue;
      const items = await res.json();
      if (!Array.isArray(items)) continue;
      const list = items.filter(i => i.type === "file").map(i => i.name);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), list })); } catch (e) {}
      try { localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(list)); } catch (e) {}   // keep for offline use
      return list;
    } catch (e) { /* try the next guess */ }
  }
  return [];
}

async function listFromManifest() {
  try {
    const res = await fetch(FOLDER + "/" + MANIFEST_URL + "?t=" + Date.now());
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data && Array.isArray(data.files) ? data.files : []);
  } catch (e) { return []; }
}

/* Find every quiz file in the folder */
async function discoverFiles() {
  let list = await listFromGitHub();
  if (!list.some(n => /\.json$/i.test(n))) {          // offline or GitHub unreachable: use the list saved last time
    try { list = JSON.parse(localStorage.getItem(LIST_CACHE_KEY) || "[]"); } catch (e) { list = []; }
  }
  if (!list.some(n => /\.json$/i.test(n))) list = await listFromManifest();   // bundled list (first launch, offline)
  list = [...new Set(list.filter(n => typeof n === "string" && /\.json$/i.test(n) &&
    !SKIP_FILES.includes(n.toLowerCase()) && !/[\/\\]/.test(n)))]
    .sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));
  return list.length ? list : [FALLBACK_FILE];
}

async function loadBlog() {
  loadState = "loading";
  blogList = []; draft = null; applyWorking();
  render();   // show loading state

  if (!availableFiles.length) availableFiles = await discoverFiles();
  if (!availableFiles.includes(currentFile)) {
    let saved = "";
    try { saved = localStorage.getItem(LAST_FILE_KEY) || ""; } catch (e) {}
    currentFile = availableFiles.includes(saved) ? saved : availableFiles[0];
  }
  draft = getDraft();   // the admin's unpublished copy belongs to this file only

  try {
    const { data, source } = await loadJSON(FOLDER + "/" + currentFile);   // online -> saved copy -> bundled copy
    blogList = normalize(data);
    bankInfo = { updated: null, count: blogList.length, name: currentFile, source };
    loadState = blogList.length ? "ready" : "empty";
  } catch (err) {
    blogList = [];
    bankInfo = null;
    loadState = "error";
    loadError = errText(err) + " — Make sure " + currentFile + " is inside the " + FOLDER + " folder next to index.html and is valid JSON.";
  }

  // Clear draft if it matches the live data
  if (draft && blogList.length && same(draft, blogList)) {
    draft = null;
    clearDraft();
  }

  applyWorking();
  render();
}

/* Called when the person picks another file in the drop-down */
function selectFile(name) {
  if (!availableFiles.includes(name) || name === currentFile) return;
  if (quiz.active && !quiz.results && !confirm("Switching files will end the quiz in progress. Continue?")) { updateSide(); return; }
  currentFile = name;
  try { localStorage.setItem(LAST_FILE_KEY, name); } catch (e) {}
  quiz = freshQuiz(); pending = null;
  loadBlog();
}

/* ───────── Admin login ───────── */
function login(user, pass) {
  if (user !== CFG.user || pass !== CFG.pass) return false;
  isAdmin = true;
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
  buildNav(); applyWorking();
  return true;
}
function logout() {
  isAdmin = false;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  quiz = freshQuiz(); pending = null;
  buildNav(); applyWorking(); go("dashboard");
}

/* Edits made by the admin are kept as a working copy until published */
async function commit(list, okMsg) {
  questions = list;
  draft = list;
  setDraft(list);
  updateSide();
  toast(okMsg + " (not live yet — use Publish to Blog)", "success");
  return true;
}

/* ───────── Sidebar / nav ───────── */
function buildNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  (isAdmin ? NAV_ADMIN : NAV_USER).forEach(([label, key]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.page = key;
    b.onclick = () => go(key);
    nav.appendChild(b);
  });
}

function updateSide() {
  let h = isAdmin ? `<span class="role">Admin</span><br>` : "";
  if (availableFiles.length) {
    h += `<label class="lbl" for="fileSel" style="font-size:12px">Question file</label>
      <select id="fileSel" style="width:100%;min-width:0;margin-bottom:10px">${availableFiles.map(f =>
        `<option value="${esc(f)}"${f === currentFile ? " selected" : ""}>${esc(f)}</option>`).join("")}</select>`;
  }
  if (loadState === "nodb") {
    h += `Blog data not available here.${bankInfo && bankInfo.name ? `<br>Using <b>${esc(bankInfo.name)}</b>` : ""}<button class="btn secondary" id="localBtn">Open local JSON file</button>`;
  } else if (bankInfo) {
    h += `<b>${bankInfo.count}</b> question(s) in this file${bankInfo.updated ? `<br>Updated ${esc(fmtDate(bankInfo.updated))}` : ""}`;
  } else if (loadState === "loading") {
    h += "Loading questions…";
  } else {
    h += "No questions published yet.";
  }
  if (isAdmin && draft) h += `<br><b style="color:#fcd34d">Unpublished changes</b>`;
  $("#bankBox").innerHTML = h;
  const fs = $("#fileSel");
  if (fs) fs.onchange = () => selectFile(fs.value);
  const lb = $("#localBtn");
  if (lb) lb.onclick = () => $("#localInput").click();
  $("#authBtn").textContent = isAdmin ? "Log out" : "Admin login";
  $("#total").textContent = `Total Questions: ${questions.length}`;
}

function go(name) { current = name; render(); window.scrollTo(0, 0); }

function render() {
  const allowed = (isAdmin ? NAV_ADMIN : NAV_USER).map(n => n[1]);
  if (!isAdmin) allowed.push("login");
  if (!allowed.includes(current)) current = "dashboard";
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.page === current));
  page.classList.remove("wide");   // NEW: only passage questions use the wide two-column layout (quizActive turns it on)
  PAGES[current]();
  updateSide();
}

/* ───────── Pages ───────── */
const PAGES = {
  dashboard() {
    let h = header("MCQ Practice Software", "Practice with randomized quizzes");
    h += `<div class="metrics">${metric(questions.length, "Questions", "var(--accent)")}${metric("∞", "Practice Mode", "#ffffff")}${metric("✓", "Retest Support", "var(--green)")}</div>`;
    h += `<h3 style="margin-top:0">Quick Actions</h3><div class="actions">
      <button class="btn" id="qaStart" ${questions.length ? "" : "disabled"}>Start Quiz</button>
      <button class="btn secondary" id="qaView">View Bank</button>
      ${isAdmin ? `<button class="btn secondary" id="qaPub">Publish to Blog</button><button class="btn secondary" id="qaAdd">Add New Question</button>` : ""}</div>`;
    if (isAdmin && draft) h += notice("You have unpublished changes. Open Publish to Blog to make them live for everyone.", "warn");
    if (!questions.length) h += bankProblem();
    else h += `<h3>Recent Questions</h3>` + sortById(questions).reverse().slice(0, 3).map(q => qcard(q, false)).join("");
    page.innerHTML = h;
    $("#qaStart").onclick = startFullQuiz;
    $("#qaView").onclick = () => go("view");
    if (isAdmin) { $("#qaPub").onclick = () => go("publish"); $("#qaAdd").onclick = () => go("add"); }
  },

  login() {
    page.innerHTML = header("Admin Login", "For the site owner only") + `
      <div class="field"><label class="lbl" for="lUser">Username</label><input type="text" id="lUser" autocomplete="username"></div>
      <div class="field"><label class="lbl" for="lPass">Password</label><input type="password" id="lPass" autocomplete="current-password"></div>
      <button class="btn block" id="lGo">Log in</button>`;
    const attempt = () => {
      if (login($("#lUser").value.trim(), $("#lPass").value)) { toast("Logged in as admin.", "success"); go("dashboard"); }
      else toast("Wrong username or password.", "error");
    };
    $("#lGo").onclick = attempt;
    $("#lPass").onkeydown = e => { if (e.key === "Enter") attempt(); };
    $("#lUser").onkeydown = e => { if (e.key === "Enter") $("#lPass").focus(); };
  },

  publish() {
    let h = header("Publish to Blog", "Make your changes live for everyone");
    h += `<div class="card infocard"><dl>
      <dt>Live on the blog</dt><dd>${blogList.length ? blogList.length + " question(s)" : "nothing yet"}</dd>
      <dt>Your working copy</dt><dd>${questions.length} question(s)</dd>
      <dt>Unpublished changes</dt><dd>${draft ? "Yes" : "No"}</dd></dl></div>
      <h3>1. Load a JSON file (optional)</h3>
      <p class="muted" style="margin-top:0">Start from a JSON file on this device. It becomes your working copy; nothing goes live yet.</p>
      <input type="file" id="pbFile" accept=".json,application/json" hidden>
      <button class="btn secondary" id="pbPick">Choose JSON file</button><div id="pbPrev"></div>
      <h3>2. Copy the JSON</h3>
      <p class="muted" style="margin-top:0">This copies your working copy in a form that is safe to paste into Blogger.</p>
      <div class="btnrow"><button class="btn" id="pbCopy" ${questions.length ? "" : "disabled"}>Copy JSON for Blogger</button>
      <button class="btn secondary" id="pbDown" ${questions.length ? "" : "disabled"}>Download JSON</button></div>
      <h3>3. Paste it into your blog</h3>
      <ol class="steps">
        <li>In Blogger, go to <b>Pages</b> and open the page titled <b>${esc(CFG.title)}</b>. Create it the first time, and do not add it to your menu.</li>
        <li>Switch to <b>HTML view</b> (the &lt;&gt; button, never Compose view). Select everything, delete it, and paste.</li>
        <li>Click <b>Publish</b> or <b>Update</b>. Visitors get the new questions within a few minutes.</li>
      </ol>`;
    if (draft) h += `<h3>Discard changes</h3><p class="muted" style="margin-top:0">Go back to what is live on the blog.</p><button class="btn danger" id="pbDiscard">Discard unpublished changes</button>`;
    page.innerHTML = h;

    $("#pbPick").onclick = () => $("#pbFile").click();
    $("#pbFile").onchange = async e => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        const list = normalize(JSON.parse(await f.text()));
        if (!list.length) throw new Error("The file has no questions.");
        pending = { name: f.name, list };
      } catch (err) {
        pending = null;
        $("#pbPrev").innerHTML = notice("This file cannot be used. " + (err instanceof SyntaxError ? "It is not valid JSON." : errText(err)), "error");
        return;
      }
      showPending();
    };
    if (pending) showPending();
    $("#pbCopy").onclick = async () => {
      const ok = await copyText(blogSafeJson(questions));
      toast(ok ? "Copied. Now paste it into the blog page (HTML view)." : "Could not copy. Use Download JSON instead.", ok ? "success" : "error");
    };
    $("#pbDown").onclick = downloadJson;
    if (draft) $("#pbDiscard").onclick = e => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Click again to confirm"; return; }
      draft = null; clearDraft(); applyWorking(); toast("Unpublished changes discarded.", "success"); render();
    };
  },

  add() {
    if (loadState === "loading" || loadState === "error") { page.innerHTML = header("Add New Question") + bankProblem(); return; }
    page.innerHTML = header("Add New Question", "Create a new MCQ entry") + `
      <div class="field"><label class="lbl" for="aQ">Question *</label><textarea id="aQ"></textarea></div>
      <div class="field"><label class="lbl">Options</label><div class="grid2">${optionInputs("aO", true)}</div></div>
      <div class="field"><label class="lbl" for="aAns">Correct Answer *</label>
        <select id="aAns">${LETTERS.map(l => `<option>${l}</option>`).join("")}</select></div>
      <button class="btn block" id="aSave">Save Question</button>`;
    $("#aSave").onclick = async () => {
      const question = $("#aQ").value.trim();
      const opts = {};
      LETTERS.forEach(l => { opts[l] = $("#aO" + l).value.trim(); });
      if (!question || !LETTERS.every(l => opts[l])) { toast("Please fill in the question and all four options.", "error"); return; }
      const id = nextId();
      const list = [...questions, { id, question, options: opts, answer: $("#aAns").value }];
      if (await commit(list, `Question added successfully! (ID: ${id})`)) {
        $("#aQ").value = "";
        LETTERS.forEach(l => { $("#aO" + l).value = ""; });
        $("#aAns").selectedIndex = 0;
        updateSide();
      }
    };
  },

  edit() {
    let h = header("Edit Question", "Update an existing MCQ");
    if (!questions.length) { page.innerHTML = h + (bankProblem() || notice("No questions available to edit.", "warn")); return; }
    h += `<div class="field"><label class="lbl" for="eSel">Select Question ID</label><select id="eSel">${idOptions()}</select></div>
      <div class="field"><label class="lbl" for="eQ">Question</label><textarea id="eQ"></textarea></div>
      <div class="field"><label class="lbl">Options</label><div class="grid2">${optionInputs("eO", false)}</div></div>
      <div class="field"><label class="lbl" for="eAns">Correct Answer</label>
        <select id="eAns">${LETTERS.map(l => `<option>${l}</option>`).join("")}</select></div>
      <button class="btn block" id="eSave">Update Question</button>`;
    page.innerHTML = h;
    const load = () => {
      const q = findQ(Number($("#eSel").value));
      if (!q) return;
      $("#eQ").value = q.question;
      LETTERS.forEach(l => { $("#eO" + l).value = q.options[l]; });
      $("#eAns").value = q.answer;
    };
    $("#eSel").onchange = load;
    load();
    $("#eSave").onclick = async () => {
      const id = Number($("#eSel").value);
      const nq = $("#eQ").value.trim();
      const opts = {};
      LETTERS.forEach(l => { opts[l] = $("#eO" + l).value.trim(); });
      if (!nq || !LETTERS.every(l => opts[l])) { toast("The question and all four options must be filled in.", "error"); return; }
      const list = questions.map(q => q.id === id ? { ...q, question: nq, options: opts, answer: $("#eAns").value } : q);
      await commit(list, "Question updated successfully!");
    };
  },

  delete() {
    let h = header("Delete Question", "Permanently remove a question");
    if (!questions.length) { page.innerHTML = h + (bankProblem() || notice("No questions available to delete.", "warn")); return; }
    h += `<div class="field"><label class="lbl" for="dSel">Select Question ID to delete</label><select id="dSel">${idOptions()}</select></div>
      <h3 style="margin-top:0">Preview</h3><div id="dPrev"></div>
      ${notice("This action cannot be undone. It changes the file for every user.", "warn")}
      <label class="check" style="margin:8px 0 12px"><input type="checkbox" id="dConf"><span id="dConfText"></span></label>
      <button class="btn danger block" id="dBtn" disabled>Delete Permanently</button>`;
    page.innerHTML = h;
    const refresh = () => {
      const id = Number($("#dSel").value);
      const q = findQ(id);
      $("#dPrev").innerHTML = q ? qcard(q) : "";
      $("#dConfText").textContent = `I confirm I want to delete Question ID ${id}`;
      $("#dConf").checked = false;
      $("#dBtn").disabled = true;
    };
    $("#dSel").onchange = refresh;
    $("#dConf").onchange = e => { $("#dBtn").disabled = !e.target.checked; };
    $("#dBtn").onclick = async () => {
      const id = Number($("#dSel").value);
      if (await commit(questions.filter(q => q.id !== id), `Question ID ${id} deleted.`)) go("delete");
    };
    refresh();
  },

  view() {
    let h = header("Question Bank", `${questions.length} question(s) stored`);
    if (!questions.length) { page.innerHTML = h + (bankProblem() || notice("No questions yet.", "info")); return; }
    h += `<div class="field"><label class="lbl" for="vSearch">Search questions</label><input type="text" id="vSearch" autocomplete="off"></div>
      <label class="check"><input type="checkbox" id="vAns" checked><span>Show correct answers</span></label>
      <p class="muted" id="vCount" style="margin:8px 0 12px;font-size:13px"></p><div id="vList"></div>`;
    page.innerHTML = h;
    const draw = () => {
      const term = $("#vSearch").value.trim().toLowerCase();
      const list = term ? questions.filter(q => q.question.toLowerCase().includes(term) ||
        LETTERS.some(l => q.options[l].toLowerCase().includes(term))) : questions;
      $("#vCount").textContent = `Showing ${list.length} of ${questions.length}`;
      const show = $("#vAns").checked;
      $("#vList").innerHTML = sortById(list).map(q => qcard(q, show)).join("");
    };
    let t;
    $("#vSearch").oninput = () => { clearTimeout(t); t = setTimeout(draw, 200); };
    $("#vAns").onchange = draw;
    draw();
  },

  quiz() {
    if (!quiz.active && !quiz.results) quizMenu();
    else if (quiz.active && !quiz.results) quizActive();
    else quizResults();
  },
};

/* Admin: preview of a chosen file */
function showPending() {
  if (!pending) return;
  $("#pbPrev").innerHTML = notice(`${pending.name} is valid: ${pending.list.length} question(s) found.`, "success") +
    `<p class="muted" style="margin:10px 0 6px;font-size:13px">First question in the file:</p>${qcard(pending.list[0])}
     <div class="btnrow"><button class="btn" id="pbUse">Use as working copy</button><button class="btn secondary" id="pbCancel">Cancel</button></div>`;
  $("#pbCancel").onclick = () => { pending = null; $("#pbPrev").innerHTML = ""; };
  $("#pbUse").onclick = async () => {
    const p = pending; pending = null;
    await commit(p.list, `${p.name} loaded`);
    render();
  };
}

/* HTML-safe JSON, so it survives being pasted into Blogger's HTML view */
function blogSafeJson(list) {
  return JSON.stringify(list, null, 1).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove();
    return ok;
  }
}
function downloadJson() {
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = currentFile || FALLBACK_FILE;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ───────── Quiz ───────── */
function startQuiz(list, retest) {
  quiz = freshQuiz();
  quiz.active = true;
  quiz.retest = retest;
  quiz.list = shuffleKeepingSets(list);
}

/* NEW: questions of one passage set stay together and in their original order;
   standalone questions and whole sets are shuffled as units (old behaviour for plain questions). */
function shuffleKeepingSets(list) {
  const units = [], byGroup = new Map();
  list.forEach(q => {
    if (!q.group) { units.push([q]); return; }
    if (!byGroup.has(q.group)) { const u = []; byGroup.set(q.group, u); units.push(u); }
    byGroup.get(q.group).push(q);
  });
  return shuffle(units).flat();
}
function startFullQuiz() { startQuiz(questions, false); go("quiz"); }

function quizMenu() {
  let h = header("Take Quiz", "Randomized questions with shuffled options");
  if (!questions.length) { page.innerHTML = h + (bankProblem() || notice("No questions available.", "warn")); return; }
  const sets = new Set(questions.filter(q => q.group).map(q => q.group)).size;   // NEW
  h += notice(`${questions.length} questions ready. Options will be shuffled every time.${sets ? ` ${sets} passage set(s) are kept together.` : ""}`, "info");
  h += `<button class="btn block" id="qStart" style="margin-top:10px">Start Full Quiz</button>`;
  page.innerHTML = h;
  $("#qStart").onclick = startFullQuiz;
}

function shuffleOptions(q) {
  const items = shuffle(Object.entries(q.options));
  const options = {}, map = {};
  items.forEach(([orig, text], i) => { options[LETTERS[i]] = text; map[orig] = LETTERS[i]; });
  return { options, correct: map[q.answer] };
}

function quizActive() {
  const total = quiz.list.length;
  const q = quiz.list[quiz.idx];
  if (!quiz.opts) quiz.opts = shuffleOptions(q);
  const { options, correct } = quiz.opts;
  const done = quiz.answered;

  /* NEW – passage sets: the passage stays visible next to (or above, on phones) every sub-question of its set */
  const hasPassage = !!(q.passage && q.passage.trim());
  let setBadge = "";
  if (q.group) {
    const members = quiz.list.filter(x => x.group === q.group);
    if (members.length > 1) setBadge = `<span class="setbadge">Passage set · part ${members.indexOf(q) + 1} of ${members.length}</span>`;
  }
  /* keep the passage scroll position when Submit / Next re-draw the page inside the same set */
  const oldPanel = page.querySelector(".passage");
  const keepScroll = (hasPassage && oldPanel && oldPanel.dataset.group === String(q.group)) ? oldPanel.scrollTop : 0;

  let h = header("Take Quiz");
  h += `<div class="bar"><div style="width:${total ? (quiz.idx / total) * 100 : 0}%"></div></div>`;

  let body = `<div style="font-weight:bold">Question ${quiz.idx + 1} of ${total}</div>
    <div class="muted" style="font-size:13px;margin-bottom:16px">${quiz.retest ? "Retest mode" : "Full quiz"} &nbsp;•&nbsp; Score so far: ${quiz.score}</div>
    ${setBadge}
    ${questionHtml(q.question)}
    <div class="muted" style="font-size:12px;margin:2px 0 14px">ID: ${q.id}</div>`;

  body += Object.entries(options).map(([l, text]) => {
    let cls = "";
    if (done) cls = l === correct ? " good" : (l === quiz.chosen ? " bad" : "");
    return `<label class="opt${done ? " locked" : ""}${cls}">
      <input type="radio" name="opt" value="${l}" ${done ? "disabled" : ""} ${done && l === quiz.chosen ? "checked" : ""}>
      <span>${l}.&nbsp; ${esc(text)}</span></label>`;
  }).join("");

  body += `<div id="qAction" style="margin-top:14px">`;
  if (!done) {
    body += `<button class="btn block" id="qSubmit">Submit Answer</button>`;
  } else {
    if (quiz.chosen === correct) body += notice(`Correct! The answer is ${correct}. ${options[correct]}`, "success");
    else body += notice(`Wrong. You chose ${quiz.chosen}. ${options[quiz.chosen]}`, "error") +
              notice(`Correct answer: ${correct}. ${options[correct]}`, "info");
    body += quiz.idx + 1 < total
      ? `<button class="btn block" id="qNext" style="margin-top:8px">Next Question  →</button>`
      : `<button class="btn block" id="qFinish" style="margin-top:8px">Finish Quiz</button>`;
  }
  body += `</div>`;

  if (hasPassage) {
    h += `<div class="qlayout">
      <aside class="passage" data-group="${esc(q.group)}" aria-label="Passage">
        <h4>${esc(q.passageTitle || "Passage")}</h4><div class="rich">${richText(q.passage)}</div>
      </aside>
      <div class="qcol">${body}</div></div>`;
  } else {
    h += body;   // plain question: exactly the same markup as before
  }
  page.classList.toggle("wide", hasPassage);
  page.innerHTML = h;
  if (keepScroll) { const np = page.querySelector(".passage"); if (np) np.scrollTop = keepScroll; }

  if (!done) {
    $("#qSubmit").onclick = () => {
      const picked = page.querySelector('input[name="opt"]:checked');
      if (!picked) { toast("Please choose an option first.", "warn"); return; }
      const user = picked.value;
      quiz.answered = true;
      quiz.chosen = user;
      if (user === correct) quiz.score++;
      else {
        quiz.wrong.push(q);
        quiz.details.push({
          id: q.id, question: q.question, passage: q.passage || "",
          yourAnswer: `${user}. ${options[user]}`, correctAnswer: `${correct}. ${options[correct]}`,
        });
      }
      quizActive();
    };
  } else if ($("#qNext")) {
    $("#qNext").onclick = () => { quiz.idx++; quiz.answered = false; quiz.chosen = ""; quiz.opts = null; render(); window.scrollTo(0, 0); };
  } else {
    $("#qFinish").onclick = () => { quiz.active = false; quiz.results = true; render(); window.scrollTo(0, 0); };
  }
}

function quizResults() {
  const total = quiz.list.length, score = quiz.score;
  const pct = total ? (score / total) * 100 : 0;
  let h = header("Take Quiz", "Quiz Results" + (quiz.retest ? " (Retest)" : ""));
  h += `<div class="metrics">${metric(total, "Total", "var(--accent)")}${metric(score, "Correct", "var(--green)")}${metric(total - score, "Wrong", "var(--red)")}${metric(pct.toFixed(1) + "%", "Score", "var(--purple)")}</div>`;
  if (pct === 100) h += notice("Perfect! All correct!", "success");
  else if (pct >= 80) h += notice("Excellent work!", "success");
  else if (pct >= 60) h += notice("Good job! Keep practicing.", "info");
  else h += notice("Keep practicing. You'll improve!", "warn");

  if (quiz.details.length) {
    h += `<h3>Review Wrong Answers</h3>` + quiz.details.map((w, i) => `
      <div class="card wrong-card"><div class="q">${i + 1}. [ID: ${w.id}] ${esc(w.question)}</div>
      <div class="y">Your answer: ${esc(w.yourAnswer)}</div><div class="a">Correct: ${esc(w.correctAnswer)}</div>${w.passage ? `<details class="qpassage"><summary>Show passage</summary><div class="rich">${richText(w.passage)}</div></details>` : ""}</div>`).join("");
    h += `<h3 style="margin-bottom:0">Retest Wrong Questions</h3>
      <p class="muted" style="margin:0 0 8px;font-size:13px">${quiz.wrong.length} question(s) left to master</p>
      <button class="btn block" id="qRetest">Retest Only Wrong Ones</button>`;
  } else if (quiz.retest) {
    h += notice("Congratulations! You corrected all previously wrong questions!", "success");
  }
  h += `<button class="btn secondary block" id="qBack" style="margin-top:14px">Back to Quiz Menu</button>`;
  page.innerHTML = h;

  if ($("#qRetest")) $("#qRetest").onclick = () => { startQuiz(quiz.wrong, true); go("quiz"); };
  $("#qBack").onclick = () => { quiz = freshQuiz(); go("quiz"); };
}

/* ═════════════════════════════════════════════════════════════════════
   KEYBOARD NAVIGATION FOR THE QUIZ  (new code – nothing above this line was changed)

   Keys (only while a question is on screen):
     A / B / C / D  → select that option (case-insensitive)
     ↑ / ↓          → move the highlight (also selects, wraps around)
     Enter / Space  → submit the highlighted option
                      (after answering: go to Next Question / Finish)

   How it hooks into the existing code (no existing function is modified):
     • quiz / current / page ........ existing state + the #page container
     • LETTERS ...................... maps keys to the option letters
     • label.opt (not .locked) ...... the option rows built by quizActive()
     • input[name="opt"] ............ the radio inputs; qSubmit reads :checked
     • #qSubmit / #qNext / #qFinish . existing buttons – we simply .click() them,
                                      so scoring and rendering stay untouched
   ═════════════════════════════════════════════════════════════════════ */
const KB_CLASS = "quiz-option-focused";
let kbAbort = null;   // lets us remove every listener in one call

/* 1) Highlight style, injected once so no .css file needs editing */
function injectKbStyles() {
  if (document.getElementById("quiz-kb-style")) return;
  const st = document.createElement("style");
  st.id = "quiz-kb-style";
  st.textContent = `
    label.opt.${KB_CLASS} {
      outline: 3px solid var(--accent, #38bdf8);
      outline-offset: 2px;
      background: rgba(56, 189, 248, 0.16);
      box-shadow: 0 0 0 5px rgba(56, 189, 248, 0.22), 0 4px 14px rgba(0, 0, 0, 0.25);
      transform: translateX(4px);
      transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
    }
    label.opt.${KB_CLASS} span { font-weight: 600; }
  `;
  document.head.appendChild(st);
}

/* 2) Helpers – the highlight lives only in the DOM, so when quizActive()
      rebuilds the page for the next question it is cleared automatically
      (no stale index, no leftover state). */
const kbOptions = () => [...page.querySelectorAll("label.opt:not(.locked)")];
const kbRadio = label => label.querySelector('input[name="opt"]');

function kbCurrentIndex(labels) {
  let i = labels.findIndex(l => l.classList.contains(KB_CLASS));
  if (i < 0) i = labels.findIndex(l => kbRadio(l) && kbRadio(l).checked);   // e.g. picked with the mouse
  return i;
}

function kbSetFocus(labels, i) {
  labels.forEach((l, n) => l.classList.toggle(KB_CLASS, n === i));
  const label = labels[i];
  if (!label) return;
  const radio = kbRadio(label);
  if (radio) radio.checked = true;            // so the existing #qSubmit handler sees it
  label.scrollIntoView({ block: "nearest" });
}

/* 3) The single key handler */
function onQuizKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (current !== "quiz" || !quiz.active || quiz.results) return;   // quiz screen only

  // Leave typing fields and real buttons/links alone (they handle Enter/Space natively)
  const t = e.target;
  if (t && t.closest && t.closest("textarea, select, button, a, [contenteditable='true'], input:not([type='radio'])")) return;

  const key = e.key;
  const isConfirm = key === "Enter" || key === " " || key === "Spacebar";

  /* Question answered → Enter/Space moves on */
  if (quiz.answered) {
    if (!isConfirm) return;
    e.preventDefault();
    if (e.repeat) return;                       // holding the key must not skip questions
    const next = $("#qNext") || $("#qFinish");
    if (next) next.click();
    return;
  }

  const labels = kbOptions();
  if (!labels.length) return;

  /* A–D */
  if (key.length === 1 && LETTERS.includes(key.toUpperCase())) {
    const i = labels.findIndex(l => kbRadio(l) && kbRadio(l).value === key.toUpperCase());
    if (i >= 0) { e.preventDefault(); kbSetFocus(labels, i); }
    return;
  }

  /* ↑ / ↓ */
  if (key === "ArrowDown" || key === "ArrowUp") {
    e.preventDefault();
    const cur = kbCurrentIndex(labels);
    const step = key === "ArrowDown" ? 1 : -1;
    const next = cur < 0 ? (step === 1 ? 0 : labels.length - 1)
                         : (cur + step + labels.length) % labels.length;
    kbSetFocus(labels, next);
    return;
  }

  /* Enter / Space → reuse the existing Submit button (it shows its own
     "Please choose an option first." toast if nothing is selected) */
  if (isConfirm) {
    e.preventDefault();
    if (e.repeat) return;
    const btn = $("#qSubmit");
    if (btn) btn.click();
  }
}

/* Keep the highlight in sync when the user clicks an option with the mouse */
function onQuizChange(e) {
  if (!e.target || e.target.name !== "opt") return;
  kbOptions().forEach(l => l.classList.toggle(KB_CLASS, l.contains(e.target)));
}

/* 4) Install once; calling it again first removes the old listeners (no duplicates/leaks) */
function installQuizKeyboard() {
  if (kbAbort) kbAbort.abort();
  kbAbort = new AbortController();
  const { signal } = kbAbort;
  injectKbStyles();
  document.addEventListener("keydown", onQuizKey, { signal });
  page.addEventListener("change", onQuizChange, { signal });   // #page is permanent; its children are replaced
  window.addEventListener("pagehide", () => kbAbort && kbAbort.abort(), { once: true, signal });
}

/* ═════════════════════════════════════════════════════════════════════
   LIVE UI LAYER  (new code – purely visual, nothing above was changed)

   Everything here is injected from this file, so index.html and the .css file stay untouched.
   It only ADDS: styles, a living background, micro-interactions, count-up numbers, a score ring,
   confetti, streak/timer HUD, ripples and spotlight hovers. It never edits quiz data or logic.

   How it hooks in (no existing function is modified):
     • a MutationObserver watches #page, which render()/quizActive() replace on every screen
     • it reads the existing state (current, quiz, loadState, bankInfo) but never writes to it
     • every step is wrapped in try/catch – if anything here fails, the app keeps working
   Respects "reduce motion" system settings.
   ═════════════════════════════════════════════════════════════════════ */
function installLiveUI() {
  if (window.__fxInstalled) return;
  window.__fxInstalled = true;

  const mq = q => (window.matchMedia ? window.matchMedia(q).matches : false);
  const reduce = mq("(prefers-reduced-motion: reduce)");
  const finePointer = mq("(pointer: fine)");
  const safe = fn => (...a) => { try { return fn(...a); } catch (e) { console.warn("[live-ui]", e); } };

  /* ───────── 1) Styles ───────── */
  (function injectStyles() {
    if (document.getElementById("fx-style")) return;
    const st = document.createElement("style");
    st.id = "fx-style";
    st.textContent = `
    @keyframes fx-rise{from{opacity:0;translate:0 22px;scale:.985}to{opacity:1;translate:0 0;scale:1}}
    @keyframes fx-slide{from{opacity:0;translate:26px 0}to{opacity:1;translate:0 0}}
    @keyframes fx-pop{0%{opacity:0;scale:.88}60%{opacity:1;scale:1.035}100%{opacity:1;scale:1}}
    @keyframes fx-shake{0%,100%{translate:0 0}18%{translate:-9px 0}36%{translate:8px 0}54%{translate:-6px 0}72%{translate:4px 0}}
    @keyframes fx-ring-good{0%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}100%{box-shadow:0 0 0 20px rgba(52,211,153,0)}}
    @keyframes fx-ring-bad{0%{box-shadow:0 0 0 0 rgba(248,113,113,.55)}100%{box-shadow:0 0 0 20px rgba(248,113,113,0)}}
    @keyframes fx-bump{0%{scale:1}40%{scale:1.2}100%{scale:1}}
    @keyframes fx-flow{from{background-position:0% 50%}to{background-position:100% 50%}}
    @keyframes fx-sheen{from{background-position:220% 0,0 0}to{background-position:-120% 0,0 0}}
    @keyframes fx-rip{to{transform:scale(1);opacity:0}}
    @keyframes fx-ping{0%{box-shadow:0 0 0 0 rgba(52,211,153,.6)}80%,100%{box-shadow:0 0 0 9px rgba(52,211,153,0)}}
    @keyframes fx-toast{from{opacity:0;translate:0 16px;scale:.92}to{opacity:1;translate:0 0;scale:1}}
    @keyframes fx-wave{0%,100%{rotate:0deg}20%{rotate:16deg}40%{rotate:-8deg}60%{rotate:14deg}80%{rotate:-4deg}}
    @keyframes fx-load{0%{background-position:-200% 0}100%{background-position:200% 0}}

    /* background layers */
    .fx-bg{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}
    .fx-cursor{position:fixed;left:0;top:0;width:520px;height:520px;margin:-260px 0 0 -260px;border-radius:50%;pointer-events:none;z-index:0;
      background:radial-gradient(circle,color-mix(in srgb,var(--accent,#38bdf8) 13%,transparent),transparent 62%);opacity:0;transition:opacity .45s;will-change:transform}
    .fx-scroll{position:fixed;top:0;left:0;height:3px;width:100%;transform-origin:0 50%;transform:scaleX(0);z-index:70;pointer-events:none;
      background:linear-gradient(90deg,var(--accent,#38bdf8),var(--purple,#a78bfa),var(--green,#34d399));box-shadow:0 0 12px var(--accent,#38bdf8)}
    .fx-confetti{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999}

    /* headings */
    body .title{background:linear-gradient(90deg,var(--accent,#38bdf8),var(--purple,#a78bfa),var(--green,#34d399),var(--accent,#38bdf8));
      background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;
      animation:fx-flow 7s linear infinite;letter-spacing:-.01em}
    .fx-greet{font-size:13px;opacity:.75;margin-bottom:4px;letter-spacing:.02em}
    .fx-greet i{display:inline-block;font-style:normal;transform-origin:70% 70%;animation:fx-wave 2.4s ease-in-out 1}

    /* glass surfaces */
    body .card,body .metric{background-color:color-mix(in srgb,currentColor 5%,transparent);
      background-image:radial-gradient(260px circle at var(--mx,50%) var(--my,-60%),color-mix(in srgb,var(--accent,#38bdf8) 15%,transparent),transparent 70%);
      -webkit-backdrop-filter:blur(10px) saturate(130%);backdrop-filter:blur(10px) saturate(130%);border-radius:16px;
      box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 12%,transparent),0 12px 34px -20px rgba(0,0,0,.5);
      transition:translate .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease,background-color .25s ease}
    body .card:hover,body .metric:hover{translate:0 -3px;
      box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent,#38bdf8) 38%,transparent),0 20px 44px -22px rgba(0,0,0,.6),0 0 30px -14px var(--accent,#38bdf8)}
    body .metric .v{font-variant-numeric:tabular-nums}
    body .notice{border-radius:14px;animation:fx-pop .45s cubic-bezier(.2,.8,.2,1) backwards;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
    body .notice.fx-shimmer{background-image:linear-gradient(100deg,transparent 30%,color-mix(in srgb,currentColor 12%,transparent) 50%,transparent 70%);
      background-size:200% 100%;animation:fx-load 1.6s linear infinite}
    body .badge,body .setbadge,body .qid{transition:translate .2s ease}
    body .card:hover .badge{translate:0 -1px}

    /* buttons */
    body .btn{position:relative;overflow:hidden;border-radius:12px;
      transition:translate .2s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease,filter .2s ease,scale .15s ease}
    body .btn:not(:disabled):hover{translate:0 -2px;filter:brightness(1.1);box-shadow:0 12px 28px -12px var(--accent,#38bdf8)}
    body .btn.danger:not(:disabled):hover{box-shadow:0 12px 28px -12px var(--red,#f87171)}
    body .btn:not(:disabled):active{scale:.96;translate:0 0}
    body .btn:disabled{filter:grayscale(.4) opacity(.7)}
    .fx-ripple{position:absolute;border-radius:50%;pointer-events:none;background:rgba(255,255,255,.45);transform:scale(0);animation:fx-rip .65s ease-out forwards}

    /* inputs */
    body input[type=text],body input[type=password],body textarea,body select{transition:box-shadow .2s ease,border-color .2s ease,background-color .2s ease}
    body input[type=text]:focus,body input[type=password]:focus,body textarea:focus,body select:focus{outline:none;border-color:var(--accent,#38bdf8);
      box-shadow:0 0 0 4px color-mix(in srgb,var(--accent,#38bdf8) 24%,transparent),0 8px 24px -12px var(--accent,#38bdf8)}

    /* sidebar */
    body #nav button{transition:translate .2s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease,background-color .2s ease,filter .2s}
    body #nav button:hover{translate:4px 0;filter:brightness(1.12)}
    body #nav button.active{box-shadow:inset 3px 0 0 var(--accent,#38bdf8),0 8px 22px -12px var(--accent,#38bdf8)}
    body #authBtn{transition:translate .2s ease,filter .2s ease}
    body #authBtn:hover{translate:0 -1px;filter:brightness(1.12)}

    /* quiz options */
    body label.opt{transition:translate .2s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease,filter .2s ease;
      background-image:radial-gradient(240px circle at var(--mx,50%) var(--my,-60%),color-mix(in srgb,var(--accent,#38bdf8) 14%,transparent),transparent 70%)}
    body label.opt:not(.locked):hover{translate:5px 0;box-shadow:0 10px 26px -14px var(--accent,#38bdf8)}
    body label.opt:not(.locked):active{scale:.985}
    body label.opt:has(input:checked):not(.good):not(.bad){box-shadow:0 0 0 2px var(--accent,#38bdf8),0 12px 30px -14px var(--accent,#38bdf8)}
    body label.opt.good{animation:fx-ring-good .9s ease-out,fx-bump .5s ease;box-shadow:0 0 22px -6px var(--green,#34d399)}
    body label.opt.bad{animation:fx-shake .5s ease,fx-ring-bad .9s ease-out;box-shadow:0 0 22px -6px var(--red,#f87171)}
    .fx-opt{animation:fx-slide .5s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*70ms + 160ms)}
    .fx-rise{animation:fx-rise .62s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*55ms)}
    .fx-popin{animation:fx-pop .55s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*80ms + 120ms)}

    /* progress bar */
    body .bar{border-radius:999px;overflow:hidden}
    body .bar>div{border-radius:999px;
      background-image:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.4) 50%,transparent 70%),linear-gradient(90deg,var(--accent,#38bdf8),var(--purple,#a78bfa));
      background-size:60% 100%,100% 100%;background-repeat:no-repeat;animation:fx-sheen 2.2s linear infinite;box-shadow:0 0 14px var(--accent,#38bdf8)}

    /* passage panel */
    body .passage{border-radius:16px}

    /* score ring (results) */
    .fx-result{display:flex;flex-direction:column;align-items:center;margin:6px 0 20px}
    .fx-ring{position:relative;width:176px;height:176px}
    .fx-ring svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
    .fx-ring .trk{fill:none;stroke:color-mix(in srgb,currentColor 14%,transparent);stroke-width:9}
    .fx-ring .prg{fill:none;stroke:url(#fxg);stroke-width:9;stroke-linecap:round;stroke-dasharray:326.73;stroke-dashoffset:326.73;
      transition:stroke-dashoffset 1.5s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 8px var(--accent,#38bdf8))}
    .fx-ring-txt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
    .fx-ring-txt b{font-size:36px;font-variant-numeric:tabular-nums;line-height:1}
    .fx-ring-txt small{opacity:.7;margin-top:4px;letter-spacing:.08em;text-transform:uppercase;font-size:11px}
    .fx-chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:12px}
    .fx-chips span{font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;
      background:color-mix(in srgb,currentColor 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 12%,transparent)}

    /* keyboard hint */
    .fx-hint{margin-top:14px;font-size:12px;opacity:.65;text-align:center}
    .fx-hint kbd{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 6px;border-radius:6px;margin:0 2px;
      background:color-mix(in srgb,currentColor 10%,transparent);box-shadow:inset 0 -2px 0 color-mix(in srgb,currentColor 18%,transparent)}

    /* live status HUD */
    .fx-hud{position:fixed;top:10px;right:12px;z-index:60;display:flex;gap:10px;align-items:center;padding:7px 13px;border-radius:999px;
      font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;pointer-events:none;
      background:color-mix(in srgb,currentColor 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 14%,transparent),0 10px 30px -14px rgba(0,0,0,.6);
      -webkit-backdrop-filter:blur(12px) saturate(140%);backdrop-filter:blur(12px) saturate(140%)}
    .fx-hud .dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:fx-ping 1.9s ease-out infinite}
    .fx-hud.off .dot{background:#fbbf24;animation:none}
    .fx-hud .bump{display:inline-block;animation:fx-bump .5s ease}
    .fx-hud .sep{opacity:.35}

    /* toast */
    body .toast.show{animation:fx-toast .4s cubic-bezier(.2,.9,.3,1.25) both}

    @media (max-width:480px){.fx-hud{top:6px;right:6px;font-size:11px;padding:6px 10px}.fx-ring{width:150px;height:150px}}
    @media (prefers-reduced-motion:reduce){
      .fx-rise,.fx-opt,.fx-popin,body .notice,body .title,body .bar>div,body label.opt.good,body label.opt.bad,body .toast.show,.fx-greet i,.fx-hud .dot{animation:none!important}
      body .card,body .metric,body .btn,body label.opt,body #nav button{transition:none!important}
    }`;
    document.head.appendChild(st);
  })();

  /* ───────── 2) Living background: drifting colour orbs + connected particles ───────── */
  const mouse = { x: .5, y: .5, tx: .5, ty: .5, px: 0, py: 0, on: false };
  safe(function backdrop() {
    const cv = document.createElement("canvas");
    cv.className = "fx-bg";
    cv.setAttribute("aria-hidden", "true");
    document.body.insertBefore(cv, document.body.firstChild);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let W = 0, H = 0;
    const cols = [[56, 189, 248], [167, 139, 250], [52, 211, 153], [244, 114, 182]];
    const orbs = cols.map((c, i) => ({
      c, ph: Math.random() * 6.28, sp: .00011 + Math.random() * .00009,
      rx: .12 + Math.random() * .14, ry: .1 + Math.random() * .14,
      cx: [.15, .85, .5, .2][i], cy: [.2, .3, .9, .75][i], r: .3 + Math.random() * .1,
    }));
    const pts = Array.from({ length: window.innerWidth < 700 ? 26 : 50 }, () => ({
      x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .00006, vy: (Math.random() - .5) * .00006, r: Math.random() * 1.3 + .6,
    }));
    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) frame(0);
    }
    function frame(t) {
      ctx.clearRect(0, 0, W, H);
      mouse.x += (mouse.tx - mouse.x) * .05; mouse.y += (mouse.ty - mouse.y) * .05;
      const big = Math.max(W, H);
      orbs.forEach(o => {
        const x = (o.cx + Math.sin(t * o.sp * 6 + o.ph) * o.rx + (mouse.x - .5) * .07) * W;
        const y = (o.cy + Math.cos(t * o.sp * 5 + o.ph) * o.ry + (mouse.y - .5) * .07) * H;
        const r = o.r * big;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${o.c},0.15)`); g.addColorStop(1, `rgba(${o.c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      });
      const mx = mouse.x * W, my = mouse.y * H;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!reduce) {
          p.x += p.vx * 16; p.y += p.vy * 16;
          if (p.x < 0) p.x = 1; else if (p.x > 1) p.x = 0;
          if (p.y < 0) p.y = 1; else if (p.y > 1) p.y = 0;
        }
        const x = p.x * W, y = p.y * H;
        ctx.fillStyle = "rgba(148,200,255,.4)";
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.2832); ctx.fill();
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j], dx = x - q.x * W, dy = y - q.y * H, d2 = dx * dx + dy * dy;
          if (d2 < 14400) {
            ctx.strokeStyle = `rgba(148,200,255,${(1 - d2 / 14400) * .13})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(q.x * W, q.y * H); ctx.stroke();
          }
        }
        if (mouse.on) {
          const dx = x - mx, dy = y - my, d2 = dx * dx + dy * dy;
          if (d2 < 32400) {
            ctx.strokeStyle = `rgba(56,189,248,${(1 - d2 / 32400) * .35})`;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(mx, my); ctx.stroke();
          }
        }
      }
    }
    function loop(t) { frame(t); requestAnimationFrame(loop); }
    size();
    window.addEventListener("resize", size);
    if (!reduce) requestAnimationFrame(loop);
  })();

  /* ───────── 3) Cursor glow, scroll bar, spotlight hovers, button ripples ───────── */
  const glow = document.createElement("div"); glow.className = "fx-cursor"; glow.setAttribute("aria-hidden", "true");
  const sbar = document.createElement("div"); sbar.className = "fx-scroll"; sbar.setAttribute("aria-hidden", "true");
  if (finePointer && !reduce) document.body.appendChild(glow);
  document.body.appendChild(sbar);

  let moveRaf = 0, lastMove = null;
  document.addEventListener("pointermove", e => {
    lastMove = e;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(safe(() => {
      moveRaf = 0;
      const ev = lastMove;
      mouse.tx = ev.clientX / Math.max(1, window.innerWidth); mouse.ty = ev.clientY / Math.max(1, window.innerHeight); mouse.on = true;
      if (finePointer) { glow.style.transform = `translate3d(${ev.clientX}px,${ev.clientY}px,0)`; glow.style.opacity = "1"; }
      const el = ev.target && ev.target.closest && ev.target.closest(".card,.metric,label.opt");
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", (ev.clientX - r.left) + "px");
        el.style.setProperty("--my", (ev.clientY - r.top) + "px");
      }
    }));
  }, { passive: true });
  document.addEventListener("pointerleave", () => { glow.style.opacity = "0"; mouse.on = false; });
  document.documentElement.addEventListener("mouseleave", () => { glow.style.opacity = "0"; mouse.on = false; });

  const onScroll = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    sbar.style.transform = `scaleX(${h > 0 ? Math.min(1, window.scrollY / h) : 0})`;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  document.addEventListener("pointerdown", safe(e => {
    const b = e.target && e.target.closest && e.target.closest(".btn");
    if (!b || b.disabled || reduce) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
    const d = document.createElement("span");
    d.className = "fx-ripple";
    d.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.appendChild(d);
    setTimeout(() => d.remove(), 700);
  }), { passive: true });

  /* ───────── 4) Confetti ───────── */
  const bits = [];
  let cfCanvas = null, cfCtx = null, cfRun = false;
  const palette = ["#38bdf8", "#a78bfa", "#34d399", "#f472b6", "#fbbf24", "#f87171"];
  function cfLoop() {
    if (!cfCtx) { cfRun = false; return; }
    cfCtx.clearRect(0, 0, cfCanvas.width, cfCanvas.height);
    for (let i = bits.length - 1; i >= 0; i--) {
      const p = bits[i];
      p.vy += .22; p.vx *= .992; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
      if (p.life > p.max || p.y > window.innerHeight + 30) { bits.splice(i, 1); continue; }
      cfCtx.save();
      cfCtx.globalAlpha = Math.min(1, (p.max - p.life) / 25);
      cfCtx.translate(p.x, p.y); cfCtx.rotate(p.rot);
      cfCtx.fillStyle = p.color;
      cfCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cfCtx.restore();
    }
    if (bits.length) requestAnimationFrame(cfLoop);
    else { cfRun = false; cfCanvas.remove(); cfCanvas = null; cfCtx = null; }
  }
  function burst(x, y, n, power, spread, up) {
    if (reduce) return;
    if (!cfCanvas) {
      cfCanvas = document.createElement("canvas");
      cfCanvas.className = "fx-confetti"; cfCanvas.setAttribute("aria-hidden", "true");
      cfCanvas.width = window.innerWidth; cfCanvas.height = window.innerHeight;
      document.body.appendChild(cfCanvas);
      cfCtx = cfCanvas.getContext("2d");
    }
    for (let i = 0; i < n; i++) {
      const a = (up === undefined ? Math.random() * 6.2832 : up + (Math.random() - .5) * spread);
      const v = power * (.4 + Math.random() * .8);
      bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - .5) * .35,
        w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, color: palette[(Math.random() * palette.length) | 0], life: 0, max: 90 + Math.random() * 70 });
    }
    if (!cfRun) { cfRun = true; requestAnimationFrame(cfLoop); }
  }
  function celebrate(level) {
    const W = window.innerWidth, H = window.innerHeight;
    burst(0, H, 70 * level, 17, 1.0, -1.05);
    burst(W, H, 70 * level, 17, 1.0, -2.1);
    setTimeout(() => burst(W / 2, H * .35, 60 * level, 9, 0), 350);
    if (level > 1) setTimeout(() => { burst(W * .25, H * .3, 50, 10, 0); burst(W * .75, H * .3, 50, 10, 0); }, 800);
  }

  /* ───────── 5) Live status HUD (data source, quiz timer, streak) ───────── */
  const hud = document.createElement("div");
  hud.className = "fx-hud"; hud.setAttribute("aria-hidden", "true");
  hud.innerHTML = `<span class="dot"></span><span class="h-status"></span><span class="h-quiz" style="display:none"></span>`;
  document.body.appendChild(hud);
  const hStatus = hud.querySelector(".h-status"), hQuiz = hud.querySelector(".h-quiz");
  const setText = (el, t) => { if (el.dataset.t !== t) { el.dataset.t = t; el.textContent = t; return true; } return false; };
  const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  let lastList = null, qStart = 0, qEnd = 0, streak = 0, best = 0;
  function hudTick() {
    if (document.hidden) return;
    let label = "Ready", off = false;
    const src = bankInfo && bankInfo.source;
    if (loadState === "loading") label = "Syncing…";
    else if (loadState === "error") { label = "Offline"; off = true; }
    else if (loadState === "nodb") { label = "Local file"; off = true; }
    else if (src === "online") label = "Live data";
    else if (src === "saved") { label = "Saved copy"; off = true; }
    else if (src === "bundled") { label = "Built-in copy"; off = true; }
    hud.classList.toggle("off", off);
    setText(hStatus, label);
    if (lastList && (quiz.active || quiz.results) && qStart) {
      hQuiz.style.display = "";
      const t = "⏱ " + mmss((qEnd || Date.now()) - qStart) + (streak >= 2 ? "  ·  🔥 " + streak : "");
      if (setText(hQuiz, "· " + t) && streak >= 2 && hud.dataset.bump === "1") {
        hud.dataset.bump = "0";
        hQuiz.classList.remove("bump"); void hQuiz.offsetWidth; hQuiz.classList.add("bump");
      }
    } else hQuiz.style.display = "none";
  }
  setInterval(safe(hudTick), 500);
  hudTick();

  /* ───────── 6) Per-render enhancements ───────── */
  const fxCount = (el, to, dur, dec, suf) => {
    if (reduce) { el.textContent = to.toFixed(dec) + suf; return; }
    const t0 = performance.now();
    (function step(t) {
      if (!el.isConnected) return;
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (to * e).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  };

  let lastKey = "", lastAnsKey = "", lastBar = 0;

  function enhancePage() {
    const key = [current, currentFile, loadState, quiz.active ? quiz.idx : "-", quiz.results ? "r" : "", quiz.list.length].join("|");
    const fresh = key !== lastKey;
    lastKey = key;

    /* quiz timer / streak bookkeeping (read-only on the quiz state) */
    if (quiz.active && quiz.list !== lastList) { lastList = quiz.list; qStart = Date.now(); qEnd = 0; streak = 0; best = 0; lastAnsKey = ""; }
    if (quiz.results && lastList && !qEnd) qEnd = Date.now();
    if (!quiz.active && !quiz.results) { lastList = null; qStart = 0; qEnd = 0; }

    /* answer feedback: streak + confetti burst on a correct answer (once per question) */
    if (quiz.active && quiz.answered) {
      const ak = key + "|a";
      if (ak !== lastAnsKey) {
        lastAnsKey = ak;
        if (page.querySelector("label.opt.bad")) streak = 0;
        else {
          streak++; best = Math.max(best, streak);
          const g = page.querySelector("label.opt.good");
          if (g) { const r = g.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, streak >= 3 ? 46 : 28, 6.5, 0); }
          hud.dataset.bump = "1";
        }
        hudTick();
      }
    }

    /* greeting on the dashboard */
    if (current === "dashboard") {
      const hr = new Date().getHours();
      const g = hr < 5 ? "Burning the midnight oil" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
      page.insertAdjacentHTML("afterbegin", `<div class="fx-greet">${g} <i>👋</i></div>`);
    }

    /* keyboard hint under the question (mouse/trackpad devices only) */
    if (quiz.active && !quiz.results && finePointer) {
      const host = page.querySelector(".qcol") || page;
      host.insertAdjacentHTML("beforeend", quiz.answered
        ? `<div class="fx-hint"><kbd>Enter</kbd> for the next one</div>`
        : `<div class="fx-hint"><kbd>A</kbd>–<kbd>D</kbd> choose &nbsp;·&nbsp; <kbd>↑</kbd><kbd>↓</kbd> move &nbsp;·&nbsp; <kbd>Enter</kbd> submit</div>`);
    }

    /* animated score ring on the results screen */
    let pct = 0, showRing = false;
    if (current === "quiz" && quiz.results && page.querySelector(".metrics")) {
      showRing = true;
      pct = quiz.list.length ? (quiz.score / quiz.list.length) * 100 : 0;
      const chips = `<span>⏱ ${mmss((qEnd || Date.now()) - (qStart || Date.now()))}</span><span>🔥 Best streak ${best}</span><span>✓ ${quiz.score} / ${quiz.list.length}</span>`;
      page.querySelector(".metrics").insertAdjacentHTML("beforebegin",
        `<div class="fx-result"><div class="fx-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><defs>
           <linearGradient id="fxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent,#38bdf8)"/><stop offset="1" style="stop-color:var(--purple,#a78bfa)"/></linearGradient></defs>
           <circle class="trk" cx="60" cy="60" r="52"/><circle class="prg" cx="60" cy="60" r="52"/></svg>
           <div class="fx-ring-txt"><b>0%</b><small>Score</small></div></div><div class="fx-chips">${chips}</div></div>`);
      const prg = page.querySelector(".fx-ring .prg"), num = page.querySelector(".fx-ring-txt b");
      void prg.getBoundingClientRect();
      requestAnimationFrame(() => { prg.style.strokeDashoffset = String(326.73 * (1 - pct / 100)); });
      fxCount(num, pct, 1500, 0, "%");
    }

    /* entrance animation – only when the screen/question really changed (not when Submit redraws it) */
    if (fresh) {
      const kids = [];
      [...page.children].forEach(el => { if (el.classList.contains("qlayout")) kids.push(...el.children); else kids.push(el); });
      kids.slice(0, 14).forEach((el, i) => { el.style.setProperty("--i", i); el.classList.add("fx-rise"); });
      page.querySelectorAll(".metric").forEach((el, i) => { el.style.setProperty("--i", i); el.classList.add("fx-popin"); });
      page.querySelectorAll("label.opt").forEach((el, i) => { el.style.setProperty("--i", i); el.classList.add("fx-opt"); });
      page.querySelectorAll(".metric .v").forEach(v => {
        const m = /^(-?\d+(?:\.\d+)?)(%?)$/.exec(v.textContent.trim());
        if (m) fxCount(v, parseFloat(m[1]), 1000, (m[1].split(".")[1] || "").length, m[2]);
      });
      if (showRing && pct >= 60) setTimeout(() => celebrate(pct === 100 ? 2 : 1), 450);
    } else if (showRing) {
      page.querySelectorAll(".metric .v").forEach(v => {
        const m = /^(-?\d+(?:\.\d+)?)(%?)$/.exec(v.textContent.trim());
        if (m) fxCount(v, parseFloat(m[1]), 800, (m[1].split(".")[1] || "").length, m[2]);
      });
    }

    /* smooth progress bar: glide from the previous value instead of jumping */
    const bd = page.querySelector(".bar > div");
    if (bd) {
      const target = parseFloat(bd.style.width) || 0;
      bd.style.transition = "none"; bd.style.width = lastBar + "%";
      void bd.offsetWidth;
      bd.style.transition = "width .8s cubic-bezier(.2,.8,.2,1)"; bd.style.width = target + "%";
      lastBar = target;
    } else lastBar = 0;

    /* loading placeholders shimmer */
    page.querySelectorAll(".notice.info").forEach(n => { if (/^Loading/i.test(n.textContent.trim())) n.classList.add("fx-shimmer"); });

    onScroll();
  }

  /* new cards / notices that appear inside an existing screen (search results, previews …) */
  function enhanceAdded(nodes) {
    let n = 0;
    nodes.forEach(el => {
      if (el.nodeType !== 1 || el.classList.contains("fx-ripple") || el.classList.contains("fx-rise")) return;
      if ((el.classList.contains("card") || el.classList.contains("notice")) && n < 14) {
        el.style.setProperty("--i", n++); el.classList.add("fx-rise");
      }
    });
  }

  const mo = new MutationObserver(safe(records => {
    let full = false;
    const added = [];
    records.forEach(r => {
      if (r.target === page) { if (r.addedNodes.length) full = true; }
      else r.addedNodes.forEach(nd => added.push(nd));
    });
    if (full) enhancePage(); else if (added.length) enhanceAdded(added);
    mo.takeRecords();   // ignore the changes we just made ourselves
  }));
  mo.observe(page, { childList: true, subtree: true });

  /* the first render may already have happened before the observer existed */
  if (page.children.length) safe(enhancePage)();
}

/* ───────── Init ───────── */
/* Local-file fallback: only used when the page cannot reach a blog (e.g. opened as a plain file for testing) */
$("#localInput").onchange = async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    blogList = normalize(JSON.parse(await f.text()));
    bankInfo = { updated: null, count: blogList.length, name: f.name };
    applyWorking();
    quiz = freshQuiz();
    toast(`Loaded ${blogList.length} question(s) from ${f.name}`, "success");
    go("dashboard");
  } catch (err) { toast("Could not load file: " + errText(err), "error"); }
};
$("#authBtn").onclick = () => { if (isAdmin) logout(); else go("login"); };

try { isAdmin = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) {}
buildNav();
applyWorking();
installQuizKeyboard();   // keyboard navigation (see block above)
try { installLiveUI(); } catch (e) { console.warn("[live-ui] disabled:", e); }   // visual layer (see block above)
render();
loadBlog();
