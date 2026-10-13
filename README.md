# SFDA coach feedback

This application implements the runtime foundation, database access rules, preview coach interface and the local account and preparation path in [spec 0005](docs/specs/0005-first-real-coach-feedback-path/index.md). React runs in the browser. A Cloudflare Worker serves the API and static application assets through one origin.

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

You can open `http://127.0.0.1:5173`. Preview uses synthetic coach fixtures, exposes no Supabase connection values and disables voice. Its fixture writes are temporary. Account provisioning is unavailable in preview.

With Docker running, you can start real local Supabase, apply the migrations, and establish the first synthetic administrator:

```sh
pnpm db:start
pnpm db:apply
APP_ENV=local pnpm db:bootstrap
pnpm dev:local
```

Before bootstrap, you can supply `SFDA_BOOTSTRAP_EMAIL` through your runtime environment using a generated `synthetic-UUID@example.invalid` address, and optionally supply `SFDA_BOOTSTRAP_NAME`. Bootstrap prompts for a concealed password, or accepts `SFDA_BOOTSTRAP_PASSWORD` as an ephemeral runtime secret. It refuses an existing administrator or email, and only targets this project's local API. `dev:local` reads CLI status, fills missing connection bindings in ignored `.dev.vars`, and refuses conflicting settings. You can sign in at `http://127.0.0.1:5173`. An enabled admin provisions coach and player accounts, creates a campaign, assigns them and opens preparation. Password links appear in local Mailpit at `http://127.0.0.1:54324`. Each recipient explicitly sets their own password, then signs in normally.

Sessions stay in memory. Reloading requires another login. Explicit saved drafts and submitted feedback remain in Supabase. New setup endpoints require the local profile and exact loopback origin. Missing settings return `503 CONFIG_INVALID` and never select preview.

## Configuration

| Setting               | Source and use                                                         |
| --------------------- | ---------------------------------------------------------------------- |
| `APP_ENV`             | Explicit Wrangler profile, `local`, `preview` or `production`          |
| `APP_ORIGIN`          | `http://127.0.0.1:5173` locally, exact authorised origin when hosted   |
| `RELEASE_ID`          | `local` for local development, commit SHA for a hosted release         |
| `SUPABASE_URL`        | Local CLI or new production project public connection value            |
| `SUPABASE_PUBLIC_KEY` | Local CLI or new production project public client key                  |
| `SUPABASE_ADMIN_KEY`  | Local CLI service key, used only inside the Worker for local setup     |
| `VOICE_ENABLED`       | Explicit boolean setting, false by default and always false in preview |

The compatibility date is `2026-10-06`. You can change it through a reviewed runtime update. No Node compatibility flag is enabled. `wrangler types` records runtime types for the configured date and bindings.

Local configuration files are ignored. You can keep only placeholder examples in the repository. The configuration response uses an explicit field allowlist and `Cache-Control: no-store`. It never returns admin credentials or provider secrets. Request logs contain generated IDs, fixed route labels, status, elapsed time, environment and release ID. They exclude raw paths, queries and request bodies.

Worker and account names in `wrangler.jsonc` are local scaffold identifiers. Hosted identifiers, origins and credentials remain to be recorded during authorised provisioning. No production deployment workflow is included in this scaffold.

## Code boundaries

| Path                   | Responsibility                                                                |
| ---------------------- | ----------------------------------------------------------------------------- |
| `src/app/`             | Login, local admin setup, own account status and coach preparation interface  |
| `src/domain/`          | Pure shared response contracts, with no runtime or secret imports             |
| `src/worker/`          | Standard Worker Fetch handler and configuration validation                    |
| `supabase/migrations/` | Preparation, final lifecycle and private local account setup transactions     |
| `e2e/`                 | Browser and API checks against built assets and the real local Worker runtime |

Browser and shared modules cannot import `src/worker/`. Supabase sessions stay in memory. Production account delivery and voice providers remain separate features.

## Local data model

The data slice implements [spec 0002](docs/specs/0002-fresh-data-model-access-rules/index.md). Supabase owns access rules and atomic writes. The browser uses the caller's token for named database functions. The Worker adds local account provisioning and password setup, backed by a private operation journal. Ordinary feedback remains caller authorised.

You can run a Docker compatible runtime, then start this project's local Supabase services:

```sh
pnpm db:start
pnpm db:apply
pnpm db:types
pnpm test:db
```

The recorded CLI uses PostgreSQL 17. `db:apply` applies pending local migrations while preserving existing records. `db:types` generates [database.types.ts](src/domain/database.types.ts) from the live schema. The CLI's function types omit nullable arguments, so [database.ts](src/domain/database.ts) adds the explicit null inputs required by the spec.

`test:db` checks the fixed local API target before passing local keys to Vitest in memory. It creates synthetic Auth accounts and records through real Supabase calls. It uses the fixed local database container for schema, grant, fingerprint and calendar evidence. The trusted fixture setup is not a production admin bootstrap procedure. The scripts withhold keys and raw provider errors from output.

The checks cover private reads and direct write denial, permanent pairings, draft versions, reviewed submissions, stage changes, frozen obligations, final and waiver races, completion, corrections, revocation and retention. A lost response check commits a real database write, then deliberately drops its network response. Provider voice calls remain off. The shared voice contract tests are simulations, not live provider evidence.

