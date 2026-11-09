import { json, authorize, gh, validId, releaseFiles } from "../_lib.js";

const KEYS = { "Prepare project": "prepare", "Android app": "android", "iPhone app": "ios", "Windows app": "desktop", "Publish files": "publish" };
const state = (j) => j.status !== "completed" ? (j.status === "in_progress" ? "running" : "pending")
  : j.conclusion === "success" ? "success" : j.conclusion === "skipped" ? "skipped" : "failed";

export async function onRequestGet({ request, env }) {
  if (!(await authorize(request, env))) return json({ error: "Locked. Enter the PIN again." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!validId(id)) return json({ error: "Invalid job id." }, 400);

  const rr = await gh(env, `/repos/${env.GITHUB_REPO}/actions/workflows/build.yml/runs?event=workflow_dispatch&per_page=50`);
  if (!rr.ok) return json({ error: `GitHub error ${rr.status}.` }, 502);
  const run = ((await rr.json()).workflow_runs || []).find((r) => r.display_title === "Build " + id);
  if (!run) return json({ state: "queued", jobs: {} });

  const jr = await gh(env, `/repos/${env.GITHUB_REPO}/actions/runs/${run.id}/jobs`);
  const jobs = {}, names = {};
  for (const j of (await jr.json()).jobs || []) { const k = KEYS[j.name]; if (k) { jobs[k] = state(j); names[k] = j.name; } }

  if (run.status !== "completed") return json({ state: "running", jobs });
  const warnings = Object.keys(jobs).filter((k) => jobs[k] === "failed");
  if (jobs.publish === "success") {
    const rf = (await releaseFiles(env, id)) || {};
    const files = {};
    for (const k of Object.keys(rf)) files[k] = rf[k].name;
    return json({ state: "done", jobs, files, warnings, logUrl: run.html_url });
  }
  return json({ state: "error", jobs, error: `The build stopped at "${names[warnings[0]] || "workflow"}".`, logUrl: run.html_url });
}
