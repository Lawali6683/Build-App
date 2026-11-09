import { json, authorize, gh, b64, cookie, seal, randomId, SUPABASE } from "../_lib.js";

const PNG = [0x89, 0x50, 0x4e, 0x47];
const TARGETS = ["apk", "aab", "ipa", "exe"];

async function put(env, path, buf) {
  const api = `/repos/${env.GITHUB_REPO}/contents/${path}`;
  const cur = await gh(env, `${api}?ref=jobs`, { headers: { accept: "application/vnd.github.object+json" } });
  const body = { message: "job upload", content: b64(buf), branch: "jobs" };
  if (cur.ok) body.sha = (await cur.json()).sha;
  const r = await gh(env, api, { method: "PUT", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Could not store the upload (GitHub ${r.status}). Check that branch "jobs" exists and the token can write contents.`);
}

async function exists(env, path) {
  return (await gh(env, `/repos/${env.GITHUB_REPO}/contents/${path}?ref=jobs`, { headers: { accept: "application/vnd.github.object+json" } })).ok;
}

export async function onRequestPost({ request, env }) {
  if (!(await authorize(request, env))) return json({ error: "Locked. Enter the PIN again." }, 401);
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return json({ error: "Server is not configured: GITHUB_TOKEN or GITHUB_REPO is missing." }, 500);

  let f;
  try { f = await request.formData(); } catch { return json({ error: "Invalid form data." }, 400); }
  const v = (k) => String(f.get(k) || "").trim();
  const sourceType = v("sourceType"), source = v("source"), branch = v("branch") || "main";
  const appName = v("appName"), packageId = v("packageId"), apiPaths = v("apiPaths") || "/api/", startPage = v("startPage");
  const targets = v("targets").split(",").filter((t) => TARGETS.includes(t));
  const version = parseInt(v("version") || "1", 10);
  const shareId = v("shareId") || randomId();

  let apiBase;
  try {
    const u = new URL(v("apiBase"));
    if (u.protocol !== "https:") throw 0;
    apiBase = u.href.replace(/\/+$/, "");
  } catch { return json({ error: "API base URL must be a valid https:// address." }, 400); }

  if (!/^[A-Za-z0-9][A-Za-z0-9 .\-]{0,29}$/.test(appName)) return json({ error: "App name: 1-30 letters, numbers, spaces, dots or dashes." }, 400);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId)) return json({ error: "Package ID must look like com.idt.movies." }, 400);
  if (!/^\/[\w\-./]*(,\s*\/[\w\-./]*)*$/.test(apiPaths)) return json({ error: "API paths must start with / and be separated by commas." }, 400);
  if (startPage && (startPage.includes("..") || !/^\/?[\w\-./]*(\?[\w\-=&.%]*)?(#[\w\-\/=&.%]*)?$/.test(startPage))) return json({ error: "Start page must look like register.html or /dashboard.html." }, 400);
  if (!/^[\w./-]{1,100}$/.test(branch) || branch.includes("..")) return json({ error: "Invalid branch name." }, 400);
  if (!targets.length) return json({ error: "Choose at least one file type." }, 400);
  if (!(version >= 1 && version <= 99999)) return json({ error: "Invalid version." }, 400);
  if (!/^[a-f0-9]{16}$/.test(shareId)) return json({ error: "Invalid app id." }, 400);

  let enc = "";
  if (sourceType === "github") {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(source)) return json({ error: "Enter a full GitHub link like https://github.com/owner/repo." }, 400);
  } else if (sourceType === "repo") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(source)) return json({ error: "Invalid repository." }, 400);
    const tok = cookie(request, "gh_token");
    if (!tok) return json({ error: "Connect your GitHub account first." }, 400);
    if (!env.TOKEN_KEY || !/^[a-f0-9]{64}$/.test(env.TOKEN_KEY)) return json({ error: "Server is not configured: TOKEN_KEY must be 64 hex characters." }, 500);
    enc = await seal(env, tok);
  } else if (sourceType === "site") {
    try { if (new URL(source).protocol !== "https:") throw 0; } catch { return json({ error: "Website link must start with https://" }, 400); }
  } else if (sourceType !== "zip") return json({ error: "Unknown project source." }, 400);

  const iconPath = `icons/${shareId}.png`;
  const icon = f.get("icon");
  const id = randomId();
  try {
    if (icon && typeof icon !== "string") {
      const ib = await icon.arrayBuffer(), iu = new Uint8Array(ib);
      if (ib.byteLength > 4e6 || !PNG.every((b, i) => iu[i] === b)) return json({ error: "Icon must be a PNG under 4 MB." }, 400);
      const dv = new DataView(ib), w = dv.getUint32(16), h = dv.getUint32(20);
      if (w !== h || w < 1024) return json({ error: `Icon must be square and at least 1024x1024 px. Yours is ${w}x${h}.` }, 400);
      await put(env, iconPath, ib);
    } else if (!(await exists(env, iconPath))) return json({ error: "App icon is missing." }, 400);

    if (sourceType === "zip") {
      const z = f.get("zip");
      if (!z || typeof z === "string") return json({ error: "ZIP file is missing." }, 400);
      const zb = await z.arrayBuffer(), zu = new Uint8Array(zb);
      if (zb.byteLength > 10e6 || zu[0] !== 0x50 || zu[1] !== 0x4b) return json({ error: "ZIP must be a valid .zip file under 10 MB. For bigger projects use GitHub." }, 400);
      await put(env, `jobs/${id}/project.zip`, zb);
    }

    const config = {
      sourceType, source, branch, appName, packageId, apiBase, apiPaths, startPage, targets, shareId, version, enc,
      builderUrl: new URL(request.url).origin, supabaseUrl: SUPABASE.url, supabaseKey: SUPABASE.key,
    };
    const d = await gh(env, `/repos/${env.GITHUB_REPO}/actions/workflows/build.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: env.GITHUB_REF || "main", inputs: { job_id: id, config: JSON.stringify(config) } }),
    });
    if (d.status !== 204) return json({ error: `Could not start the build (GitHub ${d.status}). Check token permissions: Actions read/write.` }, 502);
  } catch (e) { return json({ error: e.message }, 502); }
  return json({ id, shareId, version });
}
