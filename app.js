"use strict";
const $ = (id) => document.getElementById(id);
const S = { src: "github", icon: null, zip: null, job: null, files: {} };
const STEPS = [
  ["prepare", "fa-solid fa-cloud-arrow-down", "Importing and preparing project"],
  ["android", "fa-brands fa-android", "Building Android app"],
  ["ios", "fa-brands fa-apple", "Building iPhone app"],
  ["publish", "fa-solid fa-box-archive", "Packaging files"],
];
const toast = (t) => { const e = $("toast"); e.textContent = t; e.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => (e.style.display = "none"), 4000); };
const safe = (n) => n.replace(/[^A-Za-z0-9]/g, "");

$("key").value = sessionStorage.getItem("idt_key") || "";
$("key").addEventListener("input", () => sessionStorage.setItem("idt_key", $("key").value));

async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { ...(opt.headers || {}), "x-idt-key": $("key").value.trim() } });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || "Server error " + r.status);
  return j;
}

document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
  document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", "false"));
  t.setAttribute("aria-selected", "true");
  S.src = t.dataset.src;
  $("ghBox").hidden = S.src !== "github";
  $("zipBox").hidden = S.src !== "zip";
}));

$("name").addEventListener("input", () => {
  if (!$("pkg").dataset.touched) { const s = safe($("name").value).toLowerCase(); $("pkg").value = /^[a-z]/.test(s) ? "com.idt." + s : ""; }
});
$("pkg").addEventListener("input", () => ($("pkg").dataset.touched = "1"));

$("pickZip").onclick = () => $("zip").click();
$("zip").onchange = function () {
  const f = this.files[0]; S.zip = null; $("zipName").textContent = "";
  if (!f) return;
  if (f.size > 10e6) { $("srcErr").textContent = "ZIP is larger than 10 MB. Use GitHub for bigger projects."; return; }
  S.zip = f; $("zipName").textContent = f.name; $("srcErr").textContent = "";
};

$("pickIcon").onclick = () => $("icon").click();
$("icon").onchange = function () {
  const f = this.files[0]; S.icon = null; $("iconErr").textContent = "";
  if (!f) return;
  if (f.type !== "image/png") { $("iconErr").textContent = "Icon must be a PNG file."; return; }
  const img = new Image();
  img.onload = () => {
    if (img.width !== img.height || img.width < 1024) { $("iconErr").textContent = `Icon must be square and at least 1024×1024 px. Yours is ${img.width}×${img.height}.`; return; }
    S.icon = f; $("iconPrev").innerHTML = ""; $("iconPrev").appendChild(img);
  };
  img.src = URL.createObjectURL(f);
};

