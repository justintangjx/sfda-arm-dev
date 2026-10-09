# Verify: Architecture and environments, scaffold

Updated 8 October 2026. You chose to save this checklist during `/develop`.

These steps follow spec 0001. That decision spec has no numbered acceptance criteria or build plan. Coverage below names its contract sections and value sources instead. This checklist covers the scaffold, not hosted setup, authentication, migrations or a pilot release.

## Commands you can run

* [ ] You can use Node 24 and pnpm 11.5.2, then run `pnpm install --frozen-lockfile`. The recorded dependencies install without changing the lockfile. The pnpm configuration permits the pinned esbuild and workerd installation scripts.
* [ ] You can run `pnpm typegen`. Wrangler generates types using compatibility date `2026-10-06` without a Node compatibility flag.
* [ ] You can run `pnpm lint`, `pnpm typecheck` and `pnpm build`. All pass. The build produces separate browser assets and Worker output.
* [ ] You can run `pnpm test`. The synthetic configuration and request log checks pass. Missing local public settings return a configuration error, server secrets stay out of public responses, and unknown URLs do not enter logs.
* [ ] You can run `pnpm e2e`. Playwright builds the explicit preview profile and verifies browser rendering and API behaviour through workerd. If Chromium is unavailable and Chrome is already installed, you can use `PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm e2e` and record that browser choice with the result.

## Browser and runtime steps you can inspect

* [ ] You can run `pnpm dev:preview` and open `http://127.0.0.1:5173`. The SFDA heading renders. Direct navigation to `/foundation/route-check` renders the same scaffold through the SPA fallback without a browser error.
* [ ] You can request `GET /api/health` in preview. It returns HTTP 200 with `service: "sfda-arm"`, `appEnv: "preview"`, `releaseId: "local"` and `status: "ok"`. It establishes a responding Worker, not a working database or provider.
* [ ] You can request `GET /api/config` in preview. It returns the configured environment, origin and release ID, with null Supabase values and `voiceEnabled: false`. Extra connection or provider bindings do not appear in that response.
* [ ] You can navigate directly to `/api`, `/api/not-a-route`, `/api/accounts` and `/api/voice/session`, or send `POST /api/config`. Each returns HTTP 404 JSON containing only `code: "NOT_FOUND"` and a generated `requestId`, including when the browser requests HTML navigation.
* [ ] You can inspect each API response. It uses `Cache-Control: no-store`; unknown API paths never return the browser app HTML.
* [ ] You can stop preview, leave local Supabase settings absent, and run `pnpm dev`. Both known API routes return HTTP 503 with only `code: "CONFIG_INVALID"` and a generated `requestId`. The app does not switch to fixture mode.
* [ ] With designated synthetic local settings from the local Supabase CLI, you can request `/api/config`. It returns those exact public values. These foundation routes make no database request.

## Value source coverage

| Value or boundary | Source in spec 0001 | Check and expected result |
|---|---|---|
| `service`, health `status` | Routing and sessions table, fixed contract | Built runtime health response is `sfda-arm` and `ok` |
| `appEnv` | Explicit `APP_ENV` profile | Preview reports preview; missing or unknown profiles fail validation |
| `appOrigin` | Validated `APP_ORIGIN` binding | Config uses that exact value; invalid URLs or origins containing credentials are rejected |
| `releaseId` | `RELEASE_ID`, commit SHA or local development marker | Unit checks vary local and synthetic production bindings; the response follows the binding |
| `supabaseUrl` and `supabasePublicKey` | Local CLI or production public settings | Unit checks use synthetic values, reject missing live settings and return null in preview |
| `voiceEnabled` | Explicit `VOICE_ENABLED`, default false | Unit checks vary the setting; preview stays false regardless |
| `SUPABASE_ADMIN_KEY` and `ELEVENLABS_API_KEY` | Future server only secret bindings | Synthetic secret values never appear in live or preview configuration responses |
| Deployment credentials | Future trusted deployment job | No deployment credential or workflow is introduced in the scaffold |
| Error `requestId` | `crypto.randomUUID()` at the Worker boundary | Each safe JSON error contains a generated ID; the request log uses the same ID |
| Log route label | Registered route map, fixed labels | Unknown sensitive paths and queries log only `unmatched`, never their raw values |
| Browser and server separation | System boundaries, named module directories | Browser and shared imports do not enter `src/worker/`; the browser build contains no server configuration code or secret binding names |
| API and SPA routing | Routing and sessions, Worker before static fallback | Direct browser navigation renders the scaffold; direct API navigation returns JSON |

## Scaffold self check recorded on 8 October 2026

`pnpm typegen`, `pnpm lint`, `pnpm typecheck`, `pnpm build` and all 19 Vitest checks passed. All three Playwright checks passed against the built explicit preview profile through workerd using installed Google Chrome (`PLAYWRIGHT_BROWSER_CHANNEL=chrome`). Downloading Playwright's matching Chromium version timed out, so that bundled browser was not verified in this run.

The manual inspection boxes remain available for independent verification. No hosted environment, real authentication, database permission or provider behaviour was verified. The architecture feature and spec remain in progress under the GA workflow. You can use `/audit` next to capture project conventions from the runnable scaffold.
