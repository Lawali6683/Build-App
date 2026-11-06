export const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function authorize(req, env) {
  const given = req.headers.get("x-idt-key") || "", want = env.ACCESS_KEY || "";
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
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

export const validId = (id) => /^[a-f0-9]{10}$/.test(id || "");

export function b64(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function releaseFiles(env, id) {
  const r = await gh(env, `/repos/${env.GITHUB_REPO}/releases/tags/job-${id}`);
  if (!r.ok) return null;
  const rel = await r.json(), files = {};
  for (const a of rel.assets || []) {
    const ext = a.name.split(".").pop();
    if (["apk", "aab", "ipa"].includes(ext)) files[ext] = { name: a.name, id: a.id };
  }
  return files;
}
