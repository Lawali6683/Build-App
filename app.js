import { supabase } from "./supabase.js";

const PIN_HASH = "4522d27a0589a4fc78b133d83f6c80a3a4bc6c0b91fbfafafb93884a026f109c";
const GH_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const START_RE = /^\/?[\w\-./]*(\?[\w\-=&.%]*)?(#[\w\-\/=&.%]*)?$/;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = { src: "repo", icon: null, thumb: null, iconInfo: null, zip: null, repo: null, pick: null, repos: [], connected: false, reuse: null, job: null, shareId: "", version: 1, files: {}, warn: [], targets: [], started: false, running: false };
let pollToken = 0;

const TYPES = {
  apk: ["fa-brands fa-android", "Android APK", "Install directly on a phone"],
  aab: ["fa-brands fa-google-play", "Google Play AAB", "Upload this file to Google Play"],
  ipa: ["fa-brands fa-apple", "iPhone IPA", "Upload to App Store Connect"],
  exe: ["fa-brands fa-windows", "Windows installer", "Install on a computer"],
};
const REASON = {
  apk: "the Android signing key or build failed, check the log",
  aab: "the Android signing key is not set up on the server",
  ipa: "iPhone signing is not set up on the server",
  exe: "the Windows build failed, check the log",
};
const stepsFor = (t) => [
  ["prepare", "fa-solid fa-cloud-arrow-down", "Importing and preparing project"],
  ...(t.includes("apk") || t.includes("aab") ? [["android", "fa-brands fa-android", "Building Android app"]] : []),
  ...(t.includes("ipa") ? [["ios", "fa-brands fa-apple", "Building iPhone app"]] : []),
  ...(t.includes("exe") ? [["desktop", "fa-brands fa-windows", "Building Windows app"]] : []),
  ["publish", "fa-solid fa-box-archive", "Packaging files"],
];

const toast = (t, ms = 4500) => {
  const e = $("toast");
  e.textContent = t;
  e.style.display = "block";
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (e.style.display = "none"), ms);
};

async function sha(t) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { ...(opt.headers || {}), "x-idt-pin": sessionStorage.getItem("idt_pin") || "" } });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || "Server error " + r.status);
  return j;
}

async function unlock(pin) {
  if ((await sha(pin)) !== PIN_HASH) return false;
  sessionStorage.setItem("idt_pin", pin);
  $("gate").hidden = true;
  $("app").hidden = false;
  start();
  return true;
}

const boxes = [...document.querySelectorAll("#pin input")];

async function submitPin() {
  const pin = boxes.map((x) => x.value).join("");
  if (await unlock(pin)) return;
  $("pinErr").textContent = "Wrong PIN. Try again.";
  $("pin").classList.add("shake");
  setTimeout(() => {
    $("pin").classList.remove("shake");
    boxes.forEach((x) => (x.value = ""));
    boxes[0].focus();
  }, 450);
}

boxes.forEach((b, i) => {
  b.addEventListener("input", () => {
    b.value = b.value.replace(/\D/g, "").slice(-1);
    $("pinErr").textContent = "";
    if (b.value && i < 5) boxes[i + 1].focus();
    if (boxes.every((x) => x.value)) submitPin();
  });
  b.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !b.value && i > 0) boxes[i - 1].focus();
  });
  b.addEventListener("paste", (e) => {
    const d = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!d) return;
    e.preventDefault();
    boxes.forEach((x, k) => (x.value = d[k] || ""));
    if (d.length === 6) submitPin();
  });
});

const saved = sessionStorage.getItem("idt_pin");
if (saved) unlock(saved).then((ok) => { if (!ok) boxes[0].focus(); });
else boxes[0].focus();

function setSrc(s) {
  S.src = s;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.src === s)));
  ["repo", "github", "site", "zip"].forEach((k) => ($("p-" + k).hidden = k !== s));
  $("srcErr").textContent = "";
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => setSrc(t.dataset.src)));

