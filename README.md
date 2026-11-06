# IDT App Builder

Web UI (Cloudflare Pages) + API (Pages Functions) + build pipeline (GitHub Actions + Capacitor).

## Layout
- `public/` UI (index.html, style.css, app.js). Cloudflare output directory = `public`.
- `functions/api/` build.js, status.js, download.js. `lib/github.js` shared helpers.
- `.github/workflows/build.yml` + `scripts/prepare.mjs` build pipeline.
- `docs/cors-middleware.js` copy into each project that has its own API.

## One-time setup
1. Private GitHub repo, upload all files, create a branch named `jobs` (branch dropdown, type `jobs`).
2. Repo Settings > Actions > General > Workflow permissions: Read and write.
3. Fine-grained token for this repo only: Contents RW, Actions RW. Add it to Cloudflare Pages as `GITHUB_TOKEN` (encrypted).
4. Cloudflare Pages variables: `GITHUB_REPO` (owner/idt-app-builder), `ACCESS_KEY` (team password), optional `GITHUB_REF` (default main). Build command empty, output `public`.
5. Android signing (repo Secrets): `keytool -genkeypair -v -keystore idt-release.jks -alias idt -keyalg RSA -keysize 2048 -validity 10000`, then `base64 -w0 idt-release.jks`.
   Secrets: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD. Back the .jks up safely.
6. iPhone signing: App Store Connect > Users and Access > Integrations > create an API key (Admin or App Manager).
   Secrets: IOS_API_KEY_P8_BASE64, IOS_API_KEY_ID, IOS_API_ISSUER_ID, IOS_TEAM_ID.
7. Optional `SOURCE_TOKEN` secret to import private GitHub repos.
