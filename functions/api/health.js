import { json } from "../_lib.js";

export async function onRequestGet({ env }) {
  return json({
    ok: true,
    GITHUB_TOKEN: !!env.GITHUB_TOKEN,
    GITHUB_CLIENT_ID: !!env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: !!env.GITHUB_CLIENT_SECRET,
    TOKEN_KEY: /^[a-f0-9]{64}$/.test(env.TOKEN_KEY || ""),
  });
}
