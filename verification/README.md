# Verification harness

You can use Node 24 and the recorded pnpm version to run the harness:

```sh
pnpm verify --mode check --profile foundation
APP_ENV=local pnpm verify --mode check --profile campaign
APP_ENV=local pnpm verify --mode check --profile preparation
pnpm verify --mode check --profile voice
```

The entry point compiles `tools/harness/` into a new ignored directory before running it. Definitions, checks and cases use schema version 1. Generated reports go into `.verification/runs/<runId>/`. Each run has `report.json`, `compact-summary.json` and `summary.txt`. Reports contain safe codes and synthetic evidence. Child stdout, exception details, credentials, traces and screenshots are omitted.

Each test runner also writes `*.failure-summary.txt` with test names, source locations, projects, attempt numbers and safe reason codes for failed, skipped or cancelled attempts. Earlier failures remain visible when a retry passes. GitHub Actions always prints these files and `summary.txt` in the CI logs and retains them with the reports. Raw assertion values and exception messages remain omitted.

Check mode is advisory. Exit 0 can include missing checks. Exit 1 means an observed failure. Exit 2 means invalid or unsafe input. Every advisory run prints `releaseReady: false`. The report keeps all captured attempts. Passing after a retry is `flaky`. Vitest capture runs around each attempt, before the native runner discards its failed state. Playwright capture records every result. Neither wrapper adds retries to native retries.

You can select known checks for a narrow diagnostic run:

```sh
pnpm verify --mode check --profile foundation --checks types,unit
```

Filters are rejected in readiness mode. Output paths can be repository relative paths inside `.verification/`, for example `--output .verification/diagnostics`. Each invocation creates its own UUID directory and never overwrites another run. Traversal and symlink paths are rejected. An interruption cancels owned children and leaves no completed passing report.

## Evidence and environments

| Profile     | Coverage                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| foundation  | Build, strict types, lint, format, logic, harness contracts and the browser matrix                     |
| preparation | Foundation, actual local Auth, setup journal, preparation rules, lifecycle races and live browser path |
| campaign    | Preparation and actual local lifecycle, retention and races                                            |
| voice       | Campaign, proposal simulations and explicit missing human, live and speech evidence                    |
| pilot       | Campaign and explicit missing production, device, account, policy and GA evidence                      |

The browser matrix uses Chromium and WebKit at 1280 by 800 and 390 by 844. The mobile projects use touch. You can install the recorded engines with `pnpm exec playwright install chromium webkit`. With installed Chrome, you can set `PLAYWRIGHT_BROWSER_CHANNEL=chrome` for Chromium projects. WebKit is still required for the full matrix. Browser emulation cannot satisfy actual device evidence.

Database checks require `APP_ENV=local`, Docker and the applied migrations. The adapter verifies this project's CLI status, API port 54321, database port 54322 and project identity. It inspects Auth accounts and refuses any account outside the generated synthetic fixture. The lock `.verification/local-database.lock` serializes harness fixture operations. You can avoid running independent `db:*` commands during this check. The harness never resets data. If a killed process leaves the lock, you can confirm that its process stopped before removing the stale lock.

[database-coverage.json](database-coverage.json) maps all sixteen criteria in spec 0002, all seven caller roles and its eleven scenario groups to named executable tests. Startup checks the source references. Browser fixtures and proposal simulations cannot replace this database evidence. The voice proposal mapping distinguishes its real reviewed database write check from its late result simulation.

Ordinary check subprocesses receive an allowlist of environment values. Production, Supabase service and provider credentials in the caller's check environment are rejected. Local service credentials come only from the inspected CLI instance and stay in that child process. An ordinary pull request cannot run privileged production or paid checks.

