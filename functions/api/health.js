import { json, gh, authorize } from "../_lib.js";

const REPO = "Lawali6683/Build-App";

async function why(r) {
  try { return (await r.json()).message || ""; } catch { return ""; }
}

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const out = {
    ok: true,
    GITHUB_TOKEN: !!env.GITHUB_TOKEN,
    GITHUB_CLIENT_ID: !!env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: !!env.GITHUB_CLIENT_SECRET,
    TOKEN_KEY: /^[a-f0-9]{64}$/.test(env.TOKEN_KEY || ""),
  };
  if (!q.get("deep")) return json(out);
  if (!env.GITHUB_TOKEN) return json({ ...out, fix: "GITHUB_TOKEN is missing in Cloudflare." });

  const repo = env.GITHUB_REPO || REPO;
  const deep = { repo };
  try {
    const r = await gh(env, `/repos/${repo}`);
    let base = "main";
    if (r.ok) base = (await r.json()).default_branch || "main";
    deep.repository = r.ok ? "found" : `not available (${r.status}) ${await why(r)}`.trim();

    const list = async () => {
      const b = await gh(env, `/repos/${repo}/branches?per_page=50`);
      return b.ok ? (await b.json()).map((x) => x.name) : [];
    };
    let names = await list();

    if (r.ok && !names.includes("jobs") && q.get("create")) {
      const allowed = await authorize(new Request("https://check.local", { headers: { "x-idt-pin": q.get("pin") || "" } }), env);
      if (!allowed) deep.create = "The PIN is wrong, nothing was created.";
      else {
        const ref = await gh(env, `/repos/${repo}/git/ref/heads/${base}`);
        const sha = ref.ok ? (await ref.json()).object.sha : "";
        const c = sha
          ? await gh(env, `/repos/${repo}/git/refs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: "refs/heads/jobs", sha }) })
          : null;
        deep.create = c && c.ok ? `The branch jobs was created from ${base}.` : `failed (${c ? c.status : ref.status}) ${c ? await why(c) : await why(ref)}`.trim();
        names = await list();
      }
    }

    deep.branches = names;
    deep.branch_jobs = names.includes("jobs") ? "found" : "missing";

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
  else if (deep.repository !== "found") fix = "The token cannot see the repository " + repo + ". Create the token while logged in as the owner of the repository, and give it access to that repository.";
  else if (deep.branch_jobs !== "found") fix = "The branch jobs was not found in " + repo + ". Compare the names in the branches list. To create it now, open this address again with &create=1&pin=YOUR_PIN at the end.";
  else if (deep.write !== "ok") fix = "The token cannot write. Give it Contents: Read and write (or the repo scope for a classic token).";
  else if (deep.workflow !== "found") fix = "The file .github/workflows/build.yml was not found on the main branch.";
  return json({ ...out, deep, fix });
}
