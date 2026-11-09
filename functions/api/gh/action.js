import { json, authorize, cookie, setCookie } from "../../_lib.js";

const redirect = (location, cookies = []) => {
  const h = new Headers({ location });
  cookies.forEach((c) => h.append("set-cookie", c));
  return new Response(null, { status: 302, headers: h });
};

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const action = params.action;

  if (action === "login") {
    if (!env.GITHUB_CLIENT_ID) return json({ error: "GITHUB_CLIENT_ID is not set." }, 500);
    const state = crypto.randomUUID().replace(/-/g, "");
    const to = new URL("https://github.com/login/oauth/authorize");
    to.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    to.searchParams.set("scope", "repo");
    to.searchParams.set("state", state);
    to.searchParams.set("redirect_uri", url.origin + "/api/gh/callback");
    return redirect(to.href, [setCookie("gh_state", state, 600)]);
  }

  if (action === "callback") {
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    const clear = setCookie("gh_state", "", 0);
    if (!code || !state || state !== cookie(request, "gh_state")) return redirect("/?gh=failed", [clear]);
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "idt-app-builder" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
    });
    const t = await r.json().catch(() => ({}));
    if (!t.access_token) return redirect("/?gh=failed", [clear]);
    return redirect("/?gh=connected", [setCookie("gh_token", t.access_token, 28800), clear]);
  }

  if (!(await authorize(request, env))) return json({ error: "Locked. Enter the PIN again." }, 401);

  if (action === "repos") {
    const token = cookie(request, "gh_token");
    if (!token) return json({ connected: false });
    const h = { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "idt-app-builder" };
    const me = await fetch("https://api.github.com/user", { headers: h });
    if (!me.ok) return json({ connected: false }, 200, { "set-cookie": setCookie("gh_token", "", 0) });
    const user = await me.json(), repos = [];
    for (let p = 1; p <= 5; p++) {
      const r = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated&page=${p}`, { headers: h });
      if (!r.ok) break;
      const list = await r.json();
      for (const x of list) repos.push({ name: x.full_name, private: x.private, branch: x.default_branch });
      if (list.length < 100) break;
    }
    return json({ connected: true, login: user.login, avatar: user.avatar_url, repos });
  }

  if (action === "logout") return json({ ok: true }, 200, { "set-cookie": setCookie("gh_token", "", 0) });
  return json({ error: "Not found." }, 404);
}
