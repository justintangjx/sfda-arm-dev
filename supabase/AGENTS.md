# Supabase data boundary

You can start with [spec 0002](../docs/specs/0002-fresh-data-model-access-rules/index.md) for the schema, privacy rules and atomic write contracts. This area implements the local data model. Account delivery, the coach interface, production migration delivery and live voice remain separate work.

## Local commands

You can run commands from the project root with Docker running. [config.toml](config.toml) selects project `sfda-arm-dev`, PostgreSQL 17 and API port 54321. Public signup is disabled. The email provider stays enabled for password login by provisioned accounts.

You can use `pnpm db:start` to start services, `pnpm db:apply` to apply pending local migrations, `pnpm db:types` to generate public schema types and `pnpm test:db` to run the database suite. `pnpm db:restart` preserves records while restarting services. `pnpm db:reset` removes local fixture data and refuses any Auth account outside the generated synthetic fixture.

[scripts/supabase-local.ts](../scripts/supabase-local.ts) validates the project and fixed local API before privileged checks. It withholds keys and raw provider output. These commands have no hosted target. The database suite is separate from `pnpm check` and uses [vitest.database.config.ts](../vitest.database.config.ts).

## Schema and access

[migrations/](migrations/) contains preparation, final lifecycle and pagination cursor validation migrations. The `public` schema exposes caller scoped tables and functions. The `private` schema holds validation, permission, receipt and mutation helpers. Functions use explicit grants, verified caller identity and an empty `search_path`. Table policies and column grants both restrict reads. Ordinary callers cannot directly mutate tables.

Writes check current profile access, then lock the competition, campaign and affected children in that order. Profile management locks caller and target profiles in UUID order. Mutation receipts bind actor, request ID, action and normalized input fingerprint. Audit and receipt metadata exclude feedback text and observation dates. Known errors use fixed codes through `private.fail`.

Pairings remain bound to their first campaign for a competition. Submitted originals, obligations, waivers, corrections, receipts and audits are immutable. Ending a feedback stage deletes that stage's drafts in the same transaction. Cursor timestamps and UUIDs are validated before list queries, since row comparisons can skip casts under a generic query plan.

`pnpm db:types` owns [database.types.ts](../src/domain/database.types.ts). The hand maintained [database.ts](../src/domain/database.ts) supplies specified nullable function inputs. Browser calls use the caller's token through [src/app/data/](../src/app/data/), with no Worker data proxy.

## Evidence boundaries

[preparation.test.ts](tests/preparation.test.ts) and [final-lifecycle.test.ts](tests/final-lifecycle.test.ts) exercise actual local Auth identities, access policies, writes, races and retention. [fixture.ts](tests/fixture.ts) creates synthetic accounts and records at runtime. Its privileged setup is not a production admin bootstrap procedure. [sql.ts](tests/sql.ts) restricts direct SQL evidence to the fixed local container `supabase_db_sfda-arm-dev`.

[supabase-local.test.ts](tests/supabase-local.test.ts) simulates CLI processes and does not exercise a database. The lost response scenario commits a real write before simulating a network failure. Voice context checks in [feedback.test.ts](../src/domain/feedback.test.ts) are simulations. Local results do not establish hosted permissions, account delivery, live voice or consent for real player use.

_Drafted by /sync from the introducing change, worth a quick human pass._
