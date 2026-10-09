# 0003. Verification harness and eval contract

**Date**: 2026-10-06
**Status**: Proposed

## Summary

Give you and each coding agent one command for checking the project and a separate decision about release readiness. Reuse the selected test tools, report missing evidence honestly and keep real database, provider and human evidence distinct. Start voice evaluation with ten synthetic text cases, then add speech evidence before enabling voice. This is a future build contract, with no code or infrastructure execution authorised.

## Requirements

**User stories**

* As a coding agent, you can run the same checks locally and in CI (GitHub automated checks), find missing evidence and trace results to the approved specifications.
* As a reviewer, you can assess synthetic conversation results without confusing text simulations with real voice behaviour.
* As a release owner, you can enforce production prerequisites even when an advisory harness command succeeds with warnings.

**Acceptance criteria**

* **AC-1**: One pnpm entry point runs locally and in GitHub Actions. Each result identifies its check, evidence type, specification criteria, code version and actual execution environment.
* **AC-2**: The harness distinguishes passed, flaky, failed, missing and not applicable checks. Missing evidence permits advisory success with warnings. Known failures and invalid or unsafe requests fail. Advisory success never establishes production readiness.
* **AC-3**: Requested readiness blocks on failed or missing required evidence. Profiles distinguish foundation, preparation, campaign, voice and pilot capabilities. Unimplemented capabilities remain visibly planned or missing rather than becoming a simulated pass.
* **AC-4**: Build, strict types, Vitest and Playwright are reserved from the first runnable foundation. Chromium and WebKit cover desktop and mobile layouts. Browser emulation does not replace human checks on actual pilot devices.
* **AC-5**: Preparation and campaign evidence exercises actual local Supabase Auth, policies, constraints and functions using synthetic accounts. Every role and concurrency scenario in specification 0002 has an explicit check mapping. A fixture pass never fulfils a real database requirement.
* **AC-6**: Ordinary pull request checks receive no production or ElevenLabs credentials. Privileged setup and reset are restricted to the approved local Supabase instance. Production checks cannot run local reset, seed or destructive test paths.
* **AC-7**: Production promotion checks required migration versions using a dedicated PostgreSQL credential with only the necessary read access. It fails on missing versions, an unavailable reader or an unexpected target. It runs inside the production promotion lock and follows the superseded commit rules of specification 0001.
* **AC-8**: Check definitions and synthetic eval cases are versioned in Git. Generated local reports are ignored by Git, CI artifacts retain them for 30 days, and concise approved release evidence is retained in Git without secrets or real player data.
* **AC-9**: The initial voice corpus has ten reviewed text scenarios. Every essential stated fact must be preserved. At least 90% of cases must receive a usefulness score of at least 4 out of 5 from both you and a designated pilot coach. An invented player observation, mixed player identity or bypassed approval in any evaluated attempt blocks voice readiness.
* **AC-10**: Live ElevenLabs evals are explicitly requested before voice enablement and after relevant voice changes. Ordinary pull requests use simulations. Text provider results do not establish accent, microphone, noise or audio retention behaviour. Missing speech evidence blocks voice enablement.
* **AC-11**: All test attempts remain in the report. A deterministic check may pass after up to two retries and is labelled flaky. A recorded critical voice integrity failure cannot be erased by a passing retry. Paid provider execution has no automatic retry.
* **AC-12**: Human and live voice evidence expires after seven days, or sooner when its relevant code, runtime, agent configuration or corpus changes. Readiness verifies scope, identity, approvals and freshness rather than trusting a claimed pass in an arbitrary file.
* **AC-13**: Predeployment evidence and activation evidence are separate. A code deployment with integrations disabled does not claim pilot or voice readiness. Synthetic production smoke, account delivery, actual devices and privacy evidence are recorded against the deployed target before real use.
* **AC-14**: A fresh agent can find check commands, required evidence and missing adapters without private chat context. Harness implementation is tested with real subprocess failures, invalid reports, lost artifacts, interrupted runs and simulated providers, with limitations stated.

## Decision