function showChosen() {
  $("ghChosen").hidden = !S.repo;
  $("ghPicker").hidden = !!S.repo || !S.connected;
  $("ghConnect").hidden = S.connected;
  if (S.repo) $("ghChosenName").textContent = S.repo.name;
}

function renderRepos() {
  const q = $("repoSearch").value.trim().toLowerCase();
  const list = S.repos.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 80);
  $("repoList").innerHTML = list.length
    ? list.map((r) => `<button type="button" class="repo${S.pick === r.name ? " on" : ""}" data-name="${esc(r.name)}"><i class="fa-solid ${r.private ? "fa-lock" : "fa-book"}"></i><span>${esc(r.name)}</span></button>`).join("")
    : '<p class="hint">No repositories found.</p>';
}

async function loadGithub() {
  try {
    const d = await api("/api/gh/repos");
    S.connected = !!d.connected;
    if (S.connected) {
      S.repos = d.repos;
      $("ghUser").innerHTML = `<img src="${esc(d.avatar)}" alt=""> <b>${esc(d.login)}</b>`;
      renderRepos();
    }
    showChosen();
  } catch (e) { toast(e.message); }
}

function ghReason(why) {
  const m = {
    state: "The login session expired. Use the same browser and try again.",
    denied: "GitHub access was not allowed. Tap Connect GitHub and choose Authorize.",
    incorrect_client_credentials: "GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is wrong in Cloudflare.",
    redirect_uri_mismatch: "The callback URL in your GitHub OAuth App must be exactly " + location.origin + "/api/gh/callback",
    bad_verification_code: "The login code expired. Tap Connect GitHub again.",
  };
  return m[why] || "GitHub connection failed" + (why ? " (" + why + ")" : "") + ". Try again.";
}

$("ghConnectBtn").onclick = async () => {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    const h = await r.json();
    if (!h.GITHUB_CLIENT_ID || !h.GITHUB_CLIENT_SECRET) return toast("GitHub login is not set up. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in Cloudflare, then deploy again.", 9000);
    if (!h.TOKEN_KEY) return toast("TOKEN_KEY is missing or is not 64 characters (0-9 and a-f). Fix it in Cloudflare, then deploy again.", 9000);
  } catch { return toast("The server files are not working. Check that functions/api/health.js and functions/api/gh/login.js exist, then deploy again.", 9000); }
  location.href = "/api/gh/login";
};
$("repoSearch").oninput = renderRepos;
$("repoList").onclick = (e) => {
  const b = e.target.closest(".repo");
  if (!b) return;
  S.pick = b.dataset.name;
  $("repoDone").disabled = false;
  renderRepos();
};
$("repoDone").onclick = () => {
  const r = S.repos.find((x) => x.name === S.pick);
  if (!r) return;
  S.repo = { name: r.name, branch: r.branch };
  showChosen();
};
$("ghChange").onclick = () => { S.repo = null; showChosen(); renderRepos(); };
$("ghLogout").onclick = async () => {
  try { await api("/api/gh/logout"); } catch {}
  S.repo = null;
  S.connected = false;
  showChosen();
};

$("name").addEventListener("input", () => {
  if (!$("pkg").dataset.touched) {
    const s = $("name").value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    $("pkg").value = /^[a-z]/.test(s) ? "com.idt." + s : "";
  }
});
$("pkg").addEventListener("input", () => ($("pkg").dataset.touched = "1"));

$("pickZip").onclick = () => $("zip").click();
$("zip").onchange = function () {
  const f = this.files[0];
  S.zip = null;
  $("zipName").textContent = "";
  if (!f) return;
  if (f.size > 10e6) { $("srcErr").textContent = "ZIP is larger than 10 MB. Use GitHub for bigger projects."; return; }
  S.zip = f;
  $("zipName").textContent = f.name;
  $("srcErr").textContent = "";
};

