import { json, authorize, gh, b64 } from "../../lib/github.js";

const PNG = [0x89, 0x50, 0x4e, 0x47];

async function put(env, path, buf) {
  const r = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message: "job upload", content: b64(buf), branch: "jobs" }),
  });
  if (!r.ok) throw new Error(`Could not store the upload (GitHub ${r.status}). Check that branch "jobs" exists and the token can write contents.`);
}

export async function onRequestPost({ request, env }) {
  if (!authorize(request, env)) return json({ error: "Wrong access key." }, 401);
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return json({ error: "Server is not configured: GITHUB_TOKEN or GITHUB_REPO is missing." }, 500);

  let f;
  try { f = await request.formData(); } catch { return json({ error: "Invalid form data." }, 400); }
  const v = (k) => String(f.get(k) || "").trim();
  const sourceType = v("sourceType"), source = v("source"), branch = v("branch") || "main";
  const appName = v("appName"), packageId = v("packageId"), apiPaths = v("apiPaths") || "/api/";
  let apiBase;
  try {
    const u = new URL(v("apiBase"));
    if (u.protocol !== "https:") throw 0;
    apiBase = u.href.replace(/\/+$/, "");
  } catch { return json({ error: "API base URL must be a valid https:// address." }, 400); }

  if (!/^[A-Za-z0-9][A-Za-z0-9 .\-]{0,29}$/.test(appName)) return json({ error: "App name: 1-30 letters, numbers, spaces, dots or dashes." }, 400);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId)) return json({ error: "Package ID must look like com.idt.movies." }, 400);
  if (!/^\/[\w\-./]*(,\s*\/[\w\-./]*)*$/.test(apiPaths)) return json({ error: "API paths must start with / and be separated by commas." }, 400);
  if (!/^[\w./-]{1,100}$/.test(branch) || branch.includes("..")) return json({ error: "Invalid branch name." }, 400);
  if (sourceType === "github" && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(source)) return json({ error: "Enter a full GitHub link like https://github.com/owner/repo." }, 400);
  if (!["github", "zip"].includes(sourceType)) return json({ error: "Unknown project source." }, 400);

  const icon = f.get("icon");
  if (!icon || typeof icon === "string") return json({ error: "App icon is missing." }, 400);
  const ib = await icon.arrayBuffer(), iu = new Uint8Array(ib);
  if (ib.byteLength > 4e6 || !PNG.every((b, i) => iu[i] === b)) return json({ error: "Icon must be a PNG under 4 MB." }, 400);
  const dv = new DataView(ib), w = dv.getUint32(16), h = dv.getUint32(20);
  if (w !== h || w < 1024) return json({ error: `Icon must be square and at least 1024x1024 px. Yours is ${w}x${h}.` }, 400);

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  try {
    await put(env, `jobs/${id}/icon.png`, ib);
    if (sourceType === "zip") {
      const z = f.get("zip");
      if (!z || typeof z === "string") return json({ error: "ZIP file is missing." }, 400);
      const zb = await z.arrayBuffer(), zu = new Uint8Array(zb);
      if (zb.byteLength > 10e6 || zu[0] !== 0x50 || zu[1] !== 0x4b) return json({ error: "ZIP must be a valid .zip file under 10 MB. For bigger projects use GitHub." }, 400);
      await put(env, `jobs/${id}/project.zip`, zb);
    }
    const d = await gh(env, `/repos/${env.GITHUB_REPO}/actions/workflows/build.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: env.GITHUB_REF || "main",
        inputs: { job_id: id, source_type: sourceType, source, branch, app_name: appName, package_id: packageId, api_base: apiBase, api_paths: apiPaths },
      }),
    });
    if (d.status !== 204) return json({ error: `Could not start the build (GitHub ${d.status}). Check token permissions: Actions read/write.` }, 502);
  } catch (e) { return json({ error: e.message }, 502); }
  return json({ id });
}
