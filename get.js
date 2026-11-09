import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("app") || "";
const TYPES = {
  apk: ["fa-brands fa-android", "Android", "Download APK", "Open the file on your phone and allow installation from this source."],
  ipa: ["fa-brands fa-apple", "iPhone", "Download IPA", "iPhone apps are installed through TestFlight or the App Store."],
  exe: ["fa-brands fa-windows", "Windows", "Download installer", "Run the installer on your computer."],
};

function say(text) {
  $("view").hidden = true;
  $("state").hidden = false;
  $("state").querySelector("p").textContent = text;
}

async function main() {
  if (!/^[a-f0-9]{16}$/.test(id)) return say("This link is not valid.");
  const { data, error } = await supabase.rpc("get_app", { p_share: id });
  const app = Array.isArray(data) ? data[0] : data;
  if (error || !app) return say("App not found. The link may be old.");
  document.title = app.name + " | IDT";
  $("appName").textContent = app.name;
  $("appTitle").textContent = app.name;
  $("appVer").textContent = "Version " + app.version;
  $("appDate").textContent = "Updated " + new Date(app.updated_at).toLocaleDateString();
  if (app.icon) $("appIcon").src = app.icon;
  else $("appIcon").hidden = true;
  const files = app.files || {};
  const items = Object.keys(TYPES).filter((t) => files[t]);
  $("platforms").replaceChildren(...items.map((t) => {
    const [ic, title, label, note] = TYPES[t];
    const a = document.createElement("a");
    a.className = "btn";
    a.href = `/api/download?id=${app.job_id}&type=${t}`;
    const i = document.createElement("i");
    i.className = ic;
    const s = document.createElement("span");
    s.textContent = title + " · " + label;
    const sm = document.createElement("small");
    sm.textContent = note;
    s.appendChild(sm);
    a.append(i, s);
    return a;
  }));
  if (!items.length) $("platforms").innerHTML = '<p class="hint">No files are ready yet.</p>';
  $("state").hidden = true;
  $("view").hidden = false;
}

main();
