export const SUPABASE = {
  url: "https://orhgklhfltsfdumrrhup.supabase.co",
  key: "sb_publishable_8EdSv3j9kxRkIJP7XfSppg_gfBGSkKV",
};

const PIN_HASH = "4522d27a0589a4fc78b133d83f6c80a3a4bc6c0b91fbfafafb93884a026f109c";

export const json = (d, s = 200, h = {}) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });

export async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function authorize(req, env) {
  const pin = req.headers.get("x-idt-pin") || "";
  if (!/^\d{6}$/.test(pin)) return false;
  const got = await sha256(pin), want = env.PIN_HASH || PIN_HASH;
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export const gh = (env, path, init = {}) =>
  fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      authorization: "Bearer " + env.GITHUB_TOKEN,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "idt-app-builder",
      ...(init.headers || {}),
    },
  });

export const validId = (id) => /^[a-f0-9]{16}$/.test(id || "");

export const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function b64(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export const cookie = (req, name) => {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
};

export const setCookie = (name, value, age) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

export async function seal(env, text) {
  const raw = Uint8Array.from(env.TOKEN_KEY.match(/../g), (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}

export async function releaseFiles(env, id) {
  const r = await gh(env, `/repos/${env.GITHUB_REPO}/releases/tags/job-${id}`);
  if (!r.ok) return null;
  const rel = await r.json(), files = {};
  for (const a of rel.assets || []) {
    const ext = a.name.split(".").pop();
    if (["apk", "aab", "ipa", "exe"].includes(ext)) files[ext] = { name: a.name, id: a.id };
  }
  return files;
}
