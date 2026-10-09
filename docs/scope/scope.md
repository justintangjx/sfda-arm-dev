# Scope: SFDA coach feedback version 2

You are building a fresh coach workspace for SFDA (Singapore Flying Disc Association). Admins prepare accounts and campaigns. Coaches record player observations during preparation, then submit one final assessment of competition performance for each player.

**Stage:** Planning only, as of 6 October 2026. No application code, scaffold, database migrations, provider configuration or deployment is authorised by this scope pass. All features below describe future work.
**Build approach:** Tracer Bullet (prove one real path through account access, a campaign, a player and saved feedback, then expand it). Confirmed by you.
**Workflow:** GA (verify the real app, run tests, obtain an independent review and document release evidence). Confirmed by you. Features need approved design decisions before coding begins.
**User constraints:** Start afresh, including the data model. Keep Supabase and deploy to Cloudflare. Use ElevenLabs APIs or Agents for the conversational voice widget. These are your constraints, rather than new provider choices made by this scope.

**Pilot:** One SFDA organisation, a small coach pilot, no billing and no fixed launch date. Budget and exact expected load have not been specified.
**Success measure:** Reviewed feedback saved for assigned players. Final feedback completion is a useful supporting measure.

You can adjust the order and verification depth. A new coding agent can use this scope for orientation, but will also need approved specifications and project instructions before implementing a feature.

## Confirmed product rules

1. This release focuses on coaches. It includes minimal admin setup for accounts, assignments and campaign stages. Player accounts exist, but a player portal is deferred.
2. Admins add coaches and players. Provisioned users can then log in with email and password. Public registration is outside this release.
3. Admins decide when preparation starts. It may begin months before the competition. Dates alone do not change permissions.
4. During preparation, an assigned coach can submit feedback for each assigned player as often as needed. There is no count limit or inherited target of two assessments.
5. After competition, each coach can submit one final assessment per player and competition. Final feedback describes that competition's performance and remains distinct from preparation observations.
6. Admins open feedback stages and close the campaign after reviewing completion. A coach's final submission does not automatically close the entire campaign.
7. The voice widget has a conversation with the coach, asks follow up questions and produces feedback for coach approval. Human approval precedes saving or submitting feedback.
8. One campaign prepares one team for one competition. Separate teams or competitions have separate campaigns.
9. Submitted feedback is visible only to its authoring coach and admins in this release. Players and other coaches cannot read it.
10. Feedback consists of written observations, strengths and development focus. Numeric ratings are not required and rating suggestions are outside this release.
11. Drafts are editable. Submitted feedback is fixed. Admins can record an audited correction linked to the original submission, without creating another final assessment.
12. New feedback pauses during competition. An admin opens final feedback afterwards.
13. Voice capture starts with English, including Singapore accents. Raw audio is discarded after processing. The implementation needs to verify both application and provider retention before rollout.

## Decisions still needed during design

The core product answers above are confirmed. These remaining details belong in specifications, rather than an invented schema in this scope.

| Decision | Current boundary | Why it matters |
|---|---|---|
| Minors, consent and data location | No special requirements identified, explicitly unresolved before real player data or voice rollout | Your planning answer is not a verified consent or data policy |
| Account activation and admin bootstrap | Admin provisions access, users then use email and password | Decide invitation, initial password setup, recovery and the first admin account |
| Feedback and transcript retention | Raw audio discarded after processing, text feedback retained as player data points | Define draft, transcript, audit and deletion periods, including provider configuration |
| Stage transitions and old drafts | Admin controls preparation, competition pause, final feedback and closure | Define stale drafts, delayed voice output, stage reversal and any reopening policy |
| Roster changes and final obligations | Feedback only for authorised coach and player assignments | Define withdrawn players, coaches who leave, participation and any documented exception before closure |
| Final corrections | Preserve the original final submission and audit admin corrections | Define how corrected text appears without bypassing the singular final submission rule |
| Quality and operating targets | Small pilot, English first, no fixed date | Approve representative eval samples, quality thresholds, device targets, budget and load assumptions |

