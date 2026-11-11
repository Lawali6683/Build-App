import { json, setCookie } from "../../_lib.js";

export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return json({ error: "GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is not set in Cloudflare." }, 500);
  const url = new URL(request.url);
  const state = crypto.randomUUID().replace(/-/g, "");
  const to = new URL("https://github.com/login/oauth/authorize");
  to.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  to.searchParams.set("scope", "repo");
  to.searchParams.set("state", state);
  to.searchParams.set("redirect_uri", url.origin + "/api/gh/callback");
  const h = new Headers({ location: to.href });
  h.append("set-cookie", setCookie("gh_state", state, 600));
  return new Response(null, { status: 302, headers: h });
}
