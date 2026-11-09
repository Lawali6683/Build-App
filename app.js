import { supabase } from "./supabase.js";

const PIN_HASH = "4522d27a0589a4fc78b133d83f6c80a3a4bc6c0b91fbfafafb93884a026f109c";
const GH_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const START_RE = /^\/?[\w\-./]*(\?[\w\-=&.%]*)?(#[\w\-\/=&.%]*)?$/;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = { src: "repo", icon: null, thumb: null, zip: null, repo: null, pick: null, repos: [], connected: false, reuse: null, job: null, shareId: "", version: 1, files: {}, warn: [], targets: [], started: false };

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

const toast = (t) => {
  const e = $("toast");
  e.textContent = t;
  e.style.display = "block";
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (e.style.display = "none"), 4500);
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

$("ghConnectBtn").onclick = () => (location.href = "/api/gh/login");
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

$("pickIcon").onclick = () => $("icon").click();
$("icon").onchange = function () {
  const f = this.files[0];
  S.icon = null;
  $("iconErr").textContent = "";
  if (!f) return;
  if (f.type !== "image/png") { $("iconErr").textContent = "Icon must be a PNG file."; return; }
  const img = new Image();
  img.onload = () => {
    if (img.width !== img.height || img.width < 1024) { $("iconErr").textContent = `Icon must be square and at least 1024×1024 px. Yours is ${img.width}×${img.height}.`; return; }
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    c.getContext("2d").drawImage(img, 0, 0, 160, 160);
    S.icon = f;
    S.thumb = c.toDataURL("image/png");
    $("iconPrev").innerHTML = `<img src="${S.thumb}" alt="">`;
  };
  img.src = URL.createObjectURL(f);
};

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
  try { if (new URL($("api").value.trim()).protocol !== "https:") throw 0; } catch { set("apiErr", "Enter your live API domain, starting with https://"); }
  if (!/^\/[\w\-./]*(,\s*\/[\w\-./]*)*$/.test($("paths").value.trim())) set("pathsErr", "Paths must start with / and be separated by commas.");
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
    poll(0);
  } catch (e) {
    $("progress").hidden = true;
    fail(e.message);
  }
}

async function poll(n) {
  try {
    const j = await api("/api/status?id=" + S.job);
    render(j.jobs);
    if (j.state === "done") {
      S.files = j.files || {};
      S.warn = j.warnings || [];
      await saveHistory();
      return finish(j.logUrl);
    }
    if (j.state === "error") return fail(j.error + (j.logUrl ? " Details: " + j.logUrl : ""));
  } catch (e) {
    if (/PIN|Locked/i.test(e.message)) return fail(e.message);
  }
  if (n > 600) return fail("The build took too long. Check GitHub Actions.");
  setTimeout(() => poll(n + 1), 4000);
}

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

function finish(logUrl) {
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
  $("done").scrollIntoView({ behavior: "smooth", block: "start" });
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
  S.thumb = a.icon;
  $("iconPrev").innerHTML = a.icon ? `<img src="${esc(a.icon)}" alt="">` : '<i class="fa-regular fa-image"></i>';
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
  const gh = new URLSearchParams(location.search).get("gh");
  if (gh) {
    history.replaceState(null, "", location.pathname);
    toast(gh === "connected" ? "GitHub connected. Choose a repository." : "GitHub connection failed. Try again.");
  }
  loadGithub();
  loadHistory();
}