## Reference boundary

The walkthrough used the deployed Coach demo in `sufa-crm-dev.pages.dev` and read the local copy of `justintangjx/sufa-crm-dev`. Version 2 remains a new project. No feature from the reference is marked as already implemented here.

The useful patterns are assigned campaigns, player rosters, editable drafts and submitted history. The reference has magic link access, a U24 matrix with a soft target of two assessments, and a separate legacy form with seven ratings. Version 2 follows your confirmed password, unlimited preparation, text feedback and private visibility rules.

No feedback was saved or submitted during the walkthrough. Voice recording and a live provider conversation were not exercised. Repository documentation describes additional capture and harness behaviour, but that does not prove deployed configuration.

## At a glance

| # | Feature | Phase | Status |
|---|---|---|---|
| 1 | Architecture and environments | Foundation | in-progress |
| 2 | Coding standards and agent context | Foundation | in-progress |
| 3 | Fresh data model and access rules | Foundation | in-progress |
| 4 | Verification harness and eval contract | Foundation | in-progress |
| 5 | Coach interface foundation | Foundation | in-progress |
| 6 | First real coach feedback path | Slice 1 | in-progress |
| 7 | Account and roster operations | Slice 2 | in-progress |
| 8 | Campaign and player workspace | Slice 3 | in-progress |
| 9 | Conversational voice feedback | Slice 4 | in-progress |
| 10 | Final feedback and campaign closure | Slice 5 | planned |
| 11 | Pilot release and recovery | Release | planned |
| 12 | Approved data deletion procedure | Release | planned |

## Foundations

### 1. Architecture and environments · in-progress

Record the application boundaries and runtime choices within your fixed provider constraints. Use local development with Docker and one production environment, with optional synthetic fixture previews and no hosted staging environment (basis: your confirmed architecture choices).

**Done when:** an approved architecture explains browser and server responsibilities, account provisioning, secret handling, deployment boundaries and the smallest runnable foundation for the first real feedback path.

**Spec:** [0001](../specs/0001-architecture-environments/index.md), design confirmed on 6 October 2026. You authorised the scaffold through `/develop` on 8 October 2026. The scaffold is built and self checked. The feature remains in progress under the GA workflow.

**Code:** browser in [src/app](../../src/app/), shared contracts in [src/domain](../../src/domain/), server in [src/worker](../../src/worker/), setup in [README.md](../../README.md), GitHub Actions checks in [.github/workflows/checks.yml](../../.github/workflows/checks.yml). You chose to save the scaffold checklist in [verify.md](../specs/0001-architecture-environments/verify.md). You authorised GitHub Actions checks through `/develop` on 9 October 2026. The workflow is built and self checked locally, with browser checks using the installed Chrome fallback. A GitHub run remains to be verified.

* [x] Decide the architecture (spec): `/architect architecture and environments`
* [x] Scaffold the runtime foundation: `/develop stack and architecture foundation: scaffold`
* [x] Add GitHub Actions checks: `/develop architecture and environments: GitHub Actions checks`

### 2. Coding standards and agent context · in-progress

After an approved scaffold exists, capture conventions and commands from the real project. Give each new agent one clear route to current intent, specifications, code boundaries and verification evidence (basis: your request for safe agent handoff).

**Done when:** root and relevant nested `AGENTS.md` files describe the real project, current state distinguishes built from planned work, and setup and check commands are reproducible without private chat context or embedded secrets.

**Code:** tooling commands in [package.json](../../package.json), formatting in [.prettierrc.json](../../.prettierrc.json) and [.prettierignore](../../.prettierignore), commit checks in [.githooks/pre-commit](../../.githooks/pre-commit) and [scripts/install-hooks.ts](../../scripts/install-hooks.ts), setup in [README.md](../../README.md). You authorised `/develop tooling` on 9 October 2026. Tooling is built and self checked. Hook activation waits for a Git repository. The feature remains in progress under the GA workflow.

