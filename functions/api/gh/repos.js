import { json, authorize, cookie, setCookie } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!(await authorize(request, env))) return json({ error: "Locked. Enter the PIN again." }, 401);
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