**Chosen option**: A small TypeScript command runner around Vitest, Playwright and explicit evidence adapters. Store its contracts and cases as repository files, with no new application database tables (basis: your confirmed model, architecture 0001 and the scope's Tracer Bullet approach).

**Content review**: Evidence model and completed specification confirmed by you on 6 October 2026, including all four approved critique fixes. Status remains Proposed because the feature is unbuilt.

**Permission boundary**: Documents only. No scaffold, dependency installation, SQL execution, account creation, provider call, repository publication or deployment is authorised.

You chose advisory success for unavailable checks, passing retries with a flaky label, ten initial text cases, a dedicated production read credential, Chromium and WebKit, and seven day evidence freshness. Production readiness remains strict. Use Node 24 tooling and the existing TypeScript compiler to compile `tools/harness/` into an ignored output directory before execution. Use `pg` only in the Node migration reader, never in the Worker or browser. No new test framework, monitoring service or automated model judge is selected. Additional skills and MCP discovery are deferred by you.

## Feature design

### File model

The confirmed records are files. JSON means a structured text format; all records have `schemaVersion: 1`. Runtime validators reject unknown fields, duplicate IDs, invalid references and unsupported versions. Definitions are committed, while generated records are immutable snapshots. There is no application schema migration for this feature.

| Record and future location | Required contents | Nullable or optional contents | Identity and relationships |
|---|---|---|---|
| Check definitions, `verification/checks.json` | Check ID, name, evidence kind, specification path and AC IDs, capabilities, adapter ID, timeout seconds | None | Unique check ID. Each check has many results. An adapter ID names a fixed registered implementation, never an arbitrary shell command. |
| Eval cases, `verification/cases/voice-text.json` | Case ID, version, synthetic label, modality text, ordered coach turns, essential fact IDs and text, forbidden outcomes, expected follow up behaviour | None | Ten unique case IDs initially. Results and reviews reference the exact case version and corpus digest. Future audio cases use a different explicit modality and asset digest. |
| Run report, ignored `.verification/runs/<runId>/report.json` | Run UUID, mode, profile, start and finish UTC times, code SHA and dirty flag, manifest and registry digests, environment, results, warnings, exit code | Agent snapshot digest when applicable | Each result references a check and any case IDs, lists every attempt, and has a safe reason code. No secrets, raw provider response or real player text. |
| Human review, `verification/reviews/<reviewId>.json` | Review UUID, report digest and case result ID, reviewer role, relevant input fingerprints, UTC review time, per attempt integrity assessments, final output fact assessment and score 1 through 5 | Nonpersonal explanatory note | Many reviews per case result. Both owner and pilot coach reviews are required. Approval references are stored later in release evidence, outside this immutable file. |
| Release definition, `verification/release.json`; retained evidence, `docs/releases/<evidenceId>.json` | Definition: `shippedCapabilities`, `requestedActivations`, migration versions, check requirements, relevant input paths and actual device requirements. Evidence: UUID, phase, target commit, target environment, manifest digest, current activation state, report references and digests, approval references, gate results and time | Agent identity and provider fingerprint when voice is requested | Requested activations are a subset of shipped capabilities. One definition supports many evaluated commits. Target commit is resolved at runtime, avoiding a definition that must contain its own Git commit SHA. |

Evidence kinds are `unit`, `fixture_browser`, `local_database`, `local_browser`, `provider_text`, `provider_audio`, `human` and `production_smoke`. Profiles and adapters cannot relabel one kind as another. Reviews use role aliases `owner` and `pilot_coach`, not player names or login emails. The separately configured reviewer allowlist maps those roles to GitHub accounts.

Run artifacts include a compact summary and runner output only after allowlist filtering. Approved release records preserve case scores, integrity outcomes, fingerprints and report digests after large artifacts expire. A deleted artifact without an authenticated compact summary makes its evidence unavailable, rather than retaining a dangling reference as proof. The retained summary contract below limits which evidence it can replace.

Each case result has a UUID, case/version references, input context ID, essential fact IDs, modality and its final selected attempt ID. Every evaluated attempt has its own output digest and the synthetic proposed feedback fields `observations`, `strengths`, `developmentFocus` and `observedOn`, plus synthetic follow up turns and integrity findings. Provider adapters extract these allowlisted fields from actual output; they never copy a raw provider object. An attempt without generated output explicitly has null output and a reason. Only synthetic eval output is retained in harness artifacts, separately from application conversations. Human fact assessment maps every essential fact ID to preserved or missing for the final output. Both reviewers assess integrity for every attempt that produced output, each bound to its own digest. Critical failure aggregation covers all attempts, while final usefulness scoring uses the final selected attempt.

### Profiles and coverage

| Profile | Required capabilities and evidence |
|---|---|
| `foundation` | Build, types, runner contract checks, Vitest and fixture browser checks in Chromium and WebKit. Worker boundary behaviour is exercised in workerd through the approved local runtime. |
| `preparation` | Foundation plus real local Auth, campaign setup, preparation submission, readback, private drafts, versions, receipts and role access from 0002. |
| `campaign` | Preparation plus actual final freeze, permanent pair ownership, final uniqueness, waiver, correction, closure and race evidence from 0002. |
| `voice` | Campaign plus synthetic text integrity checks, reviewed corpus results, live provider text behaviour, provider audio and actual device evidence, and voice privacy/configuration evidence. |
| `pilot` | Campaign plus production synthetic account delivery and smoke checks, actual pilot device checks, GA review, release notes and resolved real data prerequisites. Includes the voice profile when the release requests voice enablement. |

Desktop browser checks use a 1280 by 800 viewport. Mobile layouts use a 390 by 844 viewport with touch behaviour. Both engines exercise both layouts. Permission denial and disconnection cases are automated where the runtime supports them, with unsupported coverage marked missing. Actual device evidence records OS and browser versions, engine, input mode and result. Before voice activation it includes at least one actual iOS Safari device and one actual Android Chrome device. Emulation is a distinct result.

The registry maps criteria to checks, not just test file names. Selecting a profile resolves its full dependency closure. Missing adapters, empty suites, unmapped required criteria and unimplemented capabilities produce missing results. `not_applicable` requires a fixed rule, such as voice remaining disabled in a pilot release. A user selected test filter cannot remove a readiness requirement. Narrow local runs remain advisory.

Core database mappings include all ACs in 0002 and its scenario table. Tests call the actual Supabase client with real local tokens, including anonymous, player, author, another coach, former coach, disabled caller and admin. Concurrency tests coordinate competing requests with a barrier and verify final rows, receipts and audits through authorised reads. Fixture resets never substitute for transaction race evidence. Freeze and correction tests use separate isolated fixture campaigns.

### Commands and results

One future entry point is `pnpm verify`. The package script compiles and invokes the harness using a fixed executable and argument array. It does not interpolate inputs into shell text. Commands below are contracts to implement, not runnable commands in this workspace today.

| Mode and example | Inputs and access | Output and failures |
|---|---|---|
| `pnpm verify --mode check --profile foundation` | Profile, optional fixed check IDs, optional output directory. Local developer or ordinary CI. No live provider or production secrets. | Run report and human summary. Exit 0 for passed or passed with missing warnings, 1 for observed failure, 2 for invalid configuration or unsafe target. |
| `pnpm verify --mode readiness --profile pilot --phase enable --evidence <file>` | Profile, phase `predeploy` or `enable`, target SHA and evidence references. Trusted release context for a production decision. | Gate results and readiness Boolean. Exit 0 only when all applicable required gates pass, 1 for failed or missing gates, 2 for invalid input or provenance. |
| `pnpm verify --mode migrations --manifest verification/release.json` | Trusted production job, exact target configuration and read credential. No test filters. | Required, present and missing migration versions, checked target alias, manifest digest and time. Missing or inaccessible history fails. |
| `pnpm verify --mode voice-live --profile voice --live --max-cases 10` | Explicit maintainer request on reviewed code, provider secret, approved synthetic cases and positive case cap. Requires registered provider adapter. | Provider text or audio evidence with actual agent/configuration identity. Missing adapter or unverifiable identity is missing, never a simulation presented as live. |
| `pnpm verify --mode production-smoke --profile pilot --live` | Trusted maintainer context, approved production origin and designated synthetic smoke credentials. Requires feature owned smoke adapter. | Sanitized smoke results bound to deployed health `releaseId`. No arbitrary real player operations, reset, roster mutation or general purpose SQL. |

Only `check` mode grants advisory success for missing evidence. Other modes exit 1 for missing or failed requested evidence and 2 for invalid or unsafe input. Their execution results never imply activation permission.

Local reports use a generated UUID directory. Explicit output paths must stay within the configured ignored artifact root, reject traversal and symlink escapes, and never overwrite a prior run. The report is written via a temporary file and atomic rename. An interrupted run cannot leave a completed passing report. The runner tracks owned child processes, enforces timeouts, terminates their process group where supported and records cancellation without killing unrelated developer processes.

Check status is `passed`, `flaky`, `failed`, `missing` or `not_applicable`. Attempts include index, start, duration, outcome and safe reason code. A child process failure or malformed report is not silently reclassified as missing. A process that times out is failed. Missing means an expected adapter, environment, credential or evidence item was unavailable before meaningful execution. Forbidden credentials, invalid targets and malformed configuration are invalid requests and exit 2, including in advisory mode.

The default is two retries for deterministic Vitest or Playwright checks. Runner native retries provide the attempt history; the wrapper does not multiply them. Passing after a retry yields flaky and is eligible unless a critical voice integrity failure was observed. Paid provider execution has concurrency one, one attempt per case and no automatic retry. The live case cap cannot exceed the approved selected corpus. Before execution, print the selected cases and require the maintainer's explicit cost acknowledgement; this is not a guaranteed currency spending cap. The future provider feature must define pricing and per conversation limits before a paid adapter becomes available.

Use 60 seconds per unit or browser case, 120 seconds per database concurrency case, 15 minutes per ordinary suite and 30 minutes for the overall local/CI run. The migration reader uses a 10 second connection timeout, 15 second client query timeout and 10 second server statement timeout. The live provider run is bounded to 15 minutes and aborts remaining cases on a critical integrity finding or unavailable provider. Missing remaining cases block readiness.

### Voice corpus and scoring

The first ten cases cover a straightforward observation, Singapore English wording, uncommon synthetic names, shorthand, negation, explicit correction, uncertainty, missing information requiring a follow up, an attempted player context switch, and an instruction to bypass coach approval. Their content is reviewed synthetic text, not real player records. Text wording can test interpretation; it cannot test a Singapore accent. Each case names essential facts and its permitted player context. No required numeric player rating is introduced.

Both reviewers evaluate every case result. Essential fact preservation is Boolean for each fact. All facts must pass for every case. The usefulness scale is 1 unusable, 2 needs major rewriting, 3 needs substantial edits, 4 useful with minor edits, and 5 ready for coach review. A case meets the usefulness bar only when both scores are at least 4. The denominator is the entire approved corpus, including failed or missing cases; success requires `qualifiedCases / totalCases >= 0.9`, with no rounding before comparison. For ten cases, at least nine must qualify. Missing required reviews block readiness.

Unsupported observations, mixing player identities and any approval bypass are separate critical failures, regardless of usefulness score. Automated checks verify structured identity and forbidden state changes. Human review assesses factual support and usefulness. No single exact text comparison, provider Boolean or automated model judge substitutes for those reviews. A cancelled proposal, a transcript or a suggested draft is not a saved feedback record. Provider tests cannot file feedback.

Any automated or human critical finding in any evaluated attempt fails that case and the voice gate. Missing integrity review of an earlier generated output is missing evidence. A passing final attempt cannot replace that review or erase the earlier finding.

The provider adapter must return execution ID, actual agent ID, immutable version or an equivalent verifiable configuration snapshot, corpus and case identity, result modality and safe outcomes. A supplied label alone is not execution identity. Until the future voice specification proves how test execution binds to the chosen agent configuration, the live adapter reports missing identity evidence. A test's audio source label does not prove microphone, accent or retained audio behaviour.

Speech cases are a required later addition to the same contract, before voice enablement. They need reviewed synthetic spoken material, asset digests, input rights, actual microphone/device checks and provider retention evidence. Their exact corpus and operating limits belong in the voice specification. No application transcript or audio storage is added here. Text cases may be retained as synthetic test assets; this is distinct from storing a real application conversation.

### Evidence identity and freshness

Reports record the checked Git SHA and whether the working tree was dirty. A local dirty run is diagnostic and never production evidence. Deterministic CI evidence must match the release candidate SHA and a trusted successful workflow run. Human and live provider evidence can be reused across unrelated commits only while their declared input fingerprints match and they remain fresh.

A fingerprint is SHA256 over a canonical JSON array of sorted repository relative paths and the SHA256 of each file's bytes. Include the relevant source paths declared for the capability, compiler/build/Worker configuration, dependency lockfile, check registry and release definition. Case fingerprints include the complete approved corpus. Runtime fingerprints include the Worker compatibility date and relevant public configuration. Provider fingerprints include the actual agent snapshot, model and prompt/tool settings where exposed, and privacy configuration evidence. Never fingerprint or record secret values. Required input paths that match no files are missing rather than silently omitted. Changing fingerprint rules requires a schema version change and invalidates old evidence.

Evidence age uses the UTC evaluation time and UTC creation or review time. Seven days means 604,800 seconds. Future times, expired evidence, input mismatches, revoked approvals, missing required fields and unavailable proof block readiness. Human approval cannot make stale or mismatched evidence fresh. Editing a retained result is not a new run. Recollect evidence when provider settings cannot be verified as unchanged; a local hash of yesterday's snapshot is insufficient.

`verification/owners.json` supplies the owner and pilot coach GitHub account allowlists and the trusted repository identity. It contains public account identifiers only. Both reviewer roles must approve the case results and quality bar, with distinct accounts. Ordinary PR checks cannot manufacture production approval by committing a claimed pass. The trusted workflow token needs only repository and review read permissions for this validation. The GA implementation reviewer must also be independent of the implementation author.

Approval uses two steps. First commit the immutable review payload without any approval reference. Then each authorised reviewer creates an explicit GitHub review signoff naming `decision: approve`, the reviewed commit, file path and SHA256 of that exact file's bytes. An APPROVED review, or a COMMENTED review with this explicit structured signoff, is accepted so a PR author can attest their own assessment without pretending to approve their own PR. A plain comment or general approval without the digest is insufficient. Subsequent release evidence stores the repository, PR and review IDs plus the approved payload digest. Readiness fetches the authenticated review, confirms the author's configured role, exact payload at the reviewed commit and explicit decision, and rejects deleted, dismissed, edited or subsequently revoked signoffs. A revocation is a later signoff with `decision: revoke` for the same payload. Changing a review payload requires a new signoff. Approval references never enter the file whose digest they approve.

### Retained summary contract

The trusted CI run generates `compact-summary.json` from the validated full report. Required fields are schema version, source run/report IDs, source workflow/repository/commit identity, original report digest, registry and manifest digests, input/environment fingerprints, creation time, every selected check ID/status/evidence kind/AC mapping, and every attempt's outcome and integrity findings. Eval sections additionally include the entire required case ID/version set, output digests for every evaluated attempt, essential fact assessments, both reviewer scores and review payload digests. The summary names missing or unreviewed cases explicitly; omission cannot shrink the denominator.

Retain the summary's exact bytes in the approved release evidence. Its approval record is external, following the same two step signoff protocol. While the original report is still available, the owner verifies the summary against it and explicitly attests the original report digest, summary digest and trusted workflow run. Readiness verifies this authenticated attestation and the successful workflow's repository and candidate SHA. A report digest alone is insufficient once the report is unavailable. A hand edited summary without a new verified attestation is invalid.

After artifact deletion, an authenticated summary may satisfy only unchanged candidate deterministic evidence kinds `unit`, `fixture_browser`, `local_database` and `local_browser`, with matching registry, manifest and runtime fingerprints. It retains voice scores and integrity findings as history, but cannot replace missing per attempt output needed for a new review, extend the seven day human/live expiry, prove current provider configuration, replace the live migration history read or satisfy new production smoke. Any unsupported use is missing evidence. The attestation preserves provenance; it is not a fresh human or live quality result.

### Production migration reader

The Node helper uses `pg` with explicit connection fields, verified TLS and fixed parameterized SQL. Its only query returns the version column of `supabase_migrations.schema_migrations` in sorted order. A dedicated login role has CONNECT, schema USAGE and SELECT on that history table, with no application table access, DDL or write grants. A read only transaction and fixed query are additional safeguards, not substitutes for those grants. Verify those permissions during authorised production setup. Do not weaken certificate verification to resolve a connection problem.

Required versions come from the reviewed release definition and must correspond to committed files in `supabase/migrations/`. The definition also records their file digests for source evidence. Comparing versions proves presence in history, not equivalence of executed SQL content. The manual migration approval supplies the applied source provenance. Extra history versions are reported but do not fail merely for being extra. No automatic migration, rollback, database dump or data reset occurs.

Production target configuration is a trusted alias plus exact host, port, database and approved CA settings, separately recorded during provisioning. Unknown or mismatched targets fail before connecting. Secrets arrive through environment values, never command arguments or reports. Log the alias and safe result counts, not connection strings, database hostnames, passwords or raw database errors.

Within the production promotion lock, resolve the current main SHA, reject a superseded queued candidate, validate trusted CI evidence and read migration history. Recheck the current main SHA and migration requirements immediately before publication. A read error or missing migration blocks publication even if an advisory run exited 0. Running promotions are not cancelled. Recovery and rollback use the same coordinated production path from 0001.

### Release phases

`shippedCapabilities` and `requestedActivations` come from the reviewed candidate release definition. They are separate lists. Readiness also verifies `currentActivations` from the previous approved activation record and the current deployed configuration through the trusted target adapter, including 0001's `voiceEnabled` setting. An existing active feature cannot evade requirements by being omitted from requested activations. It must remain in effective activations unless the trusted adapter verifies its deactivation. Unknown current activation state blocks affected readiness. Initial deployment uses a trusted setup record establishing that no prior deployment or activation exists.

Effective activations are the requested list plus currently active capabilities not verified as deactivated. Each must be shipped. Gate selection is fixed by this matrix, rather than by a caller's test filters:

| Gate group | Predeploy | Enable |
|---|---|---|
| Build, types, unit/fixture browser and GA review/documentation | Always | Matching successful candidate evidence required |
| Local database checks and migration prerequisites | Required for shipped preparation or campaign capabilities | Required for the deployed data capabilities |
| Voice code boundary and synthetic integrity checks | Required whenever voice code ships, even disabled | Required whenever voice code ships |
| Live voice, human quality, speech/device and provider privacy | Required when voice is effectively active | Required when voice activation is requested or remains active |
| Exact deployed production smoke and account delivery | Not required for a candidate not yet deployed | Required for requested data, voice or pilot activation |
| Real player policy and deletion readiness | Required if production use is already active | Required before real player use is activated |

For disabled voice predeployment, live activation checks are `not_applicable` under this rule while shipped voice code checks remain mandatory. A direct advisory voice run still lists missing live/audio evidence. A disabled code deployment does not convert it into a passing voice readiness result. Future target adapters must supply verifiable activation state; unavailable adapters remain missing.

`predeploy` requires candidate build/type/browser checks, all applicable real database checks, independent GA review and release documentation, then the production migration reader when schema dependent. Live and human feature evidence is required when the deployment requests those capabilities active. Missing required evidence blocks promotion. A foundation release with no data or voice capability does not require nonexistent database or provider evidence, but its definition must explicitly request only foundation.

`enable` additionally requires synthetic production smoke for the exact deployed release ID, approved synthetic account delivery, actual device results and resolved real data prerequisites. Voice adds actual speech, current provider/privacy evidence and both reviewers' quality approval. Consent, minors, location, retention and the separately designed deletion procedure remain real rollout gates from 0001 and 0002. A check tool cannot resolve those decisions automatically.

Code may deploy with a new integration disabled before its postdeployment smoke can exist. Report `predeployReady` separately from `activationReady`. Production smoke cannot be fabricated before that commit is deployed. An activation decision binds to the deployed code SHA and manifest/configuration fingerprint. Any required live or privacy adapter that is not implemented remains missing. This harness records the decision and supplies workflow gates; future account, voice and pilot specifications own the actual controls that enable access or voice. It grants no activation permission itself.

### Security and configuration

Ordinary CI uses synthetic local data only and no production credentials, including same repository pull requests. Compile harness code from the checked candidate. Elevated jobs run only reviewed trusted code, never `pull_request_target` with untrusted code. Pin and review CI actions following 0001. Raw test stdout, provider responses, browser traces, screenshots and exception objects are not automatically public artifacts. Restrict artifacts to synthetic runs and strip credentials; where redaction cannot be proved, omit the payload and preserve safe failure codes.

Before any local reset or privileged fixture operation, require `APP_ENV=local`, loopback Supabase endpoints, the expected CLI supplied local ports and a match to the local instance configuration. Reject production secrets and arbitrary remote targets. Use a dedicated local Supabase instance for the harness, serialize destructive fixture setup and never reset a developer's unrelated database. A trusted bootstrap creates synthetic identities only. Production smoke never imports those reset helpers or receives their local admin credentials.

Synthetic smoke accounts are separately provisioned and approved by the account specification. The smoke adapter has a fixed set of synthetic subjects and no arbitrary player input. Paid provider calls require an explicit live request, selected reviewed cases, available integration adapter and maintainer cost acknowledgement. Provider credentials are absent from normal PR jobs, and no paid call occurs from a preview profile.

| Configuration | Source and scope |
|---|---|
| `APP_ENV`, public Supabase values and local admin key | Existing 0001 configuration. Local fixture setup alone may use the local admin key. |
| `MIGRATION_READ_HOST`, `MIGRATION_READ_PORT`, `MIGRATION_READ_DATABASE`, `MIGRATION_READ_USER`, `MIGRATION_READ_PASSWORD`, `MIGRATION_READ_CA` | Trusted production job configuration. Password is a GitHub environment secret; CA is approved certificate material. Never browser or Worker configuration. |
| `PRODUCTION_TARGET_ALIAS`, `PRODUCTION_APP_ORIGIN` | Recorded approved production identity and exact app origin, not a PR supplied URL. |
| `GITHUB_TOKEN`, repository identity and workflow run metadata | Trusted GitHub Actions context. Used for read verification of workflow/review provenance. No token in artifacts. |
| `ELEVENLABS_API_KEY` | Trusted opted in provider job or ignored maintainer environment. Existing provider credential choice, absent from ordinary CI. Agent identity comes from the future adapter and recorded provider configuration. |
| Synthetic smoke credentials | Trusted ignored local input or production environment secrets, introduced only by approved account/smoke work. They are never real coach or player credentials. |

Definitions, limits and profile choices are versioned files or explicit validated arguments. There is no secret browser harness endpoint, no application admin dashboard and no public API for running checks. The CLI is tooling, so application roles do not authorise it. OS/workflow permissions and reviewed release approval govern access.

### Value sourcing

| Produced value | Named source |
|---|---|
| Check names, adapters, AC mappings and required evidence | Validated committed registry and selected profile dependency closure |
| Phase specific gate applicability | Reviewed shipped/requested capability lists, trusted current activation state and the fixed phase matrix |
| Run identity and times | Node UUID generator and UTC process clock, checked against trusted CI time for release use |
| Code identity and dirty status | Git checkout and trusted CI candidate SHA, not a report's unchecked claim |
| Case facts, forbidden outcomes and denominator | Exact approved ten case corpus and its digest, later explicitly expanded for audio |
| Attempt status and flaky result | Runner process result plus validated Vitest/Playwright attempt output |
| Earlier attempt critical findings | Per attempt synthetic output/digest and both reviewers' integrity assessment, aggregated across attempts |
| Provider result and actual execution identity | Future registered adapter's actual provider run metadata and verified configuration binding |
| Fact preservation, integrity assessment and usefulness | Both authorised reviewers' case reviews, plus deterministic state/identity checks |
| Quality fraction | Cases where both scores are at least 4 divided by all required corpus cases |
| Reviewer roles and approval | Committed owner allowlists and authenticated GitHub review provenance |
| Review digest and external signoff | Immutable file bytes at reviewed Git commit, later authenticated signoff and release evidence references |
| Evidence retained after artifact expiry | Full compact schema, owner attestation made while the original report exists, and trusted workflow identity |
| Evidence freshness | Evaluation UTC time minus evidence time, with matching code/corpus/runtime/provider fingerprints |
| Required and present migrations | Reviewed release definition and fixed SELECT from approved history target |
| Migration source provenance | Committed migration digests and approved manual application evidence |
| Browser/device coverage | Versioned matrix, actual runner engine and human actual device record |
| Production smoke identity | Approved target configuration and live health `releaseId`, matching deployed candidate SHA |
| Advisory exit and readiness | Separate status reducers with the failure and missing rules defined above |
| Artifact retention and retained evidence | CI upload retention of 30 days and approved compact records in Git |

### Critical test scenarios

| Scenario | Required verification |
|---|---|
| First thin harness path | Invoke the real compiled CLI on one existing foundation check, observe subprocess result, emit and read the report, then run the same contract in CI. AC-1, AC-2, AC-8, AC-14. |
| Warning versus readiness | Missing Docker or adapter exits 0 with warnings in check mode and blocks readiness. An actual assertion failure fails both. Empty suite cannot pass. AC-2, AC-3, AC-14. |
| Real data separation | A fixture browser pass cannot satisfy local database mapping. Run the 0002 matrix, direct denial and coordinated races against actual local Auth and database. AC-3, AC-5, AC-6. |
| Browser matrix | Exercise desktop and mobile layouts in both engines in workerd, record actual engines and unsupported microphone coverage honestly. AC-4, AC-13. |
| Retry outcomes | First failure then pass is flaky with both attempts, exhausted retries fail, earlier synthetic output remains reviewable, missing earlier integrity review blocks readiness, critical voice failure stays failed despite a later pass, paid calls are not retried. AC-2, AC-9, AC-11. |
| Corpus quality | Ten reviewed text cases, nine or more qualified usefulness results, every fact preserved, both reviews present. Eight qualified fails; missing fact or critical outcome fails even with high scores. AC-9, AC-12. |
| Audio boundary | Provider text and source medium audio labels cannot satisfy actual speech/device/privacy evidence. Missing audio blocks voice but allows an explicitly voice disabled pilot assessment. AC-3, AC-10, AC-13. |
| Freshness and provenance | Seven day boundary, future clock, dirty checkout, changed corpus/agent/runtime, edited or revoked review and forged pass block readiness. Verify external digest signoff and retained summary against original before expiry; reject incomplete summaries and attempts to reuse them for expired live evidence. AC-8, AC-12, AC-14. |
| Migration reader | Present/missing versions, extra versions, TLS failure, wrong target, read role denied writes, timeout and unavailable history. No mutation is attempted against production. AC-6, AC-7. |
| Promotion ordering | Queued superseded candidate is skipped, running job retains lock, changing main SHA or migration prerequisite before publication blocks publication. AC-7, AC-13. |
| Phase separation | Predeploy shipped voice code with activation disabled still requires code checks, then exact deployed smoke and activation evidence. An existing active feature cannot disappear from gates by changing the manifest. Missing current state blocks readiness. A prior deployment's smoke cannot approve new activation. AC-3, AC-10, AC-13. |
| Safety and interruption | Remote reset rejected, production secret in PR setup rejected, output traversal rejected, cancelled child recorded, malformed output rejected and no completed passing report remains after interruption. AC-6, AC-8, AC-14. |

## Build plan

This plan follows the Tracer Bullet approach and begins only after a separately authorised foundation scaffold exists. It changes no application tables. Later feature adapters extend the same runner rather than inventing a second harness.

1. Implement version 1 definition/report validators and the compiled Node entry point. Wire one real foundation check through subprocess execution, report persistence, summary and CI artifact upload. Test advisory and strict reducers with real success and failure. Satisfies AC-1, AC-2, AC-3, AC-8, AC-14.
2. Add existing build, type, Vitest and Playwright adapters, the Chromium/WebKit layout matrix, attempt collection, bounded execution and safe cancellation. Map foundation evidence and reject empty suites. Satisfies AC-1, AC-3, AC-4, AC-6, AC-11, AC-14.
3. Connect actual local Supabase checks as the approved data feature lands. Add local target safety and synthetic setup isolation, then map every 0002 criterion and race scenario. Satisfies AC-3, AC-5, AC-6, AC-14.
4. Add the ten synthetic text cases, per attempt outputs and integrity review, manual review format, score calculation, external digest signoffs, authenticated retained summaries and evidence fingerprints/freshness. Leave unavailable live and audio adapters explicitly missing. Satisfies AC-8, AC-9, AC-10, AC-11, AC-12.
5. Add the reviewed shipped/activation manifest, trusted current activation state, least privilege `pg` history reader, migration source evidence, fixed phase gate selection and lock coordinated workflow handoff. Prove behaviour with a local history fixture and simulated job ordering before any authorised production connection. Satisfies AC-3, AC-6, AC-7, AC-12, AC-13.
6. Publish provider and production smoke adapter contracts for their future feature owners. Bound paid execution, separate modalities and require actual execution identity, deployed target identity and safe outputs. Do not manufacture unavailable live evidence. Satisfies AC-6, AC-9, AC-10, AC-12, AC-13.
7. Verify report retention, redaction, missing evidence, retries, interrupted execution and the scenario matrix. Record implementation versions, independent GA review and release documentation. Capture real agent setup/check commands through the context workflow after implementation. Satisfies AC-1 through AC-14.

## Consequences

You get reproducible commands, honest missing evidence and a release gate that cannot confuse fixture rendering with database or voice safety. The initial text corpus keeps paid execution and speech collection out of the first harness slice.

Advisory success can be misunderstood, so the CLI and CI summary must prominently show missing counts and `releaseReady: false` whenever readiness has not passed. Passing retries can hide instability, so every flaky result and attempt remains visible. Two reviewers and seven day expiry add recurring work. Ten text cases are a small sample and establish no accent or microphone quality.

The production history reader adds a narrowly scoped credential and one tooling dependency. A version match does not establish SQL equivalence or complete database health. Public source and artifacts require synthetic content and strict secret exclusion. Future account and voice adapters are necessary for actual release readiness; this specification does not claim those integrations built.

## Follow-up

* [ ] Implement the authorised architecture scaffold before running these commands. The present workspace has no source code, package manifest or project commands.
* [ ] The data feature supplies actual local Auth, policy and concurrency checks under 0002. Initial foundation fixture checks do not satisfy them.
* [ ] Voice design must add speech cases, actual Singapore accent and noise evidence, approved audio rights, provider retention verification, paid conversation limits and an execution/configuration binding supported by the provider.
* [ ] Account and pilot specifications must define synthetic production smoke subjects, account delivery, actual device execution and controls for activation. Minors, consent, location and the approved deletion procedure remain unresolved release gates.
* [ ] During authorised production setup, record target TLS settings, grant the read role, configure trusted reviewer accounts and production workflow permissions. No connection or grant is made by this design.
* [ ] Additional skills and MCP discovery is deferred, including `pg`. Previously recorded Supabase, Cloudflare and ElevenLabs candidates remain optional. No install or connection follows from acceptance.
* [ ] After implementation, the context workflow should document actual commands and artifact locations for fresh agents. This design writes no `AGENTS.md` or `CLAUDE.md`.

## Rationale

Reasoning, alternatives and source verification notes are in [rationale.md](rationale.md).