Spec 0005 adds `database_accounts`, `browser_preparation` and `preparation_accessibility`. The account adapter runs pinned Auth compatibility, atomic setup transactions, actual Worker orchestration with deliberately lost local provider responses, and a real coach history read. The live browser adapter needs both engines, local mail capture, and `SFDA_LIVE_ADMIN_EMAIL` plus `SFDA_LIVE_ADMIN_PASSWORD` supplied through the runtime environment. Those two local bootstrap inputs are forwarded only to the local browser child. The runner verifies the normal login, enabled admin profile and trusted bootstrap marker, then discards its session. The harness never creates a replacement admin or resets data. Missing engines, bootstrap inputs or human accessibility evidence remain missing.

Spec 0006 extends `database_accounts` with recovery, shared link, directory, admin recovery and operator function checks, plus actual Worker recovery with captured local mail. `database_campaign` supplies its frozen membership evidence and `unit` its release gate checks. Production SMTP, Cloudflare throttling and operator evidence are not mapped and remain missing.

Spec 0007 extends `database_preparation` with the workspace and workspace regression suites. These execute the real local campaign, roster, context, neighbor and history read functions alongside the existing preparation writes. `browser` supplies simulated workspace navigation and focus races; it remains fixture evidence. `browser_preparation` supplies only its existing real campaign selection, reviewed submission, saved draft restoration, separate session history and memory only login path. `unit` covers controller rules, `harness` covers evidence mapping, and `preparation_accessibility` retains the human accessibility requirement. Preparation and campaign profiles inherit these mappings.

A mapped criterion identifies relevant evidence, not proof that every clause has passed. Full workspace live browser coverage and human accessibility remain outstanding. Workspace mappings do not establish live final or correction capability, voice readiness, actual devices, production smoke or pilot policy approval. The spec 0002 database coverage file retains its separate named test and role contract.

## Reviews and retained evidence

[voice-text.json](cases/voice-text.json) contains ten synthetic text scenarios. The corpus is pending human approval. Each case fixes its permitted player context, facts, forbidden outcomes and follow up. The quality reducer requires both authorised roles for every case, preserves every fact and requires nine of ten cases to score at least 4 from both reviewers. Any invented observation, player mixing or approval bypass in any attempt fails quality. An earlier unreviewed output is missing evidence. A later passing attempt cannot erase an earlier critical finding.

You can find the immutable review format in `tools/harness/eval.ts`. A review includes its report digest, case result ID, role, UTC time, input fingerprints, every generated attempt's output digest and integrity assessment, final facts and usefulness score. It has no approval references. The provider output digest is SHA256 over `JSON.stringify` of the validated output object in schema field order.

[owners.json](owners.json) records the repository and role allowlists. Both allowlists are empty until you configure the approved reviewers. Accounts must be distinct across roles. A claimed pass in a committed file gives no approval.

After committing a review payload, an authorised account can create an APPROVED or COMMENTED GitHub review with this exact structured body (using the actual commit, path and file digest):

```json
{
  "schemaVersion": 1,
  "decision": "approve",
  "reviewedCommit": "<40 character commit SHA>",
  "payloadPath": "verification/reviews/<reviewId>.json",
  "payloadDigest": "<SHA256 of exact file bytes>"
}
```

External evidence references identify the repository, PR, review ID, role, reviewed commit, payload path, payload digest and exact review body digest. The reader fetches authenticated reviews and payload bytes. It rejects general approval, changed content, changed signoff, dismissed or deleted reviews and later revocation for the same payload. A later structured signoff can use `decision: revoke`.

Human and live evidence expires at seven days. Future times and changed input, runtime, corpus or provider fingerprints make evidence unavailable. Voice corpus approval needs both roles. Its text modality supplies no accent, microphone, noise or audio retention evidence.

A full report used for release must match the candidate, registry, manifest and runtime, have a clean checkout and come from a successful trusted workflow. The reader verifies the GitHub artifact's run, repository and commit, verifies its archive digest and compares exact report bytes. Lost artifacts are unavailable. Archive extraction is bounded, rejects traversal and symlinks, and reads only the expected report.

