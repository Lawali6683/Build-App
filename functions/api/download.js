import { json, authorize, gh, validId, releaseFiles } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!authorize(request, env)) return json({ error: "Wrong access key." }, 401);
  const p = new URL(request.url).searchParams, id = p.get("id"), type = p.get("type");
  if (!validId(id) || !["apk", "aab", "ipa"].includes(type)) return json({ error: "Invalid request." }, 400);
  const file = ((await releaseFiles(env, id)) || {})[type];
  if (!file) return json({ error: "File not found." }, 404);
  const r = await gh(env, `/repos/${env.GITHUB_REPO}/releases/assets/${file.id}`, { headers: { accept: "application/octet-stream" }, redirect: "follow" });
  if (!r.ok) return json({ error: `GitHub error ${r.status}.` }, 502);
  return new Response(r.body, {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${file.name}"`, "cache-control": "no-store" },
  });
}