const ICON_SIZE = 1024;
const ICON_HINT = "Any PNG, JPG or WebP image. It is resized to 1024×1024 automatically.";
const iconHint = document.querySelector(".icon-row .hint");
$("icon").accept = "image/png,image/jpeg,image/webp";

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    img.src = url;
  });
}

async function makeIcon(file) {
  const img = await loadImage(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new Error("unreadable");
  const scale = Math.min(ICON_SIZE / w, ICON_SIZE / h);
  const dw = Math.round(w * scale), dh = Math.round(h * scale);
  const c = document.createElement("canvas");
  c.width = c.height = ICON_SIZE;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(img, Math.round((ICON_SIZE - dw) / 2), Math.round((ICON_SIZE - dh) / 2), dw, dh);
  const px = x.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("export");
  const t = document.createElement("canvas");
  t.width = t.height = 160;
  t.getContext("2d").drawImage(c, 0, 0, 160, 160);
  return { file: new File([blob], "icon.png", { type: "image/png" }), thumb: t.toDataURL("image/png"), alpha, padded: dw !== ICON_SIZE || dh !== ICON_SIZE, w, h };
}

function updateIconNote() {
  const i = S.iconInfo;
  let m = ICON_HINT, warn = false;
  if (i) {
    m = i.w === ICON_SIZE && i.h === ICON_SIZE ? "Ready. Your icon is 1024×1024." : `Resized from ${i.w}×${i.h} to 1024×1024.`;
    if (i.w < ICON_SIZE && i.h < ICON_SIZE) m += " A larger image gives a sharper icon.";
    if (i.padded) m += " The shape is kept, with empty space around it.";
    if (i.alpha) m += " Transparent areas are kept as they are.";
    if (i.alpha && document.querySelector("[name=t][value=ipa]").checked) {
      m += " Apple does not accept transparent iPhone icons. For the iPhone file, use an icon with a background.";
      warn = true;
    }
  }
  iconHint.textContent = m;
  iconHint.style.color = warn ? "var(--err)" : "";
}

$("pickIcon").onclick = () => $("icon").click();
document.querySelectorAll("[name=t]").forEach((x) => x.addEventListener("change", updateIconNote));
$("icon").onchange = async function () {
  const f = this.files[0];
  S.icon = null;
  S.thumb = null;
  S.iconInfo = null;
  $("iconErr").textContent = "";
  updateIconNote();
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type) && !/\.(png|jpe?g|webp)$/i.test(f.name)) { $("iconErr").textContent = "Use a PNG, JPG or WebP image."; return; }
  try {
    const r = await makeIcon(f);
    if (r.file.size > 3.9e6) { $("iconErr").textContent = "The icon file is too large after resizing. Use a simpler image."; return; }
    S.icon = r.file;
    S.thumb = r.thumb;
    S.iconInfo = r;
    $("iconPrev").innerHTML = `<img src="${r.thumb}" alt="">`;
    updateIconNote();
  } catch { $("iconErr").textContent = "This image could not be read. Try a PNG or JPG file."; }
  this.value = "";
};
updateIconNote();

