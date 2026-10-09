# SFDA application foundation

This scaffold implements the runtime foundation in [spec 0001](docs/specs/0001-architecture-environments/index.md). It starts from the official Vite React TypeScript initializer. React runs in the browser. A Cloudflare Worker serves the API and static application assets through one origin.

You can use Node 24 (the local version is recorded in `.node-version`) and pnpm 11.5.2 (pinned in `package.json`). The exact resolved dependencies are recorded in `pnpm-lock.yaml`.

## Start locally

You can install the recorded dependencies and generate Worker types:

```sh
pnpm install --frozen-lockfile
pnpm prepare
pnpm typegen
```

You can run the scaffold without database settings through its explicit preview profile:

```sh
pnpm dev:preview
```

You can open `http://127.0.0.1:5173`. This profile exposes no Supabase connection values and always disables voice. Its API has only health and configuration routes. It contains no account, player or feedback fixtures yet.

For the local live profile, you can copy `.dev.vars.example` to `.dev.vars` and fill `SUPABASE_URL` and `SUPABASE_PUBLIC_KEY` from your local Supabase CLI output. Then you can run:

```sh
pnpm dev
```

Without these settings, `/api/health` and `/api/config` return `503 CONFIG_INVALID`. Missing settings never select preview mode. Supabase setup and migrations belong to later features. The scaffold does not connect to a database.

## Configuration

| Setting               | Source and use                                                         |
| --------------------- | ---------------------------------------------------------------------- |
| `APP_ENV`             | Explicit Wrangler profile, `local`, `preview` or `production`          |
| `APP_ORIGIN`          | `http://127.0.0.1:5173` locally, exact authorised origin when hosted   |
| `RELEASE_ID`          | `local` for local development, commit SHA for a hosted release         |
| `SUPABASE_URL`        | Local CLI or new production project public connection value            |
| `SUPABASE_PUBLIC_KEY` | Local CLI or new production project public client key                  |
| `VOICE_ENABLED`       | Explicit boolean setting, false by default and always false in preview |

The compatibility date is `2026-10-06`. You can change it through a reviewed runtime update. No Node compatibility flag is enabled. `wrangler types` records runtime types for the configured date and bindings.

Local configuration files are ignored. You can keep only placeholder examples in the repository. The configuration response uses an explicit field allowlist and `Cache-Control: no-store`. It never returns admin credentials or provider secrets. Request logs contain generated IDs, fixed route labels, status, elapsed time, environment and release ID. They exclude raw paths, queries and request bodies.

Worker and account names in `wrangler.jsonc` are local scaffold identifiers. Hosted identifiers, origins and credentials remain to be recorded during authorised provisioning. No production deployment workflow is included in this scaffold.

## Code boundaries

| Path                   | Responsibility                                                                |
| ---------------------- | ----------------------------------------------------------------------------- |
| `src/app/`             | Browser entry and React Router, currently a plain foundation placeholder      |
| `src/domain/`          | Pure shared response contracts, with no runtime or secret imports             |
| `src/worker/`          | Standard Worker Fetch handler and configuration validation                    |
| `supabase/migrations/` | Reserved for reviewed SQL migrations, currently empty                         |
| `e2e/`                 | Browser and API checks against built assets and the real local Worker runtime |

Browser and shared modules cannot import `src/worker/`. Future authentication uses Supabase with sessions held only in memory, as specified in the architecture. Authentication and provider clients are not installed until their features need them.

## Checks

You can run the scaffold checks together:

```sh
pnpm check
```

You can also run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test` and `pnpm e2e` separately. Vitest checks configuration failures and log redaction in Node. Playwright builds the explicit preview profile and checks React, direct SPA navigation, uncached API responses and JSON errors through workerd. These checks do not establish database permissions, real authentication or hosted readiness.

GitHub Actions runs the same `pnpm check` command for pull requests and pushes to `main`, through [.github/workflows/checks.yml](.github/workflows/checks.yml). It uses Node from `.node-version`, pnpm from `package.json`, the frozen lockfile and Playwright's Chromium with its Linux dependencies. Actions are pinned to full commit IDs. New commits cancel older checks for the same pull request or branch.

The workflow uses read access to repository contents and does not retain checkout credentials or reference production secrets. Pull requests use the ordinary `pull_request` event, including forks. Production deployment remains separate work. Once a GitHub run passes, you can require the `Scaffold checks` status in your main branch rules.

If Playwright needs its Chromium binary, you can install it with `pnpm exec playwright install chromium`. You can close any process on port 5173 before running `pnpm e2e`; its server is isolated and does not reuse an existing app.

If the browser download is unavailable and you already have Google Chrome installed, you can use `PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm e2e`. The default uses Playwright's recorded Chromium version; this optional setting uses your installed browser instead.

You can inspect a built local app with `pnpm build` followed by `pnpm preview`. For a built fixture profile, you can use `pnpm build:preview` followed by `pnpm preview`. Cloudflare selects the environment at development or build time. Setting `CLOUDFLARE_ENV` only when starting `vite preview` does not switch the profile already built.

## Formatting and commit checks

Oxlint checks code quality. Prettier handles formatting, using single quotes and omitting optional semicolons to match the scaffold. TypeScript remains strict for browser code, Worker code, tests and tooling scripts.

You can apply formatting with `pnpm format`, or check it without changing files with `pnpm format:check`. Formatting covers source, tests, tooling scripts, runtime configuration and this README. The exclusions in `.prettierignore` preserve workflow documents, agent instructions, generated Worker types and lockfiles. Prettier also respects `.gitignore`.

The Git hook in `.githooks/pre-commit` runs `pnpm check:commit`, which runs lint, formatting checks and type checks. A failed check blocks the commit. These checks inspect your working tree and do not format or stage files for you. You can run the same command directly before a commit.

You can activate the hook with `pnpm prepare`. Fresh dependency installation also runs this setup, but pnpm may skip it when repeating an unchanged install. Setup is safe to repeat and uses only this repository's Git configuration. If the folder has no `.git`, setup reports a skip. You can run `pnpm prepare` again once a Git repository exists. Existing custom hook settings or hooks in the default Git hooks directory are preserved, with a message explaining the skip.

The scope remains in progress under the GA workflow. Suggested next: `/audit` to capture conventions from this scaffold. Hosted setup, production deployment, database features and coach interface work remain separate tasks.
