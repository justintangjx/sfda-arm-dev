# Fresh data model and access rules verification

This is your saved checklist for a separate verification pass. You asked to save it during `/develop` on 9 October 2026. It is not a completed independent verification report. Implementation follows spec 0002. The build applied both SQL migrations to local PostgreSQL 17 and regenerated the database types. Twenty real local database checks and twenty four unit checks passed on 9 October 2026. Synthetic Auth users and records are created at runtime. The lost response check uses a real commit with a simulated network failure. Voice context checks are simulations. Hosted access, account delivery, live voice, provider retention and real player consent are separate release evidence.

You can use a running Docker compatible runtime, then run `pnpm db:apply`, `pnpm db:types` and `pnpm test:db`. You can run `pnpm check` for the scaffold, unit and browser checks. If recorded Chromium is unavailable, you can use `PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm e2e`. You can use `pnpm db:reset` for a guarded replay of the synthetic fixture database. It refuses any Auth account outside that fixture and has no hosted target.

The executable evidence is in `supabase/tests/preparation.test.ts`, `supabase/tests/final-lifecycle.test.ts`, `supabase/tests/sql.ts`, `src/domain/feedback.test.ts` and `src/app/data/mutations.test.ts`. You can inspect those checks and repeat them through actual caller tokens rather than assuming a passing source inspection proves permission.

## Acceptance checks

1. Provision real local Auth identities for admin, coach, player, disabled and missing profiles. Check fixed roles, disabled defaults and denied public signup. AC-1.
2. Create two campaigns in one competition. Admit a coach and player pairing, remove it, then try to admit it to the other campaign. Expect `PAIR_CONFLICT`, including before any feedback. Race admission with two administrators. AC-2, AC-12.
3. Read each table with anonymous, player, author, other coach, former coach, disabled and admin identities. Expect only the authorised scope. An admin cannot read draft text. Read forbidden profile and receipt columns and try direct DML. Expect denial. AC-3, AC-11, AC-15, AC-16.
4. Submit three preparation observations, save an incomplete draft, reject an unreviewed save and consume a draft with reviewed replacement text. Expect unlimited distinct submissions and one draft per subject. AC-4, AC-5.
5. Reject blank or oversized content, malformed or future dates and unknown content fields. Verify the database date source immediately before and at Singapore midnight. Planned dates must not control feedback permission. AC-5.
6. Advance every stage in order. Reject reversal and skipping. Race a save against the competition transition. Expect exact frozen active pairings and no surviving preparation draft. Disabled player login must not remove an obligation. AC-6, AC-12.
7. Reject new membership after freeze. Restore a removed coach with an audit reason, without adding obligations. Withdraw a player after freeze and still submit its final assessment. AC-7, AC-11.
8. Race distinct final requests. Expect one submission. Replay its committed key after closure and expect the original reference. Another competition must remain independent. AC-8, AC-12.
9. Race final submission against waiver. Expect one winner. Reject missing waiver reasons, repeated waivers and incomplete closure. Close submitted or waived obligations and an explicit zero obligation snapshot. AC-9.
10. Append corrections after closure and race different administrators at the same expected revision. Expect one revision to commit. Preserve original content, author and submission time, and return original plus latest with ordered history. AC-10, AC-12.
11. Remove a coach and withdraw a preparation player. Confirm writes stop while authorised history remains. Disable an account using an already issued token and confirm all work access stops. AC-11.
12. Replay a membership key and check both campaign and person identities. Change the payload under a reused key and expect `IDEMPOTENCY_CONFLICT`. Recover a deliberately lost response after a real commit with one record and one audit event. Reject stale versions without changing newer data. AC-12, AC-15.
13. Verify the reviewed text contract rejects transcript fields and unapproved writes. Compare every voice context revision and discard a simulated late proposal after a stage or permission change, including restoration. No provider implementation or media storage should exist in this slice. AC-13.
14. Inspect restrictive foreign keys and immutable guards. Attempt submitted deletion and Auth deletion with retained history. Expect denial. End stages and confirm deleted draft text and dates are absent from receipts and audit metadata. AC-14.
15. Compare authenticated actors, affected identifiers, database times and reasons in audit records. Failed and replayed requests must add no audit event. Client errors must expose fixed codes and request IDs rather than raw provider details. AC-15.
16. Rebuild the local synthetic database from both migrations, introspect actual tables, grants, functions and the history view, then rerun real role and race checks. Distinguish the real database evidence from simulated voice and network behaviour. AC-16.

