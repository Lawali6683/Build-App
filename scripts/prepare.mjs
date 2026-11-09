import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const E = process.env;
const C = JSON.parse(E.CONFIG);
const root = process.cwd();
const proj = path.join(root, "project");
const out = path.join(root, "out");
const www = path.join(out, "www");
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const GITHUB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const apiBase = (C.apiBase || (C.sourceType === "site" ? new URL(C.source).origin : "")).replace(/\/+$/, "");
const apiPaths = apiBase ? C.apiPaths.split(",").map((s) => s.trim()).filter(Boolean) : [];
const safeName = C.appName.replace(/[^A-Za-z0-9]/g, "") || "App";

const sh = (c, a, o = {}) => execFileSync(c, a, { stdio: "inherit", ...o });
const fail = (m) => { console.error("::error::" + m); process.exit(1); };
const has = (f) => fs.existsSync(path.join(proj, f));
const walk = (d, fn) => {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p, fn);
    else fn(p);
  }
};
const inExt = (p) => p.includes(path.sep + "_ext" + path.sep);

function unseal(s) {
  const b = Buffer.from(s, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(E.TOKEN_KEY || "", "hex"), b.subarray(0, 12));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString("utf8");
}

async function fetchBuf(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    return { url: r.url, type: r.headers.get("content-type") || "", buf: Buffer.from(await r.arrayBuffer()) };
  } catch { return null; }
}