After artifact expiry, a retained compact summary needs an external authenticated owner attestation made while the original report exists. That payload names `sourceReportDigest`, `summaryDigest`, `workflowRunId`, `candidate`, `attestedAt` and `originalReportAvailable: true`, with schema version 1. Its digest signoff is separate. The complete corpus denominator, check mappings and attempt history remain in the summary. Only matching deterministic evidence can be reused. Retention cannot renew human or live evidence, satisfy production smoke or replace a migration read.

## Release gates and future adapters

The default [release.json](release.json) describes a foundation candidate. It is a definition template, not release approval. Shipped capabilities and requested activations are separate. The fixed gate matrix also includes currently active capabilities until a trusted target verifies their deactivation. Unknown current state blocks readiness. Shipped voice still needs its code checks when activation is disabled.

You can assess readiness with an external evidence file:

```sh
pnpm verify --mode readiness --profile pilot --phase predeploy --evidence verification/evidence.json
pnpm verify --mode readiness --profile pilot --phase enable --evidence verification/evidence.json
```

The evidence file has schema version 1 and arrays `reports`, `retained` and `approvals`, as defined in `tools/harness/evidence.ts`. Each full report reference has its repository relative path, digest, artifact ID and workflow run ID. Each retained reference has its summary path, digest and external attestation approval. `GITHUB_TOKEN` supplies repository and review read access. It is never stored in a report. Empty arrays are valid input and produce missing gates, not readiness.

`predeployReady` and `activationReady` remain separate. Enablement requires the exact deployed smoke, approved synthetic account delivery and actual devices. Voice additionally requires live speech, privacy and quality evidence. Real player use needs resolved consent, minors, location, retention and deletion decisions. The harness grants no activation authority.

`tools/harness/migrations.ts` supplies the fixed PostgreSQL history reader and the promotion handoff. It uses verified TLS, explicit fields, a read only transaction, 10 second connection and statement limits, and a 15 second query limit. Its only data query reads sorted migration versions. Extra versions do not fail. Missing versions and unavailable history fail. Version presence cannot prove applied SQL bytes. The release definition records source digests; manual migration approval supplies application provenance. Production setup must verify the dedicated role's CONNECT, schema USAGE and history SELECT grants, without write, DDL or application table access.

Production provisioning has not recorded `verification/production-target.json`, a migration reader credential or a real promotion lock. The standalone migrations mode therefore reports missing. The tested handoff holds a supplied lock, checks current main before reading prerequisites, then rechecks main and prerequisites immediately before its supplied publication operation. It performs no deployment itself.

You can find provider and production contracts in `tools/harness/future-adapters.ts`. No live provider, target state, smoke, actual device, policy, account delivery or GA review adapter is registered. These are visible missing gates. Paid mode requires `--mode voice-live --profile voice --live`, selected reviewed cases and `--acknowledge-cost`. `--max-cases` is 1 through 10. It prints selected cases, makes no call while the adapter is absent and never retries paid execution. Production smoke requires its separate live request and approved synthetic subjects. Neither path imports local reset helpers.

GitHub Actions uses the same foundation command, installs both engines and retains safe reports for 30 days. It receives no production or provider credentials. The workflow has been wired here; execution on GitHub still needs recorded evidence. Independent review and release documentation remain separate GA steps.

## Suggested verification steps

These steps cover the acceptance criteria and each value source in spec 0003. You can use the harness suite for the executable parts and collect the unavailable environment and human evidence later.