function validate() {
  let ok = true;
  const set = (id, m) => { $(id).textContent = m; if (m) ok = false; };
  ["srcErr", "nameErr", "pkgErr", "apiErr", "pathsErr", "startErr", "tgtErr", "genErr"].forEach((i) => ($(i).textContent = ""));
  if (S.src === "repo" && !S.repo) set("srcErr", "Connect GitHub, choose a repository and tap Done.");
  if (S.src === "github" && !GH_RE.test($("src").value.trim())) set("srcErr", "Enter a full GitHub link like https://github.com/owner/repo");
  if (S.src === "site") { try { if (new URL($("siteUrl").value.trim()).protocol !== "https:") throw 0; } catch { set("srcErr", "Enter a website link starting with https://"); } }
  if (S.src === "zip" && !S.zip) set("srcErr", "Choose a ZIP file.");
  if (!/^[A-Za-z0-9][A-Za-z0-9 .\-]{0,29}$/.test($("name").value.trim())) set("nameErr", "Use 1-30 letters, numbers, spaces, dots or dashes.");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test($("pkg").value.trim())) set("pkgErr", "Use lowercase letters and dots, like com.idt.movies");
  const sp = $("start").value.trim();
  if (sp && (sp.includes("..") || !START_RE.test(sp))) set("startErr", "Use a path like register.html or /dashboard.html");
  if (!S.icon && !S.reuse) set("iconErr", "Upload a valid app icon.");
  if ($("api").value.trim()) {
    try { if (new URL($("api").value.trim()).protocol !== "https:") throw 0; } catch { set("apiErr", "Enter your live API domain, starting with https://"); }
    if (!/^\/[\w\-./]*(,\s*\/[\w\-./]*)*$/.test($("paths").value.trim())) set("pathsErr", "Paths must start with / and be separated by commas.");
  }
  S.targets = [...document.querySelectorAll("[name=t]:checked")].map((x) => x.value);
  if (!S.targets.length) set("tgtErr", "Choose at least one file type.");
  return ok;
}

function render(jobs) {
  jobs = jobs || {};
  const steps = stepsFor(S.targets);
  $("steps").innerHTML = steps.map(([k, ic, label]) => {
    const st = jobs[k] || "pending";
    const icon = st === "success" ? "fa-solid fa-check" : st === "running" ? "fa-solid fa-spinner fa-spin" : st === "failed" ? "fa-solid fa-xmark" : st === "skipped" ? "fa-solid fa-minus" : ic;
    return `<li class="${st}"><i class="${icon}"></i><span>${label}${st === "skipped" ? " (not set up on the server)" : ""}</span></li>`;
  }).join("");
  const n = steps.filter(([k]) => ["success", "failed", "skipped"].includes(jobs[k])).length;
  $("barIn").style.width = Math.max(5, (n / steps.length) * 100) + "%";
}

const fail = (m) => { $("genErr").textContent = m; $("gen").disabled = false; };

function sourceValue() {
  if (S.src === "repo") return S.repo.name;
  if (S.src === "github") return $("src").value.trim();
  if (S.src === "site") return $("siteUrl").value.trim();
  return "";
}

function branchValue() {
  if (S.src === "repo") return S.repo.branch;
  if (S.src === "github") return $("branch").value.trim() || "main";
  return "";
}

const WORK_KEY = "idt_work";
const WORK_DAYS = 7;

function loadWork() {
  try { return JSON.parse(localStorage.getItem(WORK_KEY) || "null"); } catch { return null; }
}
function setWork(w) {
  try { localStorage.setItem(WORK_KEY, JSON.stringify(w)); } catch {}
}
function patchWork(p) {
  const w = loadWork();
  if (w) setWork({ ...w, ...p });
}
function clearWork() {
  try { localStorage.removeItem(WORK_KEY); } catch {}
}

function formSnapshot() {
  return {
    src: $("src").value.trim(),
    branch: $("branch").value.trim(),
    siteUrl: $("siteUrl").value.trim(),
    zipName: S.zip ? S.zip.name : "",
    name: $("name").value.trim(),
    pkg: $("pkg").value.trim(),
    start: $("start").value.trim(),
    api: $("api").value.trim(),
    paths: $("paths").value.trim(),
  };
}

