import { json, gh, authorize } from "../_lib.js";

const REPO = "Lawali6683/Build-App";

const clean = (l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "").replace(/\u001b\[[0-9;]*m/g, "").trim();
const keep = (l) => l && !/^##\[(end)?group\]/.test(l) && !/^at\s/.test(l) && !l.startsWith("node:internal");

async function excerpt(env, job) {
  try {
    const r = await gh(env, `/repos/${env.GITHUB_REPO}/actions/jobs/${job.id}/logs`, { redirect: "follow" });
    if (!r.ok) return [`The log could not be read (${r.status}).`];
    const lines = (await r.text()).split("\n").map(clean).filter(keep);
    const i = lines.findIndex((l) => l.startsWith("##[error]"));
    const part = i < 0 ? lines.slice(-25) : [...lines.slice(Math.max(0, i - 15), i), ...lines.slice(i).filter((l) => l.startsWith("##[error]"))];
    return part.map((l) => l.replace(/^##\[error\]/, "ERROR: ").slice(0, 240));
  } catch (e) {
    return [String(e && e.message ? e.message : e)];
  }
}

export async function onRequestGet({ request, env }) {
  env = { ...env, GITHUB_REPO: env.GITHUB_REPO || REPO };
  const pin = new URL(request.url).searchParams.get("pin") || "";
  if (!(await authorize(new Request("https://check.local", { headers: { "x-idt-pin": pin } }), env))) return json({ error: "Add ?pin=YOUR_PIN at the end of the address." }, 401);
  if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is missing in Cloudflare." }, 500);

  const rr = await gh(env, `/repos/${env.GITHUB_REPO}/actions/workflows/build.yml/runs?per_page=1`);
  if (!rr.ok) return json({ error: `GitHub error ${rr.status}.` }, 502);
  const run = ((await rr.json()).workflow_runs || [])[0];
  if (!run) return json({ error: "No build has run yet." });

  const jr = await gh(env, `/repos/${env.GITHUB_REPO}/actions/runs/${run.id}/jobs`);
  const jobs = [];
  for (const j of (await jr.json()).jobs || []) {
    const item = { name: j.name, status: j.status, conclusion: j.conclusion };
    if (j.conclusion === "failure") {
      item.steps = (j.steps || []).map((s) => `${s.name}: ${s.conclusion || s.status}`);
      item.log = await excerpt(env, j);
    }
    jobs.push(item);
  }
  return json({ run: { id: run.id, title: run.display_title, status: run.status, conclusion: run.conclusion, url: run.html_url }, jobs });
}