| Step | Input to vary and expected result                                                                                                                                                                                                | Criteria                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1    | Run `pnpm verify --mode check --profile foundation`. Read check IDs, kinds, source criteria and profile closure in the report. Removing a required definition, using an unknown adapter or unmapped criterion fails validation.  | AC-1, AC-3, AC-14        |
| 2    | Compare disabled shipped voice, requested voice and previously active voice. Only the fixed phase matrix can mark a gate not applicable. Missing current state blocks readiness.                                                 | AC-3, AC-13              |
| 3    | Read generated UUID and UTC times. Interrupt a real child and verify no passing completed report remains. Future evidence times are rejected.                                                                                    | AC-1, AC-8, AC-12, AC-14 |
| 4    | Compare the report SHA with the checked candidate and CI SHA. Dirty local results remain diagnostic. A different candidate cannot reuse them.                                                                                    | AC-1, AC-12              |
| 5    | Change a case fact or version. The full corpus digest changes, all ten cases remain in the denominator and old reviews are unavailable.                                                                                          | AC-8, AC-9, AC-12        |
| 6    | Run the real retry fixture in `runner.test.ts`. First failure then pass has both attempts and a flaky label. Timeout, exhausted retries and malformed output fail.                                                               | AC-2, AC-11, AC-14       |
| 7    | Add an earlier critical output, then a clean final output. The case still fails. Removing an earlier integrity review gives missing evidence.                                                                                    | AC-9, AC-11              |
| 8    | Request live provider evidence without its registered execution adapter. It is missing. An input audio label cannot satisfy actual provider audio or configuration identity.                                                     | AC-10, AC-12             |
| 9    | Remove one essential fact or one authorised review. Quality fails or is missing despite high usefulness scores. No automatic text judge substitutes for review.                                                                  | AC-9, AC-12              |
| 10   | Give both reviewers nine qualifying cases, then eight. Nine passes the fraction; eight fails without rounding.                                                                                                                   | AC-9                     |
| 11   | Use the same account for both roles, a general GitHub approval, a dismissed review or a revoked signoff. None supplies the required approval.                                                                                    | AC-9, AC-12              |
| 12   | Change one byte in a committed payload or review body. Its external digest signoff no longer matches.                                                                                                                            | AC-8, AC-12              |
| 13   | Delete the source artifact. Evidence is missing unless a complete matching compact summary has a timely authenticated owner attestation. A summary cannot replace live, human, smoke or migration evidence.                      | AC-8, AC-12, AC-14       |
| 14   | Cross seven days or change runtime, corpus or provider inputs. Prior human and live evidence becomes unavailable.                                                                                                                | AC-12                    |
| 15   | Exercise the history reader fixture with present, missing and extra versions, denied access and TLS failure. Wrong target fails before connection and raw errors stay absent.                                                    | AC-6, AC-7               |
| 16   | Change a committed migration's bytes without updating its reviewed digest. Source validation fails. A version match alone cannot establish applied source provenance.                                                            | AC-7, AC-12              |
| 17   | Run both layout sizes in both browser engines through workerd. Record actual projects. Missing engines remain missing and emulation cannot fulfil actual iOS Safari and Android Chrome evidence.                                 | AC-4, AC-13              |
| 18   | Supply a smoke result for another deployed SHA or origin. It cannot approve this activation. Unknown target state remains missing.                                                                                               | AC-6, AC-13              |
| 19   | Compare missing evidence in check and readiness modes. Advisory exit 0 keeps `releaseReady: false`; strict readiness exits 1. Invalid or unsafe requests exit 2.                                                                 | AC-2, AC-3               |
| 20   | Inspect the CI upload allowlist and 30 day retention, then verify retained exact bytes and safe summaries. No raw child output or secrets become public artifacts.                                                               | AC-6, AC-8               |
| 21   | With approved Docker access, run the campaign profile against this synthetic local instance. Confirm all mapped role, direct access, receipt and race checks actually execute. Fixture browser passes cannot fulfil the mapping. | AC-5, AC-6, AC-14        |
| 22   | Simulate queued supersession and a changed main SHA before publication. The promotion handoff keeps its lock and blocks publication.                                                                                             | AC-7, AC-13              |

The harness tests use real Node and Vitest subprocesses plus synthetic GitHub, migration and provider records. Those tests establish runner behaviour, not hosted database grants, provider configuration, speech quality or production promotion. Separate app verification, independent review and actual deployment evidence remain outstanding.