async function generate() {
  const pkg = $("pkg").value.trim();
  if (S.reuse && S.reuse.package_id !== pkg) S.reuse = null;
  if (!S.reuse && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) {
    const { data } = await supabase.from("apps").select("*").eq("package_id", pkg).maybeSingle();
    if (data) S.reuse = data;
  }
  if (!validate()) return toast("Fix the highlighted fields first.");
  $("done").hidden = true;
  $("progress").hidden = false;
  $("gen").disabled = true;
  render({});
  const fd = new FormData();
  fd.append("sourceType", S.src);
  fd.append("source", sourceValue());
  fd.append("branch", branchValue());
  fd.append("appName", $("name").value.trim());
  fd.append("packageId", pkg);
  fd.append("apiBase", $("api").value.trim());
  fd.append("apiPaths", $("paths").value.trim());
  fd.append("startPage", $("start").value.trim());
  fd.append("targets", S.targets.join(","));
  fd.append("version", String(S.reuse ? S.reuse.version + 1 : 1));
  if (S.reuse) fd.append("shareId", S.reuse.share_id);
  if (S.icon) fd.append("icon", S.icon);
  if (S.src === "zip") fd.append("zip", S.zip);
  try {
    const j = await api("/api/build", { method: "POST", body: fd });
    S.job = j.id;
    S.shareId = j.shareId;
    S.version = j.version;
    S.files = {};
    S.warn = [];
    setWork({
      job: j.id,
      shareId: j.shareId,
      version: j.version,
      targets: S.targets,
      src: S.src,
      repo: S.repo,
      thumb: S.thumb || (S.reuse && S.reuse.icon) || null,
      form: formSnapshot(),
      state: "running",
      jobs: {},
      startedAt: Date.now(),
    });
    showNewWork();
    startPoll();
  } catch (e) {
    $("progress").hidden = true;
    fail(e.message);
  }
}

function startPoll() {
  const t = ++pollToken;
  S.running = true;
  poll(0, t);
}

async function poll(n, t) {
  if (t !== pollToken) return;
  try {
    const j = await api("/api/status?id=" + S.job);
    if (t !== pollToken) return;
    render(j.jobs);
    patchWork({ jobs: j.jobs });
    if (j.state === "done") {
      S.running = false;
      S.files = j.files || {};
      S.warn = j.warnings || [];
      await saveHistory();
      if (t !== pollToken) return;
      patchWork({ state: "done", files: S.files, warn: S.warn, logUrl: j.logUrl || "", saved: true });
      return finish(j.logUrl);
    }
    if (j.state === "error") {
      S.running = false;
      const m = j.error + (j.logUrl ? " Details: " + j.logUrl : "");
      patchWork({ state: "error", error: m });
      return fail(m);
    }
  } catch (e) {
    if (/PIN|Locked/i.test(e.message)) { S.running = false; return fail(e.message); }
  }
  if (n > 600) { S.running = false; return fail("The build took too long. Check GitHub Actions."); }
  setTimeout(() => poll(n + 1, t), 4000);
}

function showNewWork() {
  let b = $("newWork");
  if (!b) {
    b = document.createElement("button");
    b.id = "newWork";
    b.type = "button";
    b.className = "btn";
    b.innerHTML = '<i class="fa-solid fa-plus"></i> New work';
    b.setAttribute("style", "position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:40;box-shadow:0 10px 28px rgba(31,36,98,.35)");
    b.onclick = newWork;
    document.body.appendChild(b);
  }
  b.hidden = false;
  $("app").style.paddingBottom = "96px";
}

function newWork() {
  if (S.running && !confirm("A build is still running. Start new work anyway? The build keeps running on the server, but this page will stop showing it.")) return;
  pollToken++;
  S.running = false;
  clearWork();
  Object.assign(S, { icon: null, thumb: null, iconInfo: null, zip: null, repo: null, pick: null, reuse: null, job: null, shareId: "", version: 1, files: {}, warn: [], targets: [] });
  ["src", "branch", "siteUrl", "name", "pkg", "start", "api", "repoSearch"].forEach((i) => ($(i).value = ""));
  delete $("pkg").dataset.touched;
  $("paths").value = "/api/";
  $("zip").value = "";
  $("zipName").textContent = "";
  $("icon").value = "";
  $("iconPrev").innerHTML = '<i class="fa-regular fa-image"></i>';
  document.querySelectorAll("[name=t]").forEach((x) => (x.checked = x.value === "apk"));
  ["srcErr", "nameErr", "pkgErr", "apiErr", "pathsErr", "startErr", "tgtErr", "iconErr", "genErr"].forEach((i) => ($(i).textContent = ""));
  $("progress").hidden = true;
  $("done").hidden = true;
  $("gen").disabled = false;
  $("repoDone").disabled = true;
  setSrc("repo");
  showChosen();
  renderRepos();
  updateIconNote();
  $("newWork").hidden = true;
  $("app").style.paddingBottom = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Ready for new work.");
}

