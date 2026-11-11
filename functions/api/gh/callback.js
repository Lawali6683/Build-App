import { cookie, setCookie } from "../../_lib.js";

const go = (location, cookies) => {
  const h = new Headers({ location });
  cookies.forEach((c) => h.append("set-cookie", c));
  return new Response(null, { status: 302, headers: h });
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clear = setCookie("gh_state", "", 0);
  const fail = (why) => go("/?gh=failed&why=" + encodeURIComponent(why), [clear]);
  if (url.searchParams.get("error")) return fail("denied");
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state || state !== cookie(request, "gh_state")) return fail("state");
  let t = {};
  try {
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "idt-app-builder" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
    });
    t = await r.json();
  } catch { return fail("network"); }
  if (!t.access_token) return fail(t.error || "token");
  return go("/?gh=connected", [setCookie("gh_token", t.access_token, 28800), clear]);
}
