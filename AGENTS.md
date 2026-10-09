# SFDA coach feedback

## Stack

TypeScript with strict checking, React and Vite, React Router in library mode, and a Cloudflare Worker using the standard Fetch handler. Node 24 is local tooling; Worker code runs in workerd through the Cloudflare Vite plugin. Use pnpm 11.5.2 and the recorded lockfile. This is one package; `pnpm-workspace.yaml` only allows dependency build scripts.
The approved [architecture](docs/specs/0001-architecture-environments/index.md) selects Supabase PostgreSQL, Supabase Auth and its JavaScript client, SQL migrations and generated database types, Workers Static Assets, GitHub Actions, native Worker logs, and later ElevenLabs Agents. The runtime scaffold and local data model are implemented. Account delivery, sign in screens, voice and hosted delivery setup remain future work.

## Build approach

Tracer Bullet (prove one real path through account access, a campaign, a player and saved feedback, then expand it). Source: [scope](docs/scope/scope.md).

## Commands

You can install with `pnpm install --frozen-lockfile` and generate Worker types with `pnpm typegen`.
You can run the explicit preview with `pnpm dev:preview` at `http://127.0.0.1:5173`. For local live configuration, see [README.md](README.md) and `.dev.vars.example`, then use `pnpm dev`.
You can run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test` and `pnpm e2e`, or all required checks through `pnpm check`. Use `pnpm format` to apply formatting and `pnpm check:commit` for the commit checks. Use `pnpm build:preview` then `pnpm preview` to inspect built preview assets; the environment is selected at development or build time.
Playwright builds the preview and runs its own server on port 5173 through workerd. The port must be free. You can use `PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm e2e` when the recorded Chromium binary is unavailable. Vitest runs Worker logic checks in Node; those checks do not establish actual Worker runtime compatibility or database access rules.
With Docker running, you can use `pnpm db:start`, `pnpm db:apply`, `pnpm db:types` and `pnpm test:db` for local Supabase. The database suite runs separately from `pnpm check`. Generated public schema types live in `src/domain/database.types.ts`; `src/domain/database.ts` adds the nullable function inputs required by spec 0002.

## Specs

You can start with [scope](docs/scope/scope.md) for current intent and confirmed design decisions, then read the relevant `docs/specs/NNNN-title/index.md`. Design approval and implementation status are separate. The workflow is GA, with real app verification, tests, independent review and release evidence. Scaffold evidence is in [verify.md](docs/specs/0001-architecture-environments/verify.md); hosted, database and provider evidence remains separate.
The [data checklist](docs/specs/0002-fresh-data-model-access-rules/verify.md) records the initial build evidence. It is not a completed separate verification report. Current executable checks live in `supabase/tests/`, `src/domain/` and `src/app/data/`.

## Rules

* Prefer pure functions with explicit inputs and outputs. Compose functions rather than adding classes where a plain function works. Use `map`, `filter` or `reduce` when they improve clarity.
* Prefer immutable data, `const` and `readonly`. Return new values rather than mutating inputs. Keep module values constant and avoid shared mutable state. Keep network calls, logging and state changes explicit at runtime boundaries.
* Keep TypeScript strict. Prefer `unknown` with validation at external boundaries, precise unions and exhaustive handling rather than `any`. For new internal optional values, prefer explicit `undefined` unions; preserve specified `null` response contracts.
* Use explicit results or error returns for expected failures. Preserve specified API codes and response shapes. Return safe errors with request IDs rather than provider responses or exception dumps.
* Keep browser code in `src/app/`, pure shared contracts in `src/domain/`, server code in `src/worker/`, SQL in `supabase/migrations/`, and browser checks in `e2e/`. Browser and shared modules cannot import Worker code or secrets.
* Validate configuration at the Worker boundary. Missing live settings produce `CONFIG_INVALID`; preview is an explicit profile with null Supabase values and voice disabled. API responses use `Cache-Control: no-store`.
* Follow consistent naming: camel case values and response fields, Pascal case React components and types, and upper snake case environment bindings.
* Target WCAG AA accessibility in the UI, including clear labels, keyboard access, visible focus and accessible errors.
* Keep credentials, real player records, feedback, audio and transcripts out of source, fixtures and public artifacts. Logs use generated IDs and fixed route labels, excluding raw URLs, queries, bodies and private data.
* Future authentication keeps sessions only in memory. Supabase owns authoritative access and atomic data rules. Voice produces proposed text for coach review; explicit coach submission is a separate action.

## Tooling

You chose Oxlint plus Prettier, and lint, format checks and type checks before each commit. Both tools and the hook in `.githooks/pre-commit` are implemented. You can activate the hook with `pnpm prepare` once this folder has a Git repository; setup preserves existing custom hooks. Prettier excludes workflow documents, agent instructions and generated files through `.prettierignore`. Vitest and Playwright are installed. GitHub Actions [checks](.github/workflows/checks.yml) run `pnpm check` for pull requests and pushes to `main`, using recorded Node and pnpm versions, pinned actions and Playwright Chromium. Pull request jobs use read access and receive no production secrets. Production deployment remains future work. Later database checks use real local Supabase; preview checks cannot establish database permissions or live voice readiness.

## Git

* integration: off

## Agent skills

* [architect](.agents/skills/architect/): `jsmastery-pro/skills`, design decisions and specifications.
* [audit](.agents/skills/audit/): `jsmastery-pro/skills`, initial project context.
* [check](.agents/skills/check/): `jsmastery-pro/skills`, real app verification and independent review.
* [debug](.agents/skills/debug/): `jsmastery-pro/skills`, bug reproduction and minimal fixes.
* [develop](.agents/skills/develop/): `jsmastery-pro/skills`, implementation from approved designs.
* [document](.agents/skills/document/): `jsmastery-pro/skills`, change and release prose.
* [scope](.agents/skills/scope/): `jsmastery-pro/skills`, product scope and feature order.
* [sync](.agents/skills/sync/): `jsmastery-pro/skills`, context updates and scope reconciliation after changes.
* [test](.agents/skills/test/): `jsmastery-pro/skills`, tests for implemented changes.

Deferred by you: technology skills and MCP discovery, search and installation. Earlier candidates are Cloudflare `cloudflare`, `wrangler` and `workers-best-practices`, Supabase `supabase` and `supabase-postgres-best-practices`, and ElevenLabs `agents` before voice work.
MCP servers: local Supabase (recommended, deferred), Cloudflare (recommended, deferred), ElevenLabs (recommended, deferred). No project connection is recorded.

## Context files

* [.github/AGENTS.md](.github/AGENTS.md): GitHub Actions checks and delivery boundaries.
* [supabase/AGENTS.md](supabase/AGENTS.md): SQL access rules, local database commands and synthetic evidence boundaries.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