function restoreWork() {
  const w = loadWork();
  if (!w || !w.job) return;
  if (Date.now() - (w.startedAt || 0) > WORK_DAYS * 864e5) { clearWork(); return; }
  const f = w.form || {};
  setSrc(w.src || "repo");
  if (w.src === "repo" && w.repo) { S.repo = w.repo; showChosen(); }
  $("src").value = f.src || "";
  $("branch").value = f.branch || "";
  $("siteUrl").value = f.siteUrl || "";
  $("zipName").textContent = f.zipName || "";
  $("name").value = f.name || "";
  $("pkg").value = f.pkg || "";
  $("pkg").dataset.touched = "1";
  $("start").value = f.start || "";
  $("api").value = f.api || "";
  $("paths").value = f.paths || "/api/";
  S.targets = w.targets || [];
  document.querySelectorAll("[name=t]").forEach((x) => (x.checked = S.targets.includes(x.value)));
  S.thumb = w.thumb || null;
  if (S.thumb) $("iconPrev").innerHTML = `<img src="${esc(S.thumb)}" alt="">`;
  S.job = w.job;
  S.shareId = w.shareId;
  S.version = w.version;
  S.files = w.files || {};
  S.warn = w.warn || [];
  $("progress").hidden = false;
  render(w.jobs || {});
  showNewWork();
  if (w.state === "done") return finish(w.logUrl, true);
  if (w.state === "error") return fail(w.error || "The build failed.");
  $("gen").disabled = true;
  startPoll();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.running && S.job) startPoll();
});