## Named value source checks

| Named value | Check you can repeat | Acceptance criteria |
|---|---|---|
| Caller and audit actor | Submit with the coach token and compare `audit_events.actor_id` to `get_my_access.id`. Reject actor override inputs. | AC-1, AC-15 |
| Role, enabled state and permission revision | Change access through `set_profile_access`, compare the database version, then reuse the issued token and expect denied work access. | AC-1, AC-11 |
| Login email | Sign in with the ephemeral Auth email. Query roster profiles and confirm only ID and display name are granted, with no email projection. | AC-1, AC-3 |
| Campaign, team, competition and display labels | Change each full admin snapshot and read it back. Check trimming, normalised uniqueness, nullable dates and stale versions. | AC-2, AC-12 |
| Coach and player membership | Activate and remove exact profile IDs. Check fixed roles, member versions and active flags from their rows. | AC-2, AC-11 |
| Permanent campaign ownership of a pairing | Admit the cross product, remove it and try the same pairing in another campaign. Expect the original immutable ownership to remain. | AC-2, AC-12 |
| Membership audit and replay identity | Replay two different people in the same campaign. Check campaign ID plus coach or player ID in both receipt and audit metadata. | AC-12, AC-15 |
| Frozen eligibility | Compare `final_obligations` to the exact active membership cross product at the competition transition. Later removals must not change it. | AC-6, AC-7 |
| Feedback author and competition | Compare submitted author to the coach token and competition to the campaign row. Reject caller supplied identity overrides. | AC-2, AC-3, AC-4 |
| Feedback content and observation date | Consume a saved draft using replacement reviewed form text and date. Expect the submitted snapshot to contain that replacement. | AC-4, AC-5 |
| Singapore today | Query the actual `private.singapore_today` function at `15:59:59Z` and `16:00:00Z`. Expect the date to advance at Singapore midnight. Confirm submission rejects a future database date. | AC-5, AC-16 |
| IDs, times and committed versions | Check database UUIDs, submission time and version increments. Caller supplied record IDs, times or elevated actors must not replace database values. | AC-5, AC-12, AC-15 |
| Original, corrected content and revision | Correct twice, compare the unchanged original, ordered correction revisions and latest content from the caller scoped history view. | AC-3, AC-10 |
| Waiver and reason | Require a nonblank admin reason, compare the immutable waiver actor and time, and reject both reversal and waiver after submission. | AC-9, AC-15 |
| Completion totals and outstanding list | Compare joins to actual frozen obligations. Check admin campaign scope and coach self scope. Another coach's submission must not affect the coach count. | AC-3, AC-9 |
| Closure and deletion counts | Compare locked transition receipt and audit counts to actual obligations, submitted finals, waivers and deleted drafts. Failed closure must delete nothing. | AC-6, AC-9, AC-15 |
| Mutation key and fingerprint | Preserve the browser generated key across retries. Pin version 1 database JSON serialization and SHA 256, then reject a changed payload under that key. | AC-12, AC-15 |
| Retry result and availability | Replay a committed save after draft expiry. Expect its original reference with `exists: false`, without restoring content. Reject replay after caller disabling. | AC-11, AC-12, AC-14 |
| Page order and cursor | Page profiles and obligations one row at a time, including tied times. Use the named stable ordering for direct history and membership reads. Expect no duplicate or skipped row and a maximum of 100. | AC-3, AC-12 |
| Voice context revision | Capture caller, campaign and membership versions, vary each one independently, then restore access. A simulated old binding must still be rejected. | AC-13 |
| Coach correction attribution | Read the latest correction as its coach and check the fixed `Admin` label. Check the exact admin ID in the correction and private audit records. | AC-3, AC-10, AC-15 |

Separate verification, independent review and release documentation remain open under your GA workflow. This checklist does not establish live voice readiness, hosted permissions, account delivery, an approved deletion procedure or a consent basis for real player data.