* [ ] Capture conventions and tooling: `/audit`

### 3. Fresh data model and access rules · in-progress

Define people, account roles, campaigns, competitions, roster membership, coach assignments, observations, final feedback, voice drafts and audit history from the new rules. A fresh model and no legacy data migration are the starting scope (basis: your fresh build request and confirmed feedback rules).

**Done when:** the model supports one team and competition per campaign, unlimited preparation observations, one final submission per coach, player and competition, private author and admin access, and explicit draft, correction, retention and membership rules enforced at the data boundary.

**Spec:** [0002](../specs/0002-fresh-data-model-access-rules/index.md), design confirmed on 6 October 2026. Implementation remains unstarted and requires separate authorisation.

* [x] Design the model (spec): `/architect fresh data model and access rules`
* [ ] Build it: `/develop fresh data model and access rules`
  * [ ] Establish core schema, permanent pairings, private reads and preparation write contracts. AC-1, AC-2, AC-3, AC-4, AC-5, AC-11, AC-12, AC-14, AC-15.
  * [ ] Prove the preparation path with real local Auth identities and database evidence. AC-1, AC-2, AC-3, AC-4, AC-5, AC-11, AC-16.
  * [ ] Add frozen obligations, final submissions, waivers, closure and correction history. AC-2, AC-3, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-14, AC-15.
  * [ ] Publish voice context contracts and prove permissions, concurrency, retries and retention. AC-1 through AC-16.
* [ ] Verify it: `/check verify fresh data model and access rules`
* [ ] Test it: `/test fresh data model and access rules`
* [ ] Review it (fresh model): `/check review fresh data model and access rules`
* [ ] Document it: `/document fresh data model and access rules`

### 4. Verification harness and eval contract · in-progress

Define a small harness, meaning one repeatable entry point that runs relevant checks and reports missing evidence. It grows with each slice instead of postponing access and feedback checks until release (basis: your eval and harness request, and verification through real boundaries).

**Done when:** the approved contract separates deterministic checks, real database access tests, provider evals and human browser checks, maps each acceptance criterion to evidence, reports failures or missing checks honestly and uses synthetic data by default.

**Spec:** [0003](../specs/0003-verification-harness-eval-contract/index.md), design confirmed on 6 October 2026. Implementation remains unstarted and requires separate authorisation.

* [x] Design the verification contract (spec): `/architect verification harness and eval contract`
* [ ] Build it: `/develop verification harness and eval contract`
  * [ ] Prove the shared runner, structured reports and foundation browser/logic adapters locally and in CI. AC-1, AC-2, AC-3, AC-4, AC-8, AC-11, AC-14.
  * [ ] Connect the real local database checks with safe synthetic setup and complete data rule mappings. AC-3, AC-5, AC-6, AC-14.
  * [ ] Add ten text cases, per attempt integrity review, quality scoring, trusted approvals and retained evidence. AC-8, AC-9, AC-10, AC-11, AC-12.
  * [ ] Implement phase specific release gates, migration history reading and future provider/smoke adapter contracts. AC-3, AC-6, AC-7, AC-9, AC-10, AC-12, AC-13.
  * [ ] Prove failure, retry, retention, interruption and provenance behaviour, and record reproducible evidence. AC-1 through AC-14.
* [ ] Verify it: `/check verify verification harness and eval contract`
* [ ] Test it: `/test verification harness and eval contract`
* [ ] Review it (fresh model): `/check review verification harness and eval contract`
* [ ] Document it: `/document verification harness and eval contract`

### 5. Coach interface foundation · in-progress

Define a focused layout for choosing a campaign and player, reviewing feedback and using the voice widget on desktop and mobile (basis: observed coach context switches and accessible form practice).

**Done when:** the design covers keyboard and screen reader access, a recommended WCAG 2.2 AA target, clear campaign and player context, recording state, review and submission controls, and loading, empty, error and offline states.

**Spec:** [0004](../specs/0004-coach-interface-foundation/index.md), design confirmed on 7 October 2026, including your subsequent approval of all four independent review fixes. UI-1 through UI-4 are resolved. Implementation remains unstarted and requires separate authorisation.

* [x] Design the interface (spec): `/architect coach interface foundation`
* [x] Resolve review decisions UI-1 through UI-4: pending action ownership, input locks, original phase transitions and voice provenance.
* [ ] Build it: `/develop coach interface foundation`
  * [ ] Establish visual values, semantic components, data router and one clearly labelled synthetic screen thread. AC-1, AC-2, AC-4, AC-14.
  * [ ] Add paginated campaigns and roster, responsive player routes, shared tabs and safe loading states. AC-2, AC-3, AC-4, AC-9, AC-10, AC-13.
  * [ ] Build editor, draft and submission interactions with own history, corrections and stage projections. AC-4, AC-5, AC-6, AC-7, AC-9, AC-11.
  * [ ] Add navigation protection, conflict and pending action recovery, input locks, original phase transitions, actor isolation and voice provenance review. AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14.
  * [ ] Prove the scenario matrix, browser layouts and human accessibility, retaining honest fixture and live evidence boundaries. AC-1 through AC-14.
* [ ] Verify it: `/check verify coach interface foundation`
* [ ] Test it: `/test coach interface foundation`
* [ ] Review it (fresh model): `/check review coach interface foundation`
* [ ] Document it: `/document coach interface foundation`

## Slice 1: Prove one real feedback path

### 6. First real coach feedback path · in-progress

Prove the whole thread using a minimal admin flow, one provisioned coach, one campaign in preparation and one roster player. The coach logs in, writes feedback, reviews it, explicitly submits and reads it back (basis: your chosen Tracer Bullet approach).

**Done when:** the real account, data store, access rules, server boundary and interface work together, the saved observation persists across sessions and another unauthorised account cannot access it, including through direct requests.

**Spec:** [0005](../specs/0005-first-real-coach-feedback-path/index.md), design confirmed on 7 October 2026, including all eight independent review fixes. FP-1 through FP-8 are resolved. Implementation remains unstarted and requires separate authorisation.

* [x] Design the first path (spec): `/architect first real coach feedback path`
* [ ] Build it: `/develop first real coach feedback path`
  * [ ] Establish the local schema and private setup journal, prove Auth compatibility, then connect admin setup, password login and one real preparation submission with readback. AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-12, AC-13.
  * [ ] Connect explicit draft saving, later resume, private history and repeat preparation submissions. AC-6, AC-7, AC-8, AC-9.
  * [ ] Add account progress and recovery, safe replacement links, durable email attempts, exact conflicts and retry evidence. AC-2, AC-3, AC-4, AC-5, AC-9, AC-10, AC-12.
  * [ ] Add real preparation freeze and draft purge, pending action recovery, current access guards and concurrency checks. AC-7, AC-9, AC-10, AC-11, AC-12.
  * [ ] Complete preparation readiness with real local Auth, database and browser evidence, human accessibility checks and sanitised release records. AC-1 through AC-13.
* [ ] Verify it: `/check verify first real coach feedback path`
* [ ] Test it: `/test first real coach feedback path`
* [ ] Review it (fresh model): `/check review first real coach feedback path`
* [ ] Document it: `/document first real coach feedback path`

## Slice 2: Expand accounts and assignments

### 7. Account and roster operations · in-progress

Expand the thin admin path into adding coaches and players, activating accounts, maintaining campaign assignments and roster membership, password recovery and access removal (basis: your provisioned account boundary and complete account lifecycle).

**Done when:** admins can provision both account types without public registration or leaked passwords, users can log in with email and password, player accounts reach an agreed minimal account surface, duplicate and partial provisioning failures recover safely, and access removal follows the approved historical access rules.

**Spec:** [0006](../specs/0006-account-roster-operations/index.md), design confirmed on 7 October 2026. Independent design critique was skipped at your request. Implementation remains unstarted and requires separate authorisation.

* [x] Design account operations (spec): `/architect account and roster operations`
* [ ] Build it: `/develop account and roster operations`
  * [ ] Prove eligible local password recovery through private records, shared link state, captured mail, password completion and fresh login. AC-1, AC-3, AC-5, AC-7, AC-8, AC-11, AC-12.
  * [ ] Add the account directory, authorised email detail and lookup, profile maintenance, safe progress and admin requested recovery. AC-1, AC-2, AC-3, AC-5, AC-6, AC-11, AC-12.
  * [ ] Connect campaign membership maintenance with preserved history, pairing ownership and frozen roster restrictions. AC-3, AC-4, AC-11, AC-12.
  * [ ] Complete concurrency and failure checks, trusted administrator setup, production controls and readiness evidence. AC-1, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12.
* [ ] Verify it: `/check verify account and roster operations`
* [ ] Test it: `/test account and roster operations`
* [ ] Review it (fresh model): `/check review account and roster operations`
* [ ] Document it: `/document account and roster operations`

## Slice 3: Expand the coach workspace

### 8. Campaign and player workspace · in-progress

Expand the first path to assigned campaign lists, player rosters, player feedback history and repeatable preparation feedback. Keep the current player and campaign visible while switching context (basis: your feedback rules and observed roster navigation).

**Done when:** coaches can find their assigned players, create unlimited distinct preparation observations, resume editable drafts, read authorised history and see the current stage and their frozen final assessment requirement count without duplicate submissions from retries. Full final completion remains in feature 10 (basis: your confirmed 0007 boundary).

**Spec:** [0007](../specs/0007-campaign-player-workspace/index.md), design confirmed on 8 October 2026 after an independent critique by another model and your approved navigation fix. Implementation remains unstarted and requires separate authorisation.

* [x] Design the workspace (spec): `/architect campaign and player workspace`
* [ ] Build it: `/develop campaign and player workspace`
  * [ ] Prove a thin real search, player selection, preparation filing and stored history path with caller authorised reads and generated types. AC-1, AC-2, AC-3, AC-5, AC-6, AC-9, AC-10, AC-12.
  * [ ] Expand campaign and roster discovery, own activity indicators, retained selection and guarded navigation across the full filtered roster. AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-11.
  * [ ] Complete history previews, date filters, targeted submission detail and truthful self frozen requirements. AC-5, AC-6, AC-7, AC-8, AC-10, AC-11.
  * [ ] Complete session and query races, access changes, offline recovery and real readiness evidence. AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12.
* [ ] Verify it: `/check verify campaign and player workspace`
* [ ] Test it: `/test campaign and player workspace`
* [ ] Review it (fresh model): `/check review campaign and player workspace`
* [ ] Document it: `/document campaign and player workspace`

## Slice 4: Add conversational voice

### 9. Conversational voice feedback · in-progress

Let the coach speak with an embedded conversational assistant about the selected player. The assistant asks useful follow up questions and prepares text feedback for review in the existing form (basis: your chosen conversational voice flow).

**Done when:** the English conversation preserves stated facts and uncertainty, the coach can edit and approve the draft, player and campaign context stays bound to the session, cancellation or provider failure preserves manual entry, audio handling meets the confirmed discard rule, and no agent action saves or submits feedback without coach approval.

**Spec:** [0008](../specs/0008-conversational-voice-feedback/index.md), design confirmed on 8 October 2026 after independent critique and six approved fixes. Implementation remains unstarted and requires separate authorisation.

* [x] Design voice capture (spec): `/architect conversational voice feedback`
* [ ] Build it: `/develop conversational voice feedback`
  * [ ] Establish session data, quotas and atomic filing guards, then prove one preparation conversation through trusted local compatibility setup and explicit feedback readback. AC-1 through AC-10, AC-12, AC-14.
  * [ ] Complete capture, cancellation, provider closure, crash recovery and context races while preserving manual baselines and pending receipts. AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-12, AC-14.
  * [ ] Complete configuration and privacy checks, metadata cleanup, disclosure, approvals and safe operational visibility. AC-1, AC-3, AC-7, AC-8, AC-9, AC-11, AC-12, AC-14.
  * [ ] Collect the ten text and twenty speech cases, actual device and accessibility evidence, and fresh human review for the approved activation path. AC-2, AC-3, AC-4, AC-5, AC-6, AC-10, AC-11, AC-12, AC-13, AC-14.
* [ ] Verify it: `/check verify conversational voice feedback`
* [ ] Test it: `/test conversational voice feedback`
* [ ] Review it (fresh model): `/check review conversational voice feedback`
* [ ] Document it: `/document conversational voice feedback`

## Slice 5: Complete the campaign

### 10. Final feedback and campaign closure · planned · needs a decision

Let admins pause new feedback during competition, open final feedback afterwards, review completion and close the campaign. Coaches assess each player's performance once under the approved final submission rule (basis: your confirmed stage and completion rules).

**Done when:** each eligible coach and player pair can submit one final assessment for its competition, concurrent requests and retries cannot create a second final submission, writes follow the current stage, fixed submissions remain intact, admin corrections are audited, and closure records missing feedback and any approved exceptions.

* [ ] Design campaign completion (spec): `/architect final feedback and campaign closure`

## Release

### 11. Pilot release and recovery · planned · needs a decision

Prepare a controlled coach pilot with real account delivery, database access, voice behaviour and a deployed application. Record which evidence is automated and which is verified in staging or by a human (basis: your chosen GA verification and the difference between mock and deployed evidence).

**Done when:** deployment configuration and migrations match the approved specifications, browser and device checks pass, backup and rollback procedures are exercised, provider usage and errors are observable without exposing player feedback, and the release record names every verified or unresolved gate.

* [ ] Design pilot readiness (spec): `/architect pilot release and recovery`

### 12. Approved data deletion procedure · planned · needs a decision · from spec 0002

Define how an approved deletion request affects application records, Supabase Auth, audit history, backups and provider records, while accounting for durable references and retained feedback (basis: the separate deletion procedure surfaced by specification 0002).

**Done when:** an approved procedure names the decision maker, eligible requests, affected records, execution and verification steps, and treatment of audit history, backups and provider data. No generic purge endpoint is implied. This is a readiness gate before real player data under specification 0002.

* [ ] Design the deletion procedure (spec): `/architect approved data deletion procedure`

## Verification coverage seeds

These are outcomes for the later harness specification, not executable tests or claimed results.

| Area | Evidence the future harness should collect |
|---|---|
| Accounts | Provisioned email and password login, password setup and reset, role boundaries, duplicate and partial provisioning, revoked access |
| Real data access | Admin, assigned coach, unassigned coach and player against the real database rules, including direct reads and writes |
| Preparation feedback | More than two submissions succeed, previous observations remain distinct, draft recovery and retries preserve intent |
| Final feedback | Second submissions fail, simultaneous submissions yield one final record, retries return the existing result, another competition stays independent |
| Stage changes | Stale screens, saved drafts and delayed voice results cannot bypass the current campaign stage or revoked assignments |
| Corrections and closure | Coaches cannot rewrite submitted feedback, admin corrections preserve originals and audit linkage, and closure records outstanding obligations |
| Voice content | Singapore accents, noise, names, shorthand, negation, corrections, missing details and follow up questions, using reviewed synthetic or consented samples |
| Voice integrity | No invented observations, no mixing players, no unsupported ratings or decisions, no instruction in speech that bypasses app rules |
| Human approval | Generated feedback remains a proposal, coach edits are preserved, cancellation creates no submitted assessment |
| Audio and privacy | Verify application and provider audio retention, consent and data handling before real voice rollout, with no raw audio in persistent logs |
| Failure handling | Microphone refusal, disconnection, provider outage, expired sessions, empty speech and rate limits leave a usable manual path |
| Release evidence | Exact code, migration and provider versions, dated results, declared quality thresholds and unresolved live or manual checks |

Quality thresholds need approval against a representative eval set. A passing mock suite cannot establish real database permissions, email delivery, provider quality or deployed readiness. The harness should report missing infrastructure checks instead of calling them passed.

## Deferred

Three feature groups remain outside this release. They are kept here so you can add them deliberately later.

1. Player portal, self evaluations, feedback sharing and broader player CRM records.
2. Legacy Growth Matrix placement, multiple coach signoffs, selection recommendations, NPS and questionnaires.
3. Notifications, messaging integrations, billing, several organisation workspaces, broad analytics and legacy data migration.

Public marketing pages and SEO are unnecessary for the current authenticated workspace (basis: all primary journeys require account access). Additional languages, retained audio and advanced reporting are outside this release.

## Handoff and legend

**Next planning step:** you can use `/architect architecture and environments` in a fresh session. Data model, access and campaign rule decisions can also be designed before coding. No `/develop`, scaffold or deployment follows automatically from this scope.

**Agent context:** this file records product scope. `/architect` owns specifications in `docs/specs/`, and `/audit` captures project instructions after the approved scaffold exists. Specifications should link acceptance criteria, approved decisions, build milestones and verification requirements. Research detail belongs beside the specifications, outside `docs/scope/`.

**Status:** `planned` means no design or implementation is claimed. Later pipeline stages advance work to `in-progress` and `done`. The reference app is context, not `existing` implementation in this workspace.

**needs a decision:** the feature has one entry box for design. After its specification is captured, the scope can gain a spec link, build milestones and verification boxes. Atomic build tasks belong in the specification.

**Verification depth:** GA recommends app verification, tests, an independent review and release documentation. A successful automated run and completed live deployment checks remain separate evidence.

**Decision boundary:** your product choices above are confirmed. The remaining design and rollout questions stay unresolved until a specification or explicit answer settles them.

## References

**Project sources:** your product brief and answers, the [reference repository](https://github.com/justintangjx/sufa-crm-dev), its local coach routes and harness documentation, and the [deployed coach demo](https://sufa-crm-dev.pages.dev/coach) inspected on 6 October 2026. The old app remains context for the fresh SFDA build.

**Practices:** establish foundations before feature work, prove a real vertical slice early, enforce access and feedback invariants at the data boundary, and separate automated evidence from live deployment evidence. These explain the scope's order and design entry points.

**Verified official documentation:**

* [Supabase password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) and [admin account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser), account creation uses a trusted server boundary with protected credentials.
* [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), database access policies work together with grants. Real role checks remain necessary.
* [Cloudflare Pages deployment guide](https://developers.cloudflare.com/pages/get-started/), a reference for the existing hosting pattern. The architecture specification still needs to settle the Cloudflare runtime and deployment shape.
* [ElevenLabs Agents](https://elevenlabs.io/docs/eleven-agents/overview), conversational voice, follow up interaction, tools and monitoring.
* [ElevenLabs privacy controls](https://elevenlabs.io/docs/eleven-agents/customization/privacy), audio saving and conversation retention have separate settings. Verify the actual configuration against your discard rule before rollout.
* [ElevenLabs agent testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing), conversation simulations and response or tool checks can complement the app's own approval and access tests.
* [WCAG 2.2](https://www.w3.org/TR/WCAG22/), the source for the recommended accessibility target of level AA.