async function saveHistory() {
  const config = { sourceType: S.src, source: sourceValue(), branch: branchValue(), apiBase: $("api").value.trim(), apiPaths: $("paths").value.trim(), startPage: $("start").value.trim(), targets: S.targets };
  const row = {
    share_id: S.shareId,
    package_id: $("pkg").value.trim(),
    name: $("name").value.trim(),
    version: S.version,
    job_id: S.job,
    icon: S.thumb || (S.reuse && S.reuse.icon) || null,
    config,
    files: S.files,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("apps").upsert(row, { onConflict: "package_id" });
  if (error) toast("History was not saved: " + error.message);
  loadHistory();
}

function finish(logUrl, quiet) {
  const test = S.files.apk && /-debug\.apk$/.test(S.files.apk);
  let msg = $("name").value.trim() + " is ready (version " + S.version + ").";
  if (test) msg += " The APK is a test build because no Android release key is set up, so it cannot update an installed app.";
  if (S.warn.length) msg += " Some builds failed. Details: " + (logUrl || "GitHub Actions");
  $("doneMsg").textContent = msg;
  $("dl").innerHTML = S.targets.map((t) => {
    const [ic, label, sub] = TYPES[t];
    return S.files[t]
      ? `<a class="btn" href="/api/download?id=${S.job}&type=${t}"><i class="${ic}"></i><span>${label}<small>${sub}</small></span></a>`
      : `<div class="btn off"><i class="${ic}"></i><span>${label}<small>Not available: ${REASON[t]}</small></span></div>`;
  }).join("");
  $("shareLink").value = `${location.origin}/get.html?app=${S.shareId}`;
  $("done").hidden = false;
  if (!quiet) $("done").scrollIntoView({ behavior: "smooth", block: "start" });
  $("gen").disabled = false;
}

$("copyLink").onclick = () => navigator.clipboard.writeText($("shareLink").value).then(() => toast("Link copied"), () => toast("Copy failed. Select the link and copy it."));
$("gen").onclick = generate;

async function loadHistory() {
  const { data, error } = await supabase.from("apps").select("*").order("updated_at", { ascending: false });
  if (error) {
    $("history").innerHTML = `<p class="hint">History is not available: ${esc(error.message)}</p>`;
    return;
  }
  S.apps = data;
  $("history").innerHTML = data.length ? data.map((a) => {
    const files = Object.keys(a.files || {}).filter((t) => TYPES[t]).map((t) => `<a class="chip" href="/api/download?id=${esc(a.job_id)}&type=${t}"><i class="${TYPES[t][0]}"></i> ${t.toUpperCase()}</a>`).join("");
    return `<div class="item" data-id="${esc(a.id)}">
<span>${a.icon ? `<img src="${esc(a.icon)}" alt="">` : '<span class="ph"><i class="fa-solid fa-mobile-screen"></i></span>'}</span>
<div><b>${esc(a.name)}</b><span class="meta">Version ${esc(a.version)} · ${new Date(a.updated_at).toLocaleDateString()}</span>
<div class="chips">${files}<button class="chip" data-act="share" type="button"><i class="fa-solid fa-share-nodes"></i> Share</button><a class="chip" href="/get.html?app=${esc(a.share_id)}" target="_blank" rel="noopener"><i class="fa-solid fa-eye"></i> View</a><button class="chip" data-act="update" type="button"><i class="fa-solid fa-arrows-rotate"></i> Update</button><button class="chip danger" data-act="del" type="button"><i class="fa-solid fa-trash"></i> Delete</button></div></div></div>`;
  }).join("") : '<p class="hint">No apps yet. Your first build will appear here.</p>';
}

function fillFrom(a) {
  const c = a.config || {};
  setSrc(c.sourceType || "github");
  if (c.sourceType === "repo") { S.repo = { name: c.source, branch: c.branch }; showChosen(); }
  if (c.sourceType === "github") { $("src").value = c.source || ""; $("branch").value = c.branch || ""; }
  if (c.sourceType === "site") $("siteUrl").value = c.source || "";
  $("name").value = a.name;
  $("pkg").value = a.package_id;
  $("pkg").dataset.touched = "1";
  $("start").value = c.startPage || "";
  $("api").value = c.apiBase || "";
  $("paths").value = c.apiPaths || "/api/";
  document.querySelectorAll("[name=t]").forEach((x) => (x.checked = (c.targets || []).includes(x.value)));
  S.reuse = a;
  S.icon = null;
  S.iconInfo = null;
  S.thumb = a.icon;
  $("iconPrev").innerHTML = a.icon ? `<img src="${esc(a.icon)}" alt="">` : '<i class="fa-regular fa-image"></i>';
  updateIconNote();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast(c.sourceType === "zip" ? "Loaded. Choose the ZIP again, then tap Generate." : "Loaded. Change what you need and tap Generate.");
}

$("history").onclick = async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = S.apps.find((x) => x.id === b.closest(".item").dataset.id);
  if (!a) return;
  if (b.dataset.act === "share") {
    const link = `${location.origin}/get.html?app=${a.share_id}`;
    navigator.clipboard.writeText(link).then(() => toast("Share link copied"), () => toast(link));
  }
  if (b.dataset.act === "update") fillFrom(a);
  if (b.dataset.act === "del" && confirm(`Delete "${a.name}" from history?`)) {
    const { error } = await supabase.from("apps").delete().eq("id", a.id);
    if (error) toast(error.message);
    loadHistory();
  }
};

function start() {
  if (S.started) return;
  S.started = true;
  const q = new URLSearchParams(location.search), gh = q.get("gh");
  if (gh) {
    history.replaceState(null, "", location.pathname);
    if (gh === "connected") toast("GitHub connected. Choose a repository.");
    else toast(ghReason(q.get("why")), 9000);
  }
  loadGithub();
  loadHistory();
  restoreWork();
}