## Build check evidence

You can reproduce these results from this source snapshot. No hosted services or real player records were used.

| Check | Result on 9 October 2026 |
|---|---|
| Both local migrations replayed with `pnpm db:reset` | Passed, guarded synthetic target |
| Live schema generation with `pnpm db:types` | Passed |
| Real local database checks with `pnpm test:db` | 20 passed |
| Unit checks with `pnpm test` | 24 passed |
| Lint, format, type checking and build | Passed |
| Browser checks with `PLAYWRIGHT_BROWSER_CHANNEL=chrome pnpm e2e` | 3 passed through the built Worker |

The default `pnpm check` reached its browser phase but could not launch its missing recorded Chromium binary. Its preceding checks passed. The supported installed Chrome fallback then passed all browser checks. The database checks are a separate explicit command, not part of the scaffold CI command.

## Recorded tooling

Node 24.14.0 and pnpm 11.5.2 were used. The local configuration selects PostgreSQL 17. The exact resolved dependencies remain in `pnpm-lock.yaml`.

`supabase`: `2.120.0`.

`@supabase/supabase-js`: `2.117.3`.

`vitest`: `5.0.3`.

`@playwright/test`: `1.63.0`.

## Source snapshot

These SHA 256 values record the migration, fixture and implementation versions used by this build. Git integration is off, so no commit or deployment identity is claimed.

| File | SHA 256 |
|---|---|
| `supabase/migrations/20261009000100_preparation.sql` | `db4a6f2eec5141d8f8651dc56634332c0d816bb6fdcaec2bf1af93be81228cd9` |
| `supabase/migrations/20261009000200_final_lifecycle.sql` | `6400eddba84acf1427bf2621b1d20554f80dbce01858d8c29fd67d19066490a9` |
| `supabase/config.toml` | `b9e6e0c0c74134f24296d7bbc2c35a469c6766fa8bf2c9754e10f7ac32bf462e` |
| `supabase/tests/preparation.test.ts` | `7d5f8c8de0ebcf651867d29b775c75a47e96bd29a49264b8421874a1af3e22c4` |
| `supabase/tests/final-lifecycle.test.ts` | `38e5832500877f7686e060bb29cd058372350df58c1694b971cc632d3a2d59d9` |
| `supabase/tests/fixture.ts` | `8402ac025109d9e76e52ece80c62e5abe4f1b37b78015bbb1413e28e087deae4` |
| `supabase/tests/sql.ts` | `09857b805baa4bb58802a7f76924d8ca55f8d2f77999c2bbc8b3b7a27c5e5b24` |
| `src/domain/database.types.ts` | `fbc115c03539e2e53aced0fc5b29e4282548b8f49bd89b720af9d3a98538ad23` |
| `src/domain/database.ts` | `a863adb0e8e7bcef74910075afc5d7cc8589a33137530c1b3b3354bd5ae55922` |
| `src/domain/feedback.ts` | `08e87f9346fce86932e69594c13401c540f89df568918f61019dabea1b8466c8` |
| `src/domain/feedback.test.ts` | `fa4cfafb4179eda1c79384480377f5dcf663cdf1171f49d125735d8e9590fb7c` |
| `src/app/data/client.ts` | `34557e132466e49135cd4267f1c87fd4ca68033785105b1cc5a3df5756a22f63` |
| `src/app/data/mutations.ts` | `bbf51eb79d23ac056e08bc098ef4107e79982422d7fddc1388f1981c4cf52099` |
| `src/app/data/mutations.test.ts` | `eb557882672fb13cc36b615c6670402b49003f939f27a4b200d64fb8d510549e` |
| `scripts/supabase-local.ts` | `d8579267a347b4fda5fd687288a4cbf6d336f67b8e62b16138b5d563e86ec8e1` |
| `vitest.database.config.ts` | `b35d99bf181294cd433d03a320ad116408f8622defec0a5e000ad12741f2fbcf` |
| `pnpm-lock.yaml` | `a0052a5d72a6857fe25794ddd2a59406582f79ac5a5bca10065f0ca2c459e747` |
