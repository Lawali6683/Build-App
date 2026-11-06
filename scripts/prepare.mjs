
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const E = process.env;
const sh = (c, a, o = {}) => execFileSync(c, a, { stdio: "inherit", ...o });
const fail = (m) => { console.error("::error::" + m); process.exit(1); };
const root = process.cwd(), proj = path.join(root, "project"), out = path.join(root, "out"), www = path.join(out, "www");
const has = (f) => fs.existsSync(path.join(proj, f));

fs.rmSync(proj, { recursive: true, force: true });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });


if (E.SOURCE_TYPE === "github") {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(E.SOURCE) || !/^[\w./-]+$/.test(E.BRANCH)) fail("Invalid GitHub link or branch.");
  const url = E.SOURCE_TOKEN ? E.SOURCE.replace("https://", `https://x-access-token:${E.SOURCE_TOKEN}@`) : E.SOURCE;
  try { sh("git", ["clone", "--depth", "1", "--branch", E.BRANCH, url, proj]); }
  catch { fail("Could not clone the repository. Check the link, the branch name, and that the repository is public."); }
  fs.rmSync(path.join(proj, ".git"), { recursive: true, force: true });
} else {
  fs.mkdirSync(proj);
  try { sh("unzip", ["-q", path.join(root, "jobdata/jobs", E.JOB_ID, "project.zip"), "-d", proj]); }
  catch { fail("Could not open the ZIP file."); }
  const items = fs.readdirSync(proj).filter((n) => n !== "__MACOSX");
  if (items.length === 1 && fs.statSync(path.join(proj, items[0])).isDirectory()) {
    const d = path.join(proj, items[0]);
    for (const n of fs.readdirSync(d)) fs.renameSync(path.join(d, n), path.join(proj, n));
    fs.rmdirSync(d);
  }
}


let webDir = null;
if (has("package.json")) {
  const pkg = JSON.parse(fs.readFileSync(path.join(proj, "package.json"), "utf8"));
  if (pkg.scripts && pkg.scripts.build) {
    try {
      sh("npm", [has("package-lock.json") ? "ci" : "install"], { cwd: proj });
      sh("npm", ["run", "build"], { cwd: proj });
    } catch { fail("The project's own build failed. See the log above."); }
    webDir = ["dist", "build", "out", ".output/public", "public"].find((d) => fs.existsSync(path.join(proj, d, "index.html")));
  }
}
if (!webDir) webDir = has("index.html") ? "." : has("public/index.html") ? "public" : null;
if (!webDir) fail("No index.html found. Put index.html in the project root, or add a build script that creates dist, build or out.");

const base = path.join(proj, webDir);
const skip = new Set([".git", "node_modules", "functions", ".github", ".wrangler", "wrangler.toml", "package.json", "package-lock.json", ".dev.vars"]);
fs.cpSync(base, www, { recursive: true, filter: (s) => webDir !== "." || !skip.has(path.relative(base, s).split(path.sep)[0]) });

// 3. Inject the API shim
const SHIM = `(function(){
  var BASE=__BASE__, PATHS=__PATHS__;
  function fix(u){
    try{
      var r=new URL(u,location.href);
      if(r.origin===location.origin&&PATHS.some(function(p){return r.pathname.indexOf(p)===0;}))
        return BASE+r.pathname+r.search+r.hash;
    }catch(e){}
    return u;
  }
  var f=window.fetch;
  window.fetch=function(i,o){
    if(typeof i==="string"||i instanceof URL) return f.call(this,fix(String(i)),o);
    if(i&&i.url){var n=fix(i.url); if(n!==i.url) return f.call(this,new Request(n,i),o);}
    return f.call(this,i,o);
  };
  var x=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){var a=[].slice.call(arguments);a[1]=fix(String(u));return x.apply(this,a);};
})();
`;
const apiBase = E.API_BASE.replace(/\/+$/, "");
const apiPaths = E.API_PATHS.split(",").map((s) => s.trim()).filter(Boolean);
fs.writeFileSync(path.join(www, "idt-api-shim.js"), SHIM.replace("__BASE__", () => JSON.stringify(apiBase)).replace("__PATHS__", () => JSON.stringify(apiPaths)));
const tag = '<script src="/idt-api-shim.js"></script>';

const rawStart = (E.START_PAGE || "").trim();
let startUrl = "";
if (rawStart) {
  const clean = "/" + rawStart.replace(/^\/+/, "");
  const file = clean.split(/[?#]/)[0];
  if (file.includes("..") || !/^[\w\-./]*$/.test(file)) fail("Invalid start page.");
  if (/\.html?$/i.test(file) && !fs.existsSync(path.join(www, file))) fail(`Start page "${file}" was not found in the project. Check the file name and folder.`);
  if (file !== "/index.html" && file !== "/") startUrl = clean;
}
const startTag = startUrl
  ? `<script>(function(){try{if(!sessionStorage.getItem("idt_start")){sessionStorage.setItem("idt_start","1");location.replace(${JSON.stringify(startUrl)});}}catch(e){}})();</script>`
  : "";
let pages = 0;
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.html?$/i.test(n)) {
      let h = fs.readFileSync(p, "utf8");
      const t = (p === path.join(www, "index.html") && startTag ? startTag + "\n" : "") + tag;
      h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + "\n" + t) : t + "\n" + h;
      fs.writeFileSync(p, h); pages++;
    }
  }
})(www);
console.log(`API shim added to ${pages} page(s). Base: ${apiBase}, paths: ${apiPaths.join(", ")}, start page: ${startUrl || "index.html"}`);


const icon = path.join(root, "jobdata/jobs", E.JOB_ID, "icon.png");
if (!fs.existsSync(icon)) fail("Icon file is missing.");
fs.copyFileSync(icon, path.join(out, "icon.png"));
fs.writeFileSync(path.join(out, "capacitor.config.json"), JSON.stringify({ appId: E.PACKAGE_ID, appName: E.APP_NAME, webDir: "www", server: { androidScheme: "https" } }, null, 2));
fs.writeFileSync(path.join(out, "safe-name.txt"), E.APP_NAME.replace(/[^A-Za-z0-9]/g, "") || "App");