Public signup is disabled. The local email provider remains enabled so provisioned accounts can use password login. Local Auth, profile and feedback fixtures are created at runtime. No credentials or real player data are included in source.

You can replay the migrations from scratch with `pnpm db:reset`. This removes local fixture data and refuses any Auth account outside the generated synthetic fixture. It never uses a linked or hosted project. You can restart local services after configuration changes with `pnpm db:restart`, which preserves data.

Submitted originals, pairings, obligations, corrections, waivers, receipts and audits are retained. Ending a feedback stage deletes its unfinished drafts in the same transaction. The preparation interface reuses these rules. Final stage and correction editing controls, approved deletion, production account delivery, live voice and production migration delivery remain separate work. Real player use still needs the project's consent and location decisions and release evidence.

## Checks

You can run the scaffold checks together:

```sh
pnpm check
```

You can also run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test` and `pnpm e2e` separately. Vitest checks configuration failures and log redaction in Node. Playwright builds the explicit preview profile and checks React, direct SPA navigation, uncached API responses and JSON errors through workerd. These scaffold checks do not establish database permissions, real authentication or hosted readiness. You can use the separate `pnpm test:db` command for real local database evidence. It requires Docker and the applied migrations, and is not silently skipped by `pnpm check`.

You can run `pnpm test:auth` for the pinned invitation and recovery compatibility gate. `pnpm e2e:live` uses real local Auth, captured mail and the local Worker. It requires a clean synthetic bootstrap database, or both `SFDA_LIVE_ADMIN_EMAIL` and `SFDA_LIVE_ADMIN_PASSWORD` supplied through your runtime environment for a verified existing local bootstrap admin. The runner never adopts an unrelated account. The live test covers account setup, password choice, assignments, explicit submission, another login, saved draft resume and a second submission. Proof URLs, passwords, browser storage, traces, screenshots and raw provider responses are excluded from retained evidence.

The preparation harness includes `database_accounts`, `browser_preparation` and `preparation_accessibility`, in addition to the existing database and foundation checks. You can run `APP_ENV=local pnpm verify --mode check --profile preparation`. The full browser check requires both engines and the supplied local bootstrap credentials. Missing prerequisites remain missing, and advisory runs keep `releaseReady: false`.

GitHub Actions runs `pnpm verify --mode check --profile foundation` for pull requests and pushes to `main`, through [.github/workflows/checks.yml](.github/workflows/checks.yml). You can run the same command locally. The [harness guide](verification/README.md) explains profiles, reports, evidence and strict release gates. Missing evidence can give advisory success, while every advisory report prints `releaseReady: false`. CI installs Chromium and WebKit, uses the frozen lockfile and retains safe reports for 30 days. Actions are pinned to full commit IDs. New commits cancel older checks for the same pull request or branch.

The workflow uses read access to repository contents and does not retain checkout credentials or reference production secrets. Pull requests use the ordinary `pull_request` event, including forks. Production deployment remains separate work. Once a GitHub run passes, you can require the `Scaffold checks` status in your main branch rules.

If Playwright needs its browser binaries, you can install them with `pnpm exec playwright install chromium webkit`. The checks use both engines at desktop and mobile sizes. You can close any process on port 5173 before running `pnpm e2e`; its server is isolated and does not reuse an existing app.

If the Chromium download is unavailable and you already have Google Chrome installed, you can use `PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm e2e`. WebKit is still required. For a partial Chromium check, you can use `PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm e2e --project=chromium_desktop --project=chromium_mobile`. The partial check does not fulfil the full browser matrix.

You can inspect a built local app with `pnpm build` followed by `pnpm preview`. For a built fixture profile, you can use `pnpm build:preview` followed by `pnpm preview`. Cloudflare selects the environment at development or build time. Setting `CLOUDFLARE_ENV` only when starting `vite preview` does not switch the profile already built.

## Formatting and commit checks

Oxlint checks code quality. Prettier handles formatting, using single quotes and omitting optional semicolons to match the scaffold. TypeScript remains strict for browser code, Worker code, tests and tooling scripts.

You can apply formatting with `pnpm format`, or check it without changing files with `pnpm format:check`. Formatting covers source, tests, tooling scripts, runtime configuration and this README. The exclusions in `.prettierignore` preserve workflow documents, agent instructions, generated Worker types and lockfiles. Prettier also respects `.gitignore`.

The Git hook in `.githooks/pre-commit` runs `pnpm check:commit`, which runs lint, formatting checks and type checks. A failed check blocks the commit. These checks inspect your working tree and do not format or stage files for you. You can run the same command directly before a commit.

You can activate the hook with `pnpm prepare`. Fresh dependency installation also runs this setup, but pnpm may skip it when repeating an unchanged install. Setup is safe to repeat and uses only this repository's Git configuration. If the folder has no `.git`, setup reports a skip. You can run `pnpm prepare` again once a Git repository exists. Existing custom hook settings or hooks in the default Git hooks directory are preserved, with a message explaining the skip.

The scope remains in progress under the GA workflow. Suggested next: `/check verify first real coach feedback path`, then the separate tests, independent review and release documentation recorded in scope. Local synthetic checks do not establish production delivery or real player readiness.