async function asyncReplace(s, re, fn) {
  const parts = [];
  let last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    parts.push(s.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(s.slice(last));
  return parts.join("");
}

function refs(text, base) {
  const found = new Set();
  const res = [
    /\b(?:href|src|data-src|poster|action)\s*=\s*["']([^"'#][^"']*)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /@import\s+["']([^"']+)["']/gi,
    /(?:from|import)\s*\(?\s*["'](\.{0,2}\/[^"']+)["']/g,
  ];
  for (const re of res) {
    for (const m of text.matchAll(re)) {
      const v = m[1].trim().replace(/&amp;/g, "&");
      if (!v || /^(data:|mailto:|tel:|javascript:|blob:)/i.test(v)) continue;
      try { found.add(new URL(v, base).href.split("#")[0]); } catch {}
    }
  }
  return found;
}

async function crawl(start) {
  const first = new URL(start);
  const queue = [first.href], seen = new Set(), saved = new Map();
  let bytes = 0;
  while (queue.length && saved.size < 500) {
    const href = queue.shift();
    if (seen.has(href)) continue;
    seen.add(href);
    const r = await fetchBuf(href);
    if (!r) continue;
    bytes += r.buf.length;
    if (bytes > 120e6) break;
    const final = new URL(r.url);
    if (final.origin !== first.origin) continue;
    const isHtml = /text\/html/i.test(r.type);
    let rel = decodeURIComponent(final.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    else if (isHtml && !/\.html?$/i.test(rel)) rel += ".html";
    const dest = path.join(www, rel);
    if (!dest.startsWith(www + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, r.buf);
    saved.set(final.pathname, rel);
    saved.set(new URL(href).pathname, rel);
    if (isHtml || /\.(css|m?js)$/i.test(rel)) {
      for (const u of refs(r.buf.toString("utf8"), final.href)) {
        const x = new URL(u);
        if (x.origin !== first.origin || apiPaths.some((p) => x.pathname.startsWith(p))) continue;
        queue.push(x.origin + x.pathname + x.search);
      }
    }
  }
  return saved;
}

function cleanLinks(saved) {
  const pages = new Map();
  for (const [p, rel] of saved) if (/\.html$/i.test(rel) && !/\.html?$/i.test(p) && !p.endsWith("/")) pages.set(p, rel);
  if (!pages.size) return;
  walk(www, (f) => {
    if (!/\.html?$/i.test(f)) return;
    const pageRel = "/" + path.relative(www, f).split(path.sep).join("/");
    let h = fs.readFileSync(f, "utf8");
    h = h.replace(/\b(href|action)\s*=\s*(["'])([^"'#?]+)([^"']*)\2/gi, (all, attr, q, p, rest) => {
      if (/^([a-z]+:|\/\/)/i.test(p)) return all;
      let abs;
      try { abs = new URL(p, "http://x.local" + pageRel).pathname; } catch { return all; }
      const rel = pages.get(abs);
      return rel ? `${attr}=${q}${rel}${rest}${q}` : all;
    });
    fs.writeFileSync(f, h);
  });
}

const MIME = {
  "text/css": ".css", "application/javascript": ".js", "text/javascript": ".js", "font/woff2": ".woff2", "font/woff": ".woff",
  "font/ttf": ".ttf", "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg", "image/webp": ".webp",
  "image/gif": ".gif", "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico", "image/avif": ".avif",
};
const extMap = new Map();
let extBytes = 0;

async function grab(url) {
  if (extMap.has(url)) return extMap.get(url);
  extMap.set(url, null);
  const r = await fetchBuf(url);
  if (!r || r.buf.length > 15e6 || extBytes + r.buf.length > 150e6) return null;
  extBytes += r.buf.length;
  const mime = r.type.split(";")[0].trim().toLowerCase();
  let ext = path.extname(new URL(r.url).pathname).toLowerCase();
  if (!/^\.[a-z0-9]{1,5}$/.test(ext)) ext = MIME[mime] || "";
  const name = "_ext/" + crypto.createHash("sha1").update(url).digest("hex").slice(0, 12) + ext;
  let data = r.buf;
  if (ext === ".css" || mime === "text/css") data = Buffer.from(await cssText(r.buf.toString("utf8"), r.url));
  fs.mkdirSync(path.join(www, "_ext"), { recursive: true });
  fs.writeFileSync(path.join(www, name), data);
  extMap.set(url, "/" + name);
  return "/" + name;
}

async function localUrl(u, base) {
  if (/^(data:|#)/i.test(u)) return null;
  let abs;
  try { abs = new URL(u, base).href; } catch { return null; }
  return /^https?:/i.test(abs) ? grab(abs) : null;
}

async function cssText(css, base) {
  css = await asyncReplace(css, /url\(\s*(["']?)([^"')]+)\1\s*\)/g, async (all, q, u) => {
    const l = await localUrl(u, base);
    return l ? `url("${l}")` : all;
  });
  return asyncReplace(css, /@import\s+(["'])([^"']+)\1/g, async (all, q, u) => {
    const l = await localUrl(u, base);
    return l ? `@import "${l}"` : all;
  });
}

async function htmlText(h) {
  h = await asyncReplace(h, /<(link|script|img|source|video)\b[^>]*>/gi, async (tag, name) => {
    name = name.toLowerCase();
    if (name === "link" && !/rel\s*=\s*["'][^"']*(stylesheet|icon)/i.test(tag)) return tag;
    if (name === "script" && /type\s*=\s*["']module["']/i.test(tag)) return tag;
    const attr = name === "link" ? "href" : name === "video" ? "poster" : "src";
    const m = tag.match(new RegExp(attr + "\\s*=\\s*([\"'])(https?:\\/\\/[^\"']+)\\1", "i"));
    if (!m || /(google-analytics|googletagmanager|gtag|doubleclick|\+esm|\.mjs)/i.test(m[2])) return tag;
    const l = await grab(m[2].replace(/&amp;/g, "&"));
    if (!l) return tag;
    return tag.replace(m[0], `${attr}="${l}"`).replace(/\s(integrity|crossorigin)(\s*=\s*(["'])[^"']*\3)?/gi, "");
  });
  return asyncReplace(h, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, async (all, a, css, z) => a + (await cssText(css)) + z);
}

fs.rmSync(proj, { recursive: true, force: true });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(www, { recursive: true });

if (C.sourceType === "site") {
  const saved = await crawl(C.source);
  if (!fs.existsSync(path.join(www, "index.html"))) fail("Could not download the website. Check the link and that the site is online.");
  cleanLinks(saved);
} else {
  if (C.sourceType === "github" || C.sourceType === "repo") {
    const branch = C.branch || "main";
    if (!/^[\w./-]+$/.test(branch)) fail("Invalid branch name.");
    let url;
    if (C.sourceType === "repo") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(C.source)) fail("Invalid repository.");
      let token;
      try { token = unseal(C.enc); } catch { fail("Could not read the GitHub access. Connect GitHub again and check TOKEN_KEY in both Cloudflare and GitHub secrets."); }
      console.log("::add-mask::" + token);
      url = `https://x-access-token:${token}@github.com/${C.source}.git`;
    } else {
      if (!GITHUB_URL.test(C.source)) fail("Invalid GitHub link.");
      url = C.source;
    }
    try { sh("git", ["clone", "--depth", "1", "--branch", branch, url, proj]); }
    catch { fail("Could not clone the repository. Check the link, the branch name and your access."); }
    fs.rmSync(path.join(proj, ".git"), { recursive: true, force: true });
  } else {
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
}

const todo = [];
walk(www, (f) => { if (!inExt(f) && /\.(html?|css)$/i.test(f)) todo.push(f); });
for (const f of todo) {
  const t = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, /\.css$/i.test(f) ? await cssText(t) : await htmlText(t));
}
console.log(`Saved ${[...extMap.values()].filter(Boolean).length} external file(s) for offline use.`);

const update = C.supabaseUrl
  ? { url: C.supabaseUrl, key: C.supabaseKey, share: C.shareId, version: C.version, link: `${C.builderUrl}/get.html?app=${C.shareId}` }
  : null;
const shim = fs.readFileSync(path.join(root, "scripts/shim.js"), "utf8").replace("__CONFIG__", () => JSON.stringify({ base: apiBase, paths: apiPaths, update }));
fs.writeFileSync(path.join(www, "idt-api-shim.js"), shim);

const rawStart = (C.startPage || "").trim();
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
const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
const tag = '<script src="/idt-api-shim.js"></script>';
let pages = 0;
walk(www, (p) => {
  if (!/\.html?$/i.test(p) || inExt(p)) return;
  let h = fs.readFileSync(p, "utf8");
  let add = "";
  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(h)) add += viewport + "\n";
  if (p === path.join(www, "index.html") && startTag) add += startTag + "\n";
  add += tag;
  h = /<head(\s[^>]*)?>/i.test(h) ? h.replace(/<head(\s[^>]*)?>/i, (m) => m + "\n" + add) : add + "\n" + h;
  fs.writeFileSync(p, h);
  pages++;
});
console.log(`Prepared ${pages} page(s). API: ${apiBase} ${apiPaths.join(", ")}. Start page: ${startUrl || "index.html"}`);

const icon = path.join(root, "jobdata/icons", C.shareId + ".png");
if (!fs.existsSync(icon)) fail("Icon file is missing.");
fs.copyFileSync(icon, path.join(out, "icon.png"));
fs.writeFileSync(path.join(out, "capacitor.config.json"), JSON.stringify({
  appId: C.packageId,
  appName: C.appName,
  webDir: "www",
  server: { androidScheme: "https" },
  android: { adjustMarginsForEdgeToEdge: "auto" },
  ios: { contentInset: "automatic" },
}, null, 2));
fs.writeFileSync(path.join(out, "desktop-package.json"), JSON.stringify({
  name: "idt-" + safeName.toLowerCase(),
  version: `1.0.${C.version}`,
  description: C.appName,
  author: "IDT",
  main: "main.js",
  build: {
    appId: C.packageId,
    productName: C.appName,
    directories: { output: "release" },
    files: ["main.js", "icon.png", "www/**/*"],
    win: { target: "nsis", icon: "icon.png" },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  },
}, null, 2));
fs.writeFileSync(path.join(out, "config.json"), JSON.stringify({ targets: C.targets, version: C.version }));
fs.writeFileSync(path.join(out, "safe-name.txt"), safeName);
