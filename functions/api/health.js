import { json, gh } from "../_lib.js";

const REPO = "Lawali6683/Build-App";

async function why(r) {
  try { return (await r.json()).message || ""; } catch { return ""; }
}

export async function onRequestGet({ request, env }) {
  const out = {
    ok: true,
    GITHUB_TOKEN: !!env.GITHUB_TOKEN,
    GITHUB_CLIENT_ID: !!env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: !!env.GITHUB_CLIENT_SECRET,
    TOKEN_KEY: /^[a-f0-9]{64}$/.test(env.TOKEN_KEY || ""),
  };
  if (!new URL(request.url).searchParams.get("deep")) return json(out);
  if (!env.GITHUB_TOKEN) return json({ ...out, fix: "GITHUB_TOKEN is missing in Cloudflare." });

  const repo = env.GITHUB_REPO || REPO;
  const deep = {};
  try {
    const r = await gh(env, `/repos/${repo}`);
    deep.repository = r.ok ? "found" : `not available (${r.status}) ${await why(r)}`.trim();
    const b = await gh(env, `/repos/${repo}/branches/jobs`);
    deep.branch_jobs = b.ok ? "found" : `missing (${b.status})`;
    const w = await gh(env, `/repos/${repo}/actions/workflows/build.yml`);
    deep.workflow = w.ok ? "found" : `missing (${w.status})`;
    const p = `/repos/${repo}/contents/health/ping.txt`;
    const cur = await gh(env, `${p}?ref=jobs`, { headers: { accept: "application/vnd.github.object+json" } });
    const body = { message: "health check", content: btoa(String(Date.now())), branch: "jobs" };
    if (cur.ok) body.sha = (await cur.json()).sha;
    const x = await gh(env, p, { method: "PUT", body: JSON.stringify(body) });
    deep.write = x.ok ? "ok" : `failed (${x.status}) ${await why(x)}`.trim();
  } catch (e) {
    deep.error = String(e && e.message ? e.message : e);
  }

  let fix = "All good. The token can reach and write to the repository.";
  if (deep.error) fix = "Could not reach GitHub: " + deep.error;
  else if (deep.repository !== "found") fix = "The token cannot see the repository. Create the token while logged in as the owner of the repository, and give it access to that repository.";
  else if (deep.branch_jobs !== "found") fix = "The branch named jobs does not exist. Create it in the repository.";
  else if (deep.write !== "ok") fix = "The token cannot write. Give it Contents: Read and write (or the repo scope for a classic token).";
  else if (deep.workflow !== "found") fix = "The file .github/workflows/build.yml was not found on the main branch.";
  return json({ ...out, deep, fix });
}
