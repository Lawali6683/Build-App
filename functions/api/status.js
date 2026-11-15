import { json, authorize, gh, validId, releaseFiles } from "../_lib.js";

const REPO = "Lawali6683/Build-App";
const KEYS = { "Prepare project": "prepare", "Android app": "android", "iPhone app": "ios", "Windows app": "desktop", "Publish files": "publish" };
const SKIPPED = {
  ios: "iPhone signing is not set up on the server. Add IOS_API_KEY_P8_BASE64, IOS_API_KEY_ID, IOS_API_ISSUER_ID and IOS_TEAM_ID in the GitHub secrets.",
  android: "The Android build did not run.",
  desktop: "The Windows build did not run.",
};
const state = (j) => j.status !== "completed" ? (j.status === "in_progress" ? "running" : "pending")
  : j.conclusion === "success" ? "success" : j.conclusion === "skipped" ? "skipped" : "failed";

async function reason(env, job) {
  const step = (job.steps || []).find((s) => s.conclusion === "failure");
  const out = { step: step ? step.name : "", details: [] };
  try {
    const r = await gh(env, `/repos/${env.GITHUB_REPO}/actions/jobs/${job.id}/logs`, { redirect: "follow" });
    if (!r.ok) return out;
    const lines = (await r.text()).split("\n")
      .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "").replace(/\u001b\[[0-9;]*m/g, "").trim())
      .filter((l) => l && !/^##\[(end)?group\]/.test(l) && !/^at\s/.test(l) && !l.startsWith("node:internal"));
    const i = lines.findIndex((l) => l.startsWith("##[error]"));
    if (i < 0) return out;
    const picked = [...lines.slice(Math.max(0, i - 8), i), ...lines.slice(i).filter((l) => l.startsWith("##[error]"))];
    out.details = picked.slice(-10).map((l) => l.replace(/^##\[error\]/, "ERROR: ").slice(0, 220));
  } catch {}
  return out;
}

export async function onRequestGet({ request, env }) {
  env = { ...env, GITHUB_REPO: env.GITHUB_REPO || REPO };
  if (!(await authorize(request, env))) return json({ error: "Locked. Enter the PIN again." }, 401);
  if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is missing. Add it in Cloudflare, then deploy again." }, 500);
  const id = new URL(request.url).searchParams.get("id");
  if (!validId(id)) return json({ error: "Invalid job id." }, 400);

  const rr = await gh(env, `/repos/${env.GITHUB_REPO}/actions/workflows/build.yml/runs?event=workflow_dispatch&per_page=50`);
  if (!rr.ok) return json({ error: `GitHub error ${rr.status}.` }, 502);
  const run = ((await rr.json()).workflow_runs || []).find((r) => r.display_title === "Build " + id);
  if (!run) return json({ state: "queued", jobs: {} });

  const jr = await gh(env, `/repos/${env.GITHUB_REPO}/actions/runs/${run.id}/jobs`);
  const jobs = {}, names = {}, raw = {};
  for (const j of (await jr.json()).jobs || []) { const k = KEYS[j.name]; if (k) { jobs[k] = state(j); names[k] = j.name; raw[k] = j; } }

  if (run.status !== "completed") return json({ state: "running", jobs });
  const warnings = Object.keys(jobs).filter((k) => jobs[k] === "failed");
  const why = warnings.length ? await reason(env, raw[warnings[0]]) : { step: "", details: [] };
  if (jobs.publish === "success") {
    const rf = (await releaseFiles(env, id)) || {};
    const files = {};
    for (const k of Object.keys(rf)) files[k] = rf[k].name;
    return json({ state: "done", jobs, files, warnings, logUrl: run.html_url, step: why.step, details: why.details });
  }
  const skipped = ["android", "ios", "desktop"].filter((k) => jobs[k] === "skipped");
  const nothing = warnings.length === 1 && warnings[0] === "publish" && skipped.length > 0;
  const error = nothing ? "Nothing was built. " + skipped.map((k) => SKIPPED[k]).join(" ") : `The build stopped at "${names[warnings[0]] || "workflow"}".`;
  return json({ state: "error", jobs, error, logUrl: run.html_url, step: why.step, details: why.details });
}
