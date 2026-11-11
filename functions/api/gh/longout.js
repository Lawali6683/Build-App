import { json, authorize, setCookie } from "../../_lib.js";

export async function onRequest({ request, env }) {
  if (!(await authorize(request, env))) return json({ error: "Locked. Enter the PIN again." }, 401);
  return json({ ok: true }, 200, { "set-cookie": setCookie("gh_token", "", 0) });
}