function validate() {
  let ok = true;
  const set = (id, m) => { $(id).textContent = m; if (m) ok = false; };
  ["srcErr", "nameErr", "pkgErr", "apiErr", "pathsErr", "startErr", "genErr"].forEach((i) => ($(i).textContent = ""));
  if (!$("key").value.trim()) { set("genErr", "Enter the team access key."); }
  if (S.src === "github") {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test($("src").value.trim())) set("srcErr", "Enter a full GitHub link like https://github.com/owner/repo");
  } else if (!S.zip) set("srcErr", "Choose a ZIP file.");
  if (!/^[A-Za-z0-9][A-Za-z0-9 .\-]{0,29}$/.test($("name").value.trim())) set("nameErr", "Use 1-30 letters, numbers, spaces, dots or dashes.");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test($("pkg").value.trim())) set("pkgErr", "Use lowercase letters and dots, like com.idt.movies");
  const sp = $("start").value.trim();
  if (sp && (sp.includes("..") || !/^\/?[\w\-./]*(\?[\w\-=&.%]*)?(#[\w\-\/=&.%]*)?$/.test(sp))) set("startErr", "Use a path like register.html or /dashboard.html");
  if (!S.icon) set("iconErr", "Upload a valid app icon.");
  try { if (new URL($("api").value.trim()).protocol !== "https:") throw 0; } catch { set("apiErr", "Enter your live API domain, starting with https://"); }
  if (!/^\/[\w\-./]*(,\s*\/[\w\-./]*)*$/.test($("paths").value.trim())) set("pathsErr", "Paths must start with / and be separated by commas.");
  return ok;
}

function render(jobs) {
  jobs = jobs || {};
  $("steps").innerHTML = STEPS.map(([k, ic, label]) => {
    const st = jobs[k] || "pending";
    const icon = st === "success" ? "fa-solid fa-check" : st === "running" ? "fa-solid fa-spinner fa-spin" : st === "failed" ? "fa-solid fa-xmark" : st === "skipped" ? "fa-solid fa-minus" : ic;
    return `<li class="${st}"><i class="${icon}"></i><span>${label}${st === "skipped" ? " (not set up on the server)" : ""}</span></li>`;
  }).join("");
  const n = Object.values(jobs).filter((v) => ["success", "failed", "skipped"].includes(v)).length;
  $("barIn").style.width = Math.max(5, (n / STEPS.length) * 100) + "%";
}
const fail = (m) => { $("genErr").textContent = m; $("gen").disabled = false; };

async function generate() {
  if (!validate()) return toast("Fix the highlighted fields first.");
  $("done").hidden = true; $("progress").hidden = false; $("gen").disabled = true; render({});
  const fd = new FormData();
  fd.append("sourceType", S.src);
  fd.append("source", $("src").value.trim());
  fd.append("branch", $("branch").value.trim() || "main");
  fd.append("appName", $("name").value.trim());
  fd.append("packageId", $("pkg").value.trim());
  fd.append("apiBase", $("api").value.trim());
  fd.append("apiPaths", $("paths").value.trim());
  fd.append("startPage", $("start").value.trim());
  fd.append("icon", S.icon);
  if (S.src === "zip") fd.append("zip", S.zip);
  try { const j = await api("/api/build", { method: "POST", body: fd }); S.job = j.id; poll(0); }
  catch (e) { $("progress").hidden = true; fail(e.message); }
}

async function poll(n) {
  try {
    const j = await api("/api/status?id=" + S.job);
    render(j.jobs);
    if (j.state === "done") { S.files = j.files || {}; return finish(); }
    if (j.state === "error") return fail(j.error + (j.logUrl ? " Details: " + j.logUrl : ""));
  } catch (e) { if (/access key/i.test(e.message)) return fail(e.message); }
  if (n > 600) return fail("The build took too long. Check GitHub Actions.");
  setTimeout(() => poll(n + 1), 4000);
}

function finish() {
  const test = S.files.apk && /-debug\.apk$/.test(S.files.apk);
  $("doneMsg").textContent = $("name").value.trim() + " is ready." + (test ? " This APK is a test build because no Android release key is set up on the server." : " Choose a file to download.");
  document.querySelectorAll("[data-dl]").forEach((b) => {
    const has = !!S.files[b.dataset.dl];
    b.disabled = !has; b.hidden = false;
    if (!has) b.querySelector("small").textContent = b.dataset.dl === "ipa" ? "Not available: iPhone signing is not set up on the server" : "Not available: release signing key is not set up on the server";
  });
  $("done").hidden = false; $("done").scrollIntoView({ behavior: "smooth", block: "start" });
  $("gen").disabled = false;
}

document.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = async () => {
  const type = b.dataset.dl, name = S.files[type];
  if (!name) return;
  b.disabled = true;
  try {
    const r = await fetch(`/api/download?id=${S.job}&type=${type}`, { headers: { "x-idt-key": $("key").value.trim() } });
    if (!r.ok) throw new Error("Download failed (" + r.status + ")");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob()); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (e) { toast(e.message); }
  b.disabled = false;
}));

$("gen").onclick = generate;