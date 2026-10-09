# 0002. Fresh data model and access rules

**Date**: 2026-10-06
**Status**: Proposed

## Summary

Use a fresh relational model for your SFDA coach feedback pilot. Coaches assess the whole campaign roster, with unlimited preparation submissions and one final assessment per coach, player and competition. Database rules protect private feedback, preserve submitted originals and make campaign completion explicit. This specification defines future implementation, with no code or infrastructure changes authorised.

## Requirements

**User stories**

* As an admin, you can maintain provisioned people, campaigns and assignments without giving coaches administrative permission.
* As a coach, you can save a reviewed draft or submit reviewed feedback for a campaign player, then read your own history.
* As an admin, you can freeze final obligations, waive missing assessments with reasons, correct submitted content and close a completed campaign.

**Acceptance criteria**

* **AC-1**: Each profile references an existing Supabase Auth user and has one fixed role, admin, coach or player. Missing or disabled profiles cannot access campaign or feedback data. Public registration grants no application access.
* **AC-2**: Each campaign has its own team name and one competition. A competition identifies one division at an event. Coaches assess its whole roster. The same coach and player pairing is permanently bound to the first campaign that admits it for that competition, including after removal and before the final freeze.
* **AC-3**: Only the authoring coach reads their drafts. Submitted feedback and correction history are readable only by their authoring coach and admins. Players and other coaches cannot read them. Coaches cannot read roster login emails.
* **AC-4**: In preparation, an active campaign coach can make unlimited distinct submissions for active roster players. There is at most one saved draft per coach, campaign, player and feedback kind. Saving is explicit, and submission can atomically save reviewed form text without a prior draft save.
* **AC-5**: Submission requires nonblank observations and a coach confirmed observation date no later than today in Singapore. Strengths and development focus are optional. Database submission time is distinct from observation date. Planned dates do not control permission.
* **AC-6**: Only an active admin moves stages forward through setup, preparation, competition, final feedback and closed. Competition pauses feedback writes and atomically freezes the active coach and roster pairings. Each ending feedback stage atomically deletes its unfinished drafts.
* **AC-7**: No new coaches or players join after the freeze. An existing removed coach can be restored with an audit record, without creating obligations or reversing waivers. Frozen player obligations remain assessable after later player withdrawal, including nonparticipation.
* **AC-8**: Each coach, player and competition has at most one submitted final assessment. Different concurrent requests cannot create a second final, while retries of the same committed request return its original identity when current read permission allows.
* **AC-9**: An admin can permanently waive an outstanding final obligation with a required reason. Submitted obligations cannot be waived. Closure succeeds only in the final stage when every frozen obligation is submitted or waived, and records completion counts.
* **AC-10**: Submitted originals cannot be edited or deleted through ordinary application operations. An admin can append ordered corrections to text and observation date, including after closure, with a required reason. Identity and submission time remain fixed. Readers see original and latest corrected content together, with correction history available.
* **AC-11**: Removing a coach assignment stops writes but preserves campaign, roster and their own feedback reads. Withdrawing a player during preparation stops new feedback while preserving authorised history. Disabling the caller's whole account stops all campaign and feedback access through current database checks.
* **AC-12**: Stale draft updates fail without overwriting the newer version. Retried mutations do not create duplicate records or audit events. Stage transitions, final submissions, waivers and membership changes are atomic under concurrency.
* **AC-13**: Voice produces temporary proposals only. Only explicitly reviewed coach text enters feedback records. No application audio or transcript is stored. Late voice results are discarded when stage or permission context changes.
* **AC-14**: Submitted feedback, corrections, waivers and audit records are retained indefinitely unless an approved deletion request is processed. That deletion procedure is separate future design. Stage expiry deletes draft content, and normal account removal uses access revocation without cascading history deletion.
* **AC-15**: Significant mutations record the authenticated actor, action, affected identifiers and database time, with required reasons and metadata changes. Failed or replayed requests create no duplicate audit event. Errors and logs expose no feedback text, credentials or unrelated record details.
* **AC-16**: Implementation has real local Supabase evidence for every role, direct reads and writes, retries, races and stage boundaries. Synthetic fixtures and provider simulations are labelled honestly. No mock result substitutes for actual database permission evidence.

## Decision

**Chosen option**: Relational tables, Row Level Security for reads, and narrowly authorised database functions for atomic writes (basis: scope, confirmed architecture 0001 and your design answers).

**Content review**: Model shape and completed specification confirmed by you on 6 October 2026, including the pairing ownership and membership reference fixes. Status remains Proposed because the feature is unbuilt.

**Permission boundary**: Planning only. This does not authorise scaffolding, SQL execution, account creation, provider configuration, installation or deployment.

Use one feedback table for drafts and submissions, with separate correction and waiver records. Separate draft and submission tables are the alternative, but duplicate fields and validation. Use the existing Vitest setup for real local Supabase calls; SQL focused test tooling is the alternative and adds another setup. No new provider, ORM, test framework or connection is selected.

## Feature design

### Data model

UUID means a generated unique identifier. Unless stated otherwise, identifiers are generated by the database with `gen_random_uuid()`. Every foreign key uses restrictive deletion, without cascading durable history. Instants use `timestamptz` and database time; calendar dates use `date`.

| Table | Required fields | Nullable fields | Keys and relationships |
|---|---|---|---|
| `profiles` | `id` UUID, `display_name` text, `role` enum, `access_enabled` boolean default false, `version` integer default 1, `created_at`, `updated_at` | None | Primary key `id` references `auth.users.id`, one profile per account. Role and identity never change in this release. Email and password remain in Auth. |
| `competitions` | `id`, `name` text, `version`, `created_at`, `updated_at` | `starts_on`, `ends_on` dates | Unique normalised name identifies event, year and division. One competition can have several campaigns. |
| `campaigns` | `id`, `competition_id`, `name`, `team_name`, `stage` enum default setup, `version`, `created_at`, `updated_at` | `planned_preparation_start_on`, `requirements_frozen_at`, `closed_at` | Competition link is fixed from creation. Unique normalised team name within a competition prevents duplicate named team campaigns. No shared team table. |
| `campaign_coaches` | `campaign_id`, `coach_id`, `is_active` boolean, `version`, `created_at`, `updated_at` | None | Composite primary key `(campaign_id, coach_id)`. Coach references a profile whose fixed role is coach. Preserve the row on removal. |
| `campaign_players` | `campaign_id`, `player_id`, `is_active` boolean, `version`, `created_at`, `updated_at` | None | Composite primary key `(campaign_id, player_id)`. Player references a player profile. Preserve the row on withdrawal. |
| `competition_pairings` | `competition_id`, `coach_id`, `player_id`, `campaign_id`, `created_at` | None | Composite primary key `(competition_id, coach_id, player_id)` permanently identifies its first campaign. References the campaign competition and both membership rows. A matching composite unique key including campaign ID supports feedback and obligation foreign keys. |
| `feedback_entries` | `id`, `campaign_id`, `competition_id`, `coach_id`, `player_id`, `kind` enum, `status` enum, `version`, `created_at`, `updated_at`, `reviewed_at` | `observations`, `strengths`, `development_focus`, `observed_on`, `submitted_at`, `final_obligation_id` | References campaign competition and both membership rows. Final entries reference their matching obligation. Nullable draft fields become subject to submission constraints. |
| `final_obligations` | `id`, `campaign_id`, `competition_id`, `coach_id`, `player_id`, `frozen_at` | None | References campaign and both memberships. Unique `(competition_id, coach_id, player_id)` across all campaigns. Completion is derived, not a mutable stored status. |
| `final_waivers` | `obligation_id`, `admin_id`, `reason`, `created_at` | None | Primary key references one obligation. Admin references a profile. Immutable and permanent. |
| `feedback_corrections` | `id`, `feedback_id`, `admin_id`, `revision`, `observations`, `observed_on`, `reason`, `created_at` | `strengths`, `development_focus` | References a submitted entry and admin profile. Unique `(feedback_id, revision)`. Each correction is a full corrected content snapshot. |
| `audit_events` | `id`, `actor_kind`, `action`, `target_type`, `target_id`, `created_at`, `metadata` JSON object | `actor_id`, `campaign_id`, `mutation_id`, `reason` | Actor references a profile. A trusted bootstrap event alone may use actor kind bootstrap with null actor ID. Target IDs are intentionally not foreign keys, so deleted drafts remain traceable without retaining content. |
| `mutation_receipts` | `actor_id`, `mutation_id`, `action`, `fingerprint_version` default 1, `request_hash`, `result_type`, `result_id`, `result_version`, `result_metadata` JSON object, `created_at` | `campaign_id` | Primary key `(actor_id, mutation_id)`. Store committed identifiers and safe result metadata, never request bodies, feedback text, dates from drafts, tokens or transcripts. |

Enums are `admin`, `coach`, `player` for roles; `setup`, `preparation`, `competition`, `final_feedback`, `closed` for stages; `preparation`, `final` for feedback kinds; and `draft`, `submitted` for feedback status.

All editable rows have a positive integer version. Every successful change increments it once and updates database time. Membership rows and profile access status supply revision values for future voice context checks. Permanent pairings, frozen obligations, receipts, submitted originals, corrections, waivers and audit events are immutable. Audit actions and metadata keys have a fixed allowlist defined by the action catalog below.

### Validation and indexes

* Names are trimmed, nonblank and at most 160 Unicode characters. Name uniqueness uses `lower(btrim(name))`; team uniqueness uses `lower(btrim(team_name))` within competition. Display names need not be unique.
* Observations have at most 10,000 characters. Strengths and development focus each have at most 5,000. Blank optional text becomes null. Draft observations and date may be absent. Submission and correction require nonblank observations and a finite date expressed as `YYYY-MM-DD`.
* Reasons are trimmed, nonblank and at most 2,000 characters. Required metadata corrections, withdrawal, removal, restoration, disabling, waiver and feedback correction record a reason.
* Validate dates against `(current_timestamp AT TIME ZONE 'Asia/Singapore')::date`. No future observation date is accepted. Competition end must not precede start when both are supplied. Planned dates do not gate stages or feedback.
* A partial unique index permits one draft for `(campaign_id, coach_id, player_id, kind)` where status is draft. Another permits one submitted final for `(competition_id, coach_id, player_id)` where kind is final and status is submitted.
* Submitted rows require `submitted_at`, `observed_on` and observations. Draft rows have null submission time. Final rows require an obligation matching all identity fields; preparation rows have no final obligation. Compound foreign keys keep campaign, competition and membership identities consistent.
* Index membership lookup by user and campaign, submitted history by `(campaign_id, coach_id, player_id, submitted_at, id)`, corrections by feedback and revision, obligations by campaign and coach, and audits by campaign, time and ID.
* Membership activation locks the competition, computes the newly admitted cross product with active members of the opposite role, and creates missing `competition_pairings` in the same transaction. An existing pairing for this campaign is reused; a pairing owned by another campaign rejects the entire mutation with `PAIR_CONFLICT`. Ownership begins even in setup and without saved feedback. Removal, withdrawal, restoration and stage changes never release it. Feedback entries and final obligations reference that same campaign owned pairing through a composite foreign key.

### State transitions

| Transition | Admin action and atomic result |
|---|---|
| Setup to preparation | Open preparation. Dates remain informational. |
| Preparation to competition | Delete preparation drafts, freeze the cross product of active campaign coaches and active roster players, record the freeze time and pause feedback writes. Disabled login status does not silently remove a designated roster person or obligation. |
| Competition to final feedback | Open final entry for outstanding frozen obligations. No new membership rows can be added. |
| Final feedback to closed | Require zero outstanding obligations, delete final drafts and record closure time plus submitted and waived counts. |

There is no backward transition, stage skip or reopening. An empty snapshot is recorded explicitly as frozen with zero required assessments; it still needs every admin stage transition and explicit closure. It does not constitute pilot success evidence.

Preparation writes require an active coach assignment and active player membership. Final writes require an active coach assignment and an outstanding frozen obligation. A later player withdrawal or disabled player login does not remove that obligation or stop an eligible coach assessing it. A removed coach retains scoped reads but has no writes until restored. A waiver remains permanent after restoration.

Draft save is explicit. Submission can create a submitted row directly, or consume a named draft using its expected version and reviewed form content. If a draft already exists but a new submission omits its ID, return `DRAFT_EXISTS` instead of silently overwriting or leaving a competing draft. Submitted content is fixed. A correction appends a new revision and never changes the original entry, obligation or submission time.

Deleting ending stage drafts happens in the stage transaction. A failed transition deletes nothing. There is no archive of deleted draft content, and receipt or audit metadata must not preserve its text or observation date.

### Read access

All work reads require an enabled profile. Former campaign coaches remain historical members for read authorisation.

| Data | Admin | Enabled current or former campaign coach | Player, unrelated coach or anonymous caller |
|---|---|---|---|
| Campaign and competition context | All | Assigned campaign context | None |
| Campaign roster and display names | All | Assigned campaign roster, including withdrawal status | None |
| Coach membership rows | All | Own memberships only | None |
| Permanent competition pairings | All | Own pairings in assigned campaigns only | None |
| Draft content | None | Own drafts only | None |
| Submitted feedback and corrections | All | Own submissions and their corrections only | None |
| Obligations and waivers | All | Own obligations and waiver reasons only | None |
| Audit events | All | None | None |
| Mutation receipts | All metadata | Own receipts for readable campaign context | None |

`profiles` permits authenticated column reads only for ID and display name, under its row policies. Coaches can read those columns for themselves and roster players in assigned campaigns. Admin profile management reads use a bounded authorised function for role, access status and version. Receipt reads expose actor, request, action, result references, safe result metadata and time only; request hashes are internal and have no authenticated column read grant. There is no roster email projection. `get_my_access` can report only the caller's safe account status, including disabled or missing profile, without returning work data. Players have this minimal account status surface only.

Original feedback and latest correction are displayed together. Correction history is ordered by revision. Its administrative attribution in the coach interface is the fixed label Admin; the precise admin identifier remains in the correction and private audit record. No other coach's submission count or text enters a coach completion result.

### Security model

Row Level Security means database rules deciding which rows a caller can read. Enable it on every exposed table. Explicitly revoke table insert, update and delete from anonymous and authenticated roles, then grant only permitted reads. Do not rely on project default grants. No public view may bypass the caller's row policies.

Mutating functions use `SECURITY DEFINER`, meaning their owner's permission, only to perform the narrow transaction. Each checks `auth.uid()`, the current enabled profile, its fixed role and the exact target scope. Use an empty fixed search path and fully qualified objects. Revoke execution from PUBLIC and anonymous roles, then grant exact intended signatures to authenticated callers. Private policy helpers return caller scoped permission booleans, take no arbitrary actor ID and are outside exposed API schemas.

Ordinary profile creation is admin only for existing Auth users with coach or player role. Profiles default to disabled until authorised activation. Ordinary profile access operations manage coach and player accounts only. First admin bootstrap and additional administrator provisioning use separately designed trusted operator procedures. There is no public role change, self promotion, actor override or generic patch function.

Database guards reject changes to immutable identity fields, submitted originals, corrections, waivers, receipts and audits through normal operations. Auth user and profile deletion is restrictive. No generic purge or cascading account deletion is exposed. Approved deletion needs its own design before use.

Personal data handling remains a real rollout gate: minors, consent, data location, provider retention and the approved deletion procedure are not established by synthetic tests. Indefinite retention is your chosen application policy, not a verified legal conclusion.

### API surface

Database functions are called through the Supabase client under the user's token, using `POST /rest/v1/rpc/<function>`. They add no Worker data proxy. Auth account creation and recovery remain future Worker account operations. Each mutation takes a required client generated `mutation_id` UUID. Actor, role, timestamps, IDs, revisions and counts come from the database, not caller overrides.

`expected_version` is required for changes to an existing editable row. Membership creation uses null for its expected version; an existing row needs its current version. Metadata updates carry the complete editable snapshot, including explicit null dates, so omitted fields cannot silently erase existing values. Unknown fields are rejected.

| Function | Required inputs, beyond mutation ID for writes | Result | Auth | Principal errors |
|---|---|---|---|---|
| `get_my_access` | None, no mutation ID | Own profile ID, display name, role, enabled status and version, or missing status | Authenticated caller | `AUTH_REQUIRED` |
| `admin_list_profiles` | Optional role filter and page cursor, page size | IDs, display names, roles, enabled status and versions, next cursor | Enabled admin | `FORBIDDEN`, `INVALID_INPUT` |
| `create_profile` | Existing Auth ID, display name, role coach or player | Disabled profile reference | Enabled admin | `AUTH_USER_MISSING`, `PROFILE_EXISTS` |
| `update_profile_name` | Profile ID, display name, expected version, reason | Profile reference and version | Enabled admin; target coach or player | `VERSION_CONFLICT`, `FORBIDDEN` |
| `set_profile_access` | Profile ID, enabled boolean, expected version, reason | Profile reference and version | Enabled admin; target coach or player | `VERSION_CONFLICT`, `FORBIDDEN` |
| `create_competition` | Name, nullable start and end dates | Competition reference | Enabled admin | `NAME_CONFLICT`, `INVALID_INPUT` |
| `update_competition` | Competition ID, full name and date snapshot, expected version, reason | Competition reference and version | Enabled admin | `VERSION_CONFLICT`, `NAME_CONFLICT` |
| `create_campaign` | Competition ID, name, team name, nullable planned preparation date | Campaign reference, stage setup | Enabled admin | `NOT_FOUND`, `NAME_CONFLICT` |
| `update_campaign_metadata` | Campaign ID, full editable snapshot, expected version, reason | Campaign reference and version | Enabled admin | `VERSION_CONFLICT`, `NAME_CONFLICT` |
| `set_campaign_coach` | Campaign ID, coach ID, active boolean, expected membership version, reason | Membership reference and version | Enabled admin | `PAIR_CONFLICT`, `STAGE_LOCKED` |
| `set_campaign_player` | Campaign ID, player ID, active boolean, expected membership version, reason | Membership reference and version | Enabled admin | `PAIR_CONFLICT`, `STAGE_LOCKED` |
| `advance_campaign_stage` | Campaign ID, expected campaign version, exact next stage, reason | Campaign reference, resulting stage, obligations created, drafts deleted | Enabled admin | `STAGE_CONFLICT`, `OUTSTANDING_FINALS` |
| `save_feedback_draft` | Campaign ID, player ID, kind, content snapshot, `review_confirmed: true`; draft ID and expected version when editing | Feedback reference and version | Enabled active campaign coach | `STAGE_CLOSED`, `VERSION_CONFLICT`, `DRAFT_EXISTS` |
| `discard_feedback_draft` | Draft ID and expected version | Deleted draft reference | Author with current write permission | `NOT_FOUND`, `VERSION_CONFLICT` |
| `submit_feedback` | Campaign ID, player ID, kind, complete content, `review_confirmed: true`; draft ID and expected version when consuming it | Submitted feedback reference | Enabled active campaign coach | `INVALID_INPUT`, `ALREADY_SUBMITTED`, `OBLIGATION_WAIVED` |
| `waive_final_obligation` | Obligation ID and reason | Permanent waiver reference | Enabled admin, final feedback stage | `ALREADY_SUBMITTED`, `ALREADY_WAIVED`, `STAGE_CLOSED` |
| `correct_feedback` | Submitted feedback ID, complete corrected content, reason, expected latest correction revision (zero for first) | Correction reference and revision | Enabled admin, any campaign stage | `NOT_FOUND`, `VERSION_CONFLICT`, `INVALID_INPUT` |
| `get_campaign_completion` | Campaign ID, no mutation ID | Frozen flag, stage, scope, required, submitted, waived and outstanding counts | Enabled admin or assigned current or former coach | `NOT_FOUND` |
| `list_final_obligations` | Campaign ID, optional status filter and page cursor, page size, no mutation ID | Permitted pair IDs, derived status, submission or waiver reference, next cursor | Same completion read scope | `NOT_FOUND`, `INVALID_INPUT` |

Content is `{observations, strengths, development_focus, observed_on}`. Draft fields may be null; submission and correction validation differs as specified above. Profile access functions cannot manage administrator accounts or convert roles. No action accepts an author or elevated permission override.

Direct caller scoped table reads supply assigned campaign lists, roster membership, display names, own draft, submitted history, correction history, authorised audit pages and receipts. All application lists use stable cursor paging, default 20 and maximum 100 rows. History orders by submission time then ID descending, corrections by revision, other lists by creation time then ID. Membership lists use their creation time and profile ID as the stable tie breaker. A draft lookup uses its unique subject key and is not a list.

Completion status is derived from a submitted final or a waiver for each obligation. Admin scope is the campaign; coach scope is only that coach. A result includes `scope: "campaign"` or `"self"` so a coach count cannot be mistaken for complete campaign readiness. Before freeze, `frozen: false` with zero counts does not mean closed or complete.

### Mutation protocol and failures

Success returns `{outcome, mutationId, result}`. Outcome is `committed` or `already_committed`. Result names the record type, record ID, committed version and whether that record still exists. Immutable records use version 1; corrections use their revision. A membership reference contains campaign ID and coach or player ID. Stage result metadata also records resulting stage, obligations created and drafts deleted. Closure metadata records required, submitted and waived counts. These values describe the committed action; callers refresh authorised reads for current state.

`audit_events.target_id` and `mutation_receipts.result_id` are UUIDs. For a membership mutation, both are the campaign ID, `target_type` and `result_type` name `campaign_coach` or `campaign_player`, and both metadata objects require the corresponding `coach_id` or `player_id`. Their `campaign_id` column is also required for these actions. The external membership result expands this stored reference into `{type, campaignId, coachId or playerId, version, exists}`. Replay existence checks use the full composite membership key. Other actions use their target row UUID; a waiver uses its obligation UUID. Pairing insertions are internal effects of the membership action and do not require a separate receipt or audit target.

The receipt stores this minimal result reference. If a stage transition has since deleted a draft, replay reports that committed draft reference as unavailable and never recreates it. It does not return deleted content. A deleted draft ID on a new request returns `NOT_FOUND`.

Normalize the action and named inputs inside the database, excluding mutation ID, to a version 1 JSON object. Its fingerprint is the hex output of built in `sha256(convert_to(jsonb::text, 'UTF8'))`, using `encode(..., 'hex')`. This needs no new extension. The receipt binds actor, action, subject and normalized payload to the request ID. A reused ID with different action or payload fails `IDEMPOTENCY_CONFLICT`. Preserve and test this version 1 serialization contract across database upgrades before promotion.

Every mutation checks current caller identity and permitted read scope before returning an existing receipt. It then returns a matching prior committed reference without requiring the old stage still be writable. New mutations need current write permission. Account disabling denies replay access to work records. An enabled former campaign coach can retrieve a prior result for their readable campaign but cannot create a new write.

Record writes, receipt and audit event commit in one transaction. Rejection or rollback commits none of them. The database supplies exactly one audit event for each successful logical mutation. Draft deletion and obligation insertion performed by a stage change are represented by its single transition event and counts.

Check the receipt again after acquiring the relevant write locks, before changing records, so two simultaneous copies of the same request observe one commit. A concurrent receipt key conflict from a different action rolls back the losing transaction and returns `IDEMPOTENCY_CONFLICT`.

Audit action names are the mutating function names in the catalog, plus `admin_bootstrapped` for the trusted bootstrap event. Metadata allows target identifiers, previous and resulting versions, before and after values of the editable profile, competition, campaign and membership fields, stage names, and obligation, draft and closure counts. Feedback saves, submissions and corrections include only identity and revision references, never their content or observation dates. Waiver and correction reasons remain in their dedicated records; other required reasons use the audit reason field.

For writes, lock and recheck the caller profile so access disabling and writes have a defined commit order. Then lock the competition parent, campaign and affected child rows in that order. All competition scoped membership, stage, feedback and waiver functions follow the same order. Lock affected correction feedback rows before reading their latest revision. Profile management takes caller and target locks without entering a competition transaction. Acquire multiple locks of the same type by UUID order. Roles are immutable and ordinary admin access actions cannot target another administrator.

The competition lock serializes overlapping pair admission across campaigns. The campaign lock serializes freeze, stage changes, final submission and waiver. Unique indexes remain the final backstop, including when the child row does not yet exist. This intentionally favours simple correctness for the small pilot over parallel writes within one competition.

If final submission commits first, a competing waiver fails. If waiver commits first, submission fails and the waiver remains permanent. Closure checks counts under the same locks. If a draft save commits before its stage ends, that stage transition deletes it. If the transition commits first, the save fails. No late save can resurrect a deleted draft.

Known failures use safe machine codes. Function errors map to HTTP 401 for missing identity, 403 for forbidden caller, 404 for missing or inaccessible target, 409 for stage, version, duplicate, waiver or idempotency conflict, 422 for validation, and 500 for unexpected database failure. Use safe PostgREST custom SQL states and messages, without raw constraint details, SQL context or content. Direct read denial may return no rows under policy, or a permission error for a forbidden column; the client presents an unavailable state without asserting whether another user's record exists.

Retry a transient network failure, deadlock or serialization failure at most twice, after 250 ms and 500 ms, using the identical normalized action and request ID. Never retry validation, permission or state conflicts automatically. Preserve unsaved local form text when safe, then offer reconciliation. A reload or closed tab loses that temporary text and the memory only login session, as chosen in architecture 0001.

### Voice boundary

Voice session implementation belongs in its own specification. Its binding must include caller ID, campaign ID, player ID, kind, campaign revision, caller access revision and relevant membership revisions captured at session start. Validate the binding before returning a proposal for review and again against current write permission when coach saves. Any intervening stage or permission change invalidates the result even if access is later restored.

No ElevenLabs credential, callback or tool can call a feedback write as the coach. Provider output has no submission authority. Saved text uses the same coach authenticated functions and explicit review action as manual text. The application stores no conversation transcript, raw audio or unreviewed proposal. Provider retention and cancellation behaviour remain separate release gates before voice is enabled.

### Value sourcing

| Value | Named source |
|---|---|
| Caller and audit actor | `auth.uid()` and current `profiles` row; trusted bootstrap marker only in the separately controlled bootstrap path |
| Role, enabled state and permission revision | `profiles.role`, `access_enabled` and `version`, checked in the database |
| Login email | Supabase Auth, returned only through own Auth identity or future admin account operations |
| Campaign, team, competition and display labels | Validated admin inputs stored in their named columns; identities remain UUID links |
| Coach and player membership | Admin target profile IDs, fixed role checks and membership `is_active` state |
| Permanent campaign ownership of a pairing | First successful membership activation cross product, persisted in immutable `competition_pairings` |
| Membership audit and replay identity | Campaign UUID plus `coach_id` or `player_id` in required metadata, reconstructing the composite membership key |
| Frozen eligibility | Active membership cross product at the competition transition, persisted as `final_obligations` |
| Feedback author and competition | Verified caller and selected campaign's fixed competition ID, not actor input |
| Feedback content and observation date | Coach reviewed form snapshot, including confirmed `observed_on` |
| Singapore today | Database current timestamp converted using fixed `Asia/Singapore` zone |
| IDs, times and committed versions | Database UUID generator, transaction time and version increment under locks |
| Original, corrected content and revision | Immutable feedback entry, latest `feedback_corrections` revision and ordered correction rows |
| Waiver and reason | Admin supplied reason and `final_waivers` row with database actor and time |
| Completion totals and outstanding list | Frozen obligations joined to submitted finals and waivers within the permitted read scope |
| Closure and deletion counts | Counts from the locked transition transaction, also stored in its audit and receipt metadata |
| Mutation key and fingerprint | Browser `crypto.randomUUID()` and database normalized version 1 action hash |
| Retry result and availability | Matching `mutation_receipts` reference and current existence check, never stored feedback text |
| Page order and cursor | The named table ordering columns above, final returned row key and bounded page size |
| Voice context revision | Current campaign, caller and membership versions captured and compared by the future voice feature |
| Coach correction attribution | Fixed display label Admin; exact `admin_id` in correction and private audit records |

### Verification contract

No new production secrets or environment variables are introduced. Use local configuration sources already defined in 0001. Real tests use Docker and local Supabase with synthetic Auth users, while provider calls remain off. Check the target is local before fixture reset or privileged test setup. No database or test command is executed by this planning pass.

| Scenario | Evidence and acceptance criteria |
|---|---|
| First thin path | Provision synthetic admin, coach and player Auth identities, create profiles and campaign, assign roster, open preparation, submit and read a real observation. AC-1, AC-2, AC-4, AC-5, AC-16 |
| Permission matrix | Exercise actual anonymous, player, author, other coach, former coach, disabled caller and admin tokens against every table and function. Verify denied direct DML, forbidden profile columns and admin draft text access. AC-1, AC-3, AC-11, AC-15, AC-16 |
| Preparation and drafts | Save incomplete draft, reject unapproved write, submit more than two distinct observations, consume a draft or submit directly, reject stale versions while retaining local text. AC-4, AC-5, AC-12 |
| Dates and inputs | Empty observations, oversized text, malformed or future dates, UTC and Singapore midnight boundary, optional fields, same label case and missing Auth identity. AC-1, AC-2, AC-5 |
| Freeze and collisions | Race membership additions across campaigns; reject reassignment of a removed pairing before freeze, including one with no feedback; permit restoration in its owning campaign. Race save against competition start. Freeze exact active pairings, preserve removals and delete drafts transactionally. AC-2, AC-6, AC-7, AC-12 |
| Finals | Race two distinct final requests and replay one request. Exactly one submitted final and one audit event for that action; another actual competition stays independent. AC-8, AC-12, AC-15 |
| Waivers and closure | Race final against waiver, require reason, reject waiver reversal, block missing closure, close with submitted and waived obligations, test explicit zero obligation snapshot. AC-6, AC-9, AC-12 |
| History and correction | Withdraw a preparation player, remove and restore coach, disable whole account using an already issued token, correct content and date after closure, race correction revisions. AC-3, AC-7, AC-10, AC-11 |
| Lost response and stale stage | Replay membership mutations using both campaign and person, distinguish different members of the same campaign, replay committed action after stage end, detect changed payload, never resurrect purged draft, reject new saves in ended stage and roll back all effects on failure. AC-6, AC-12, AC-14, AC-15 |
| Voice proposal boundary | Contract checks prove no stored transcript, no provider write authority and explicit reviewed text path; simulated late result is discarded after stage or permission revision changes. Live agent and retention evidence is separately missing until voice work. AC-13, AC-16 |
| Retention | Verify restrictive account foreign keys, blocked submitted deletion and no draft content in receipts or audit metadata after transition. Approved deletion remains a separate gated procedure. AC-10, AC-14, AC-15 |

## Build plan

This is a future plan, not permission to execute it. The approved foundation scaffold and local Docker environment must exist first. Follow the Tracer Bullet approach by proving a real authenticated preparation path before adding final lifecycle rules. Screens, Auth delivery and live voice remain their own scope features.

1. Add the first reviewed SQL migration for profiles, competitions, campaigns, memberships, permanent competition pairings, preparation entries, audits and receipts. Apply explicit grants, read policies, immutable identity guards and validation, with no public signup provisioning trigger. Generate TypeScript database types. Satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-11, AC-14, AC-15.
2. Implement the caller scoped read contracts and preparation mutation functions, including explicit review, direct submission, versions, receipts, sanitized errors and transaction audit. Add pure domain input and result validation using the existing TypeScript stack. Satisfies AC-3, AC-4, AC-5, AC-12, AC-15.
3. Prove the thin path using actual local Auth identities and Supabase client calls: admin setup, coach login, assigned player, reviewed submission and readback. Use Vitest integration checks, plus a small temporary developer check surface only when the interface foundation is separately authorised. Record actual database evidence, not a mock pass. Satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-11, AC-16.
4. Add the second reviewed migration for final obligations, permanent waivers, correction snapshots and their constraints and policies. Add final kind fields and guards to entries as required by that slice, then regenerate types. Satisfies AC-6, AC-7, AC-8, AC-9, AC-10, AC-14.
5. Implement forward stage transactions, pair admission checks, freeze, exact stage draft deletion, restoration, final submission, waiver, completion projections and closure. Keep metadata updates separate from identity changes. Satisfies AC-2, AC-6, AC-7, AC-8, AC-9, AC-11, AC-12, AC-15.
6. Implement append only corrections, original plus latest projection, paginated history and private audit reads. Reject revision conflicts and keep post closure corrections independent of completion. Satisfies AC-3, AC-10, AC-12, AC-14, AC-15.
7. Publish the shared reviewed text and context revision contracts needed by the future voice feature, with synthetic stale context checks and no provider implementation or media storage. Satisfies AC-13, AC-15, AC-16.
8. Run real role, direct DML, concurrency, revocation, date boundary, retry and retention checks from the scenario table. Resolve failures and record fixture, migration and code versions. Satisfies AC-1 through AC-16.
9. Verify the built data surfaces, obtain an independent implementation review and document the evidence before enabling real player use. Record unavailable account delivery, live voice, consent, location and deletion evidence as separate gates. Satisfies AC-14, AC-15, AC-16.

The two migrations are intentional slices of the confirmed target. The first exposes only preparation capabilities; final stage functions are unavailable until the second slice is complete. Production migrations remain manual and reviewed before dependent app deployment, following architecture 0001. No rollback automatically drops tables or reverses retained data.

## Consequences

You get database enforced privacy, explicit final obligations and a small shared feedback path for manual and approved voice text. Durable originals and correction history make decisions reviewable.

There are deliberate costs. Stage changes delete unfinished drafts, and the interface must explain that consequence before its future transition action. Waivers cannot be reversed, even if issued by mistake. A disabled account loses historical work access, while removal from one campaign preserves it. Competition scoped write locks trade throughput for clear ordering in the small pilot. Role conversion and approved data deletion require later design.

A pairing cannot move to another campaign for the same competition after its first admission, even before feedback exists. The extra pairing table preserves that rule independently of current assignments and final obligations. A different competition permits its own independent pairing.

Indefinite retention applies to submitted records and audits. It does not establish a legal or consent basis for real data. The local database tests required by this feature add evidence beyond the initial fixture based scaffold tests, without introducing a second test framework.

## Follow-up

* [ ] Architecture scaffold and agent context must exist before implementation. Read confirmed specification 0001 and capture actual project commands after the authorised scaffold.
* [ ] Account operations must define first admin bootstrap, Auth activation, passwords, recovery, provisioning failure recovery and safe admin email reads. They must honour fixed roles and restrictive account deletion.
* [ ] Campaign and final feedback interfaces must explain draft deletion, show original and corrected content together, and respect the fixed obligation and permanent waiver rules here.
* [ ] Voice must implement the binding, cancellation, explicit review and late result contracts, with actual provider retention evidence before enablement.
* [ ] The harness specification must define reproducible commands, migration manifests, real database evidence and distinct live release gates. Real database checks are required when implementing this data feature, even though the initial scaffold uses fixtures.
* [ ] Design the approved data deletion procedure as a separate feature, including who approves a request, its database and Auth effects, audit treatment, backups and provider records. Do not create a generic purge endpoint in this slice.
* [ ] Resolve minors, consent and data location before real player data. Review the chosen retention policy in that actual operating context.
* [ ] Previously recorded official Supabase skills remain optional for later installation. Local Supabase MCP remains the first optional connection. Nothing is installed or connected by this specification.

## Rationale

Reasoning, alternatives, source notes and the scope boundary are in [rationale.md](rationale.md).
