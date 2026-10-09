# 0007. Campaign and player workspace

**Date**: 2026-10-07
**Status**: In Progress

## Summary

Expand the coach workspace with searchable campaigns, filtered player rosters and readable feedback history. Keep the selected player and unfinished work stable while coaches browse. Show only the coach's own feedback activity and frozen assessment requirements. Reuse the approved interface and access rules, with final feedback operations and voice left to their later features.

## Requirements

**User stories**:

* As a coach, you can find current campaigns and return to readable historical campaigns.
* As a coach, you can find players, resume your saved drafts and record repeated preparation observations.
* As a coach, you can read your submitted feedback for the selected player and campaign without losing unfinished work.

**Acceptance criteria**:

* **AC-1**: An enabled coach sees Current campaigns by default, containing active assignments to campaigns that are not closed. History contains closed campaigns and former assignments. Every result identifies campaign, team, competition, stage and current or historical access. Missing or disabled profiles receive no work data.
* **AC-2**: Campaign search matches campaign, team and competition names, combined with an optional stage filter. Filtering runs over the whole authorised query before cursor paging, not only loaded rows. Lists use stable ordering, explicit Load more, a default page size of 20 and maximum 100.
* **AC-3**: Roster search matches display names and player references. Coaches can filter active or withdrawn players and players with their own saved preparation draft. Each row shows only that coach's preparation submission count and most recent submission time. No other coach's draft, text, count or player login email is returned.
* **AC-4**: Filtering does not change the selected player or discard local work. A selected player outside the filter stays open with an explicit label. Previous and Next follow the complete filtered roster order, including records beyond loaded pages, and use the existing unsaved work guard. Every navigation branch rechecks the named target's access and filter match before moving. A changed query cancels the navigation intent, and local Discard takes effect only after the target check succeeds. They do not wrap around or silently choose another player after a stale result.
* **AC-5**: Preparation uses the real 0002 and 0005 draft and submission contracts. Coaches can resume their one saved draft, explicitly save incomplete reviewed text and submit unlimited distinct reviewed observations. Submission is immutable, retains the selected player and starts a blank preparation form only after known success. No autosave, automatic submission or duplicate mutation from a repeated response is introduced.
* **AC-6**: History contains only the author's submitted feedback for the selected campaign and player. It orders newest submission first, shows observation date separately from submission time and provides a short preview expandable to the full original entry. An optional observation date range filters the full authorised query before paging. Another campaign's history is not combined with it.
* **AC-7**: Before freeze, show that final requirements are not set. After freeze, show only the caller's frozen assessment count and the current stage. Final submission, waiver, correction and full completion operations remain in feature 10. This slice does not invent zero completion counts, query absent correction or waiver tables, or enable live voice.
* **AC-8**: The 0004 actor owned pending controller, immutable mutation snapshot, original phase latch, input locks, dirty navigation and reconciliation apply across the expanded workspace. Late results cannot overwrite another player or force navigation. An unknown outcome keeps its original request identity and blocks competing feedback writes until resolved.
* **AC-9**: Current database access governs every read and write. Former coaches retain permitted history without writes. Withdrawal, account disabling, stage changes and stale draft versions produce the approved read only or unavailable behavior. Refresh on focus, reconnect, explicit request and before filing; ignore obsolete read callbacks and clear work when account access is lost.
* **AC-10**: The workspace adds no database entity, personal field, stored preference or persisted activity counter. Search, filters, expanded entries and read caches are temporary and keyed to the actor and context. Credentials, feedback, pending payloads and query text are absent from browser persistence and application logs. Reload requires login and current saved state inspection before another write.
* **AC-11**: The 0004 desktop roster layout, narrow sequential views, visual values and accessible components remain the design source. Search, filters, Load more, Previous/Next, history expansion and date controls work with keyboard and screen reader status announcements. Loading, empty, filtered empty, unavailable, offline and failed later page states are distinguishable without changing player identity.
* **AC-12**: Real local Supabase, Auth, Worker and browser evidence covers the expanded preparation path, permission boundaries, server filtering, own aggregates, paging and navigation races. Vitest, Playwright and the existing readiness runner map every criterion to evidence. Fixtures cannot claim live final or voice capability, and missing pilot evidence remains missing.

## Decision

**Chosen option**: Extend 0004 and the real preparation path with caller authorised SQL search and read projections, temporary filter state and guarded roster navigation (basis: 0001, 0002, 0004 and 0005).

**Mode and scope**: FEATURE, scope feature 8, Tracer Bullet, GA. This creates a separate specification and does not replace earlier designs.

**Project context**: No application source, package manifest, AGENTS.md, CLAUDE.md or Git repository exists at design time. The approved specifications supply implementation context. Build the earlier foundation before this feature.

**Permission boundary**: Design only. No coding, provisioning, migrations, installations, connections, publication or deployment is authorised.

**Design source**: The routes, layout, components, typography, colors and interaction rules in 0004. There is no new branding, asset service, dashboard or player portal.

**Feature boundary**: This slice implements real preparation feedback and authorised original history. It extends 0004's initially absent search controls. Full final completion, final writes, waivers and corrections belong to feature 10; live voice belongs to feature 9. Account and membership maintenance remain in 0006. No cross campaign player timeline, ratings, comparative coach metrics or feedback export is added.

**Review state**: You confirmed the design content on 8 October 2026. An independent critique by another model found one navigation completeness gap. You approved its recommended fix, now recorded in the navigation contract and test scenarios. Document checks passed after that edit. All 12 acceptance criteria map to build tasks and test scenarios, and local document links resolve. Implementation remains unstarted. Status remains Proposed until implementation advances it; content confirmation does not authorise coding or provisioning.

## Rationale

Reasoning, alternatives and confirmed choices: see [rationale.md](rationale.md).

## Feature design

### Reused model and derived fields

The 0002 schema and 0006 membership rules remain authoritative. No new domain table or stored preference is needed. Add one SQL migration for read functions and their exact grants, then generate TypeScript types. This is a function migration, not a new player or feedback schema.

| Record | Primary key and foreign keys | Relationship and use |
|---|---|---|
| `profiles` | `id` references `auth.users.id` | One profile per Auth account. Use permitted display name and caller access, never roster email. |
| `competitions` | `id` | One competition has many campaigns. Supplies descriptive context. |
| `campaigns` | `id`, `competition_id` FK | Name, team, stage, version and nullable freeze timestamp. |
| `campaign_coaches` | `(campaign_id, coach_id)`, campaign/profile FKs | Many coaches to many campaigns. Own current and historical membership grants read scope. |
| `campaign_players` | `(campaign_id, player_id)`, campaign/profile FKs | Many players to many campaigns. Preserved active or withdrawn membership. |
| `competition_pairings` | `(competition_id, coach_id, player_id)`, owning campaign and membership FKs | One campaign owns each competition pair permanently. Existing write identity remains fixed. |
| `feedback_entries` | `id`, campaign/competition/membership FKs | One pair has many preparation submissions and at most one preparation draft. Submitted rows keep original contents and dates. |
| `final_obligations` | `id`, campaign/competition/membership FKs | Frozen coach/player pairs. Read only the caller's requirement count in this slice. |
| `mutation_receipts` | `(actor_id, mutation_id)`, actor and optional campaign FKs | Existing committed reference reconciliation. Store no query, draft body or history content. |

Roster fields are derived, not columns. `has_saved_preparation_draft` is a required boolean from the caller's preparation draft existence. `preparation_submission_count` is the count of all their submitted preparation entries for this campaign/player. `latest_preparation_submitted_at` is their maximum submission instant, null when none. Counts are SQL integers serialized as nonnegative decimal strings in the new read projections, so the browser does not silently lose integer precision. No count means all coaches or all campaigns.

Draft existence and activity are separate: a saved draft is unfinished text, while count and latest time use submitted rows only. Do not include draft body or observation date in roster summaries. Optional submitted strengths and development focus retain their existing null rules. All timestamps retain database precision in cursors and use Asia/Singapore for human display. An observation date remains a calendar date, never shifted through UTC conversion.

### Queries, filters and paging

Campaign mode is `current` or `history`. Current requires own active coach membership and stage other than closed. History is the complement within the caller's readable memberships: inactive assignment or closed stage. A historical campaign can still be in preparation for other people. Labels say Historical access rather than implying the competition ended.

Campaign `query` is trimmed, at most 160 Unicode characters, with blank normalized to null. Match a literal case insensitive substring of campaign name, team name or competition name. `stage` is null or one approved stage enum, combined with the mode and query by AND. No team record, global competition lookup or author parameter is introduced.

Roster `query` has the same bound. Match display name substrings or a player UUID reference. Recognize an eight to 32 hexadecimal character prefix or a canonical UUID, ignoring case. A reference narrows authorised roster rows; it is not an arbitrary profile lookup. Display the first eight hexadecimal characters and expand loaded collisions to full UUIDs as in 0004. All actions use full player UUIDs.

Roster `membership` is `all`, `active` or `withdrawn`, default active. `drafts` is `all` or `saved`, default all. Active includes disabled player logins still rostered; the player account's login state does not determine whether the coach may assess them. SQL applies these filters before paging, using only the caller's draft existence.

History `observed_from` and `observed_to` are optional finite `YYYY-MM-DD` dates, inclusive, with from not after to. Empty bounds normalize to null. Future filter bounds are allowed and simply match no future stored observations; submission validation still forbids future observation dates. Filtering uses the immutable original `observed_on`, not submission time or an inferred corrected date. History may show an already stored original of either feedback kind from the shared table, labelled Preparation feedback or Final assessment, without enabling a final write or reading an absent correction table.

Keep approved ordering: campaigns by `(created_at, id)` ascending, roster by `(membership.created_at, player_id)` ascending and history by `(submitted_at, id)` descending. There are no sort controls in this slice. New filters reset only their list cursor and pages. They do not reset the selected editor or another list's query.

New list results are `{items, next_cursor, query_fingerprint, read_at}`. Default page size is 20, maximum 100; fetch one extra record to determine `next_cursor`. Cursors are versioned base64url JSON containing the exact database order tuple and a SHA256 fingerprint over caller ID, list kind, campaign/player scope and normalized filters. Cursor fingerprints are correlation checks, not authentication. They use the existing SQL hash approach, add no signing secret and are not retained. Validate version, bounded shape, UUIDs, finite timestamps, query fingerprint and ordering before use. Reject mismatches with `INVALID_CURSOR` and restart only through an explicit refresh. Altering a cursor cannot bypass caller policies.

Lists are current reads, not a frozen snapshot across pages. Deduplicate appended IDs. New membership, name or draft changes can alter membership in a filtered result; offer Refresh rather than promise an exhaustive unchanged snapshot. Use one database statement for each page and its projected activity so its returned rows and indicators share a snapshot. Counters use all matching authored submissions for each returned player, not the subset of feedback currently loaded in History. No whole roster download, materialized counter or new search service is required for the small pilot.

### Routes and selected context

Retain 0004 routes: `/coach`, `/coach/campaigns/:campaignId` and `/coach/campaigns/:campaignId/players/:playerId` with `tab=write` or `tab=history`. Search, filters and expanded entries are not added to URLs. Only IDs and the tab identify a route; route values grant no access.

Current and History controls sit above the campaign search and stage selector. A no result state distinguishes No current campaigns, No historical campaigns and No campaigns match these filters, with Clear filters where applicable. Historical links open the same authorised roster and History, with writes governed by actual stage and membership.

Roster controls precede the paginated rows. Each row shows name/reference, membership status, own saved draft badge, own preparation count and latest submission time. Zero is explicit, and no latest instant displays No submitted preparation feedback. Do not label unlimited preparation as incomplete or complete.

The selected workspace is independent of list membership. An outside filter label comes from a server match result, not from absence in loaded rows. Keep a compact selected player link outside the filtered list when necessary. If the player matches but is on an unloaded page, label Selected player is not in the loaded results instead. Do not add that row to the ordered result count or pretend it was returned by the page. Selection is cleared only by explicit navigation, session loss or confirmed loss of read access.

`get_coach_roster_neighbors` computes match, previous and next from the same complete authorised filtered relation. It uses the selected membership's immutable order key and returns at most one neighbor each way. If selected is outside the filter, both neighbors are null and buttons explain why. At an end, the missing direction is disabled; there is no wrapping. Direct links and Clear filters remain available.

On a Previous or Next click, capture the intended full target UUID, display name and originating applied query identity, with the existing actor/session and campaign/player context. Apply 0004's dirty or pending guard. Every branch, including clean navigation, Discard, Save draft and switch, and Leave while a mutation is pending, requires the same target check before committing navigation. Call `get_coach_player_context` for the named target with the captured roster query, membership and draft filters. Require current read access and a true filter match. After that read, require the originating context, session and query identity still to match the current navigation intent. A query change cancels the intent even if the named player would match the new filters.

Save draft and switch retains the existing controller's explicit target and checks it after known save success. Apply local Discard only once the target check succeeds, immediately before the guarded switch. Discard here does not delete a saved database draft. Leave during a pending action keeps that action in the controller and abandons its automatic navigation target as in 0004; the separate user requested move still needs the target check. A failed check or read retains the current workspace and its undiscarded local work. Explain changed roster or filters when confirmed, or offer Retry for a failed read. Do not substitute a different neighbor. A target beyond loaded pages opens by its authorised UUID without downloading earlier pages. Arrival focuses its heading; Back to roster focuses the loaded or pinned selected link, or the roster heading if neither remains available.

### Editor, history and frozen requirements

Reuse the existing parent editor, unique draft lookup, date sourcing, validation and explicit reviewed save/submit/discard actions. Wait for draft lookup before enabling inputs. Saving does not submit; submitting consumes the named existing draft and version when applicable. Known preparation success clears the form and date only for its original actor/player context. It refreshes that row's activity and History without changing selection. A Saved drafts filter may then exclude the player; the selected workspace remains open with its outside filter label.

History stays in the same parent context, so switching tabs does not discard typing. Each result shows kind, original observation date, submission time and the first 160 Unicode characters of observations as a plain text preview. An explicit Show full feedback disclosure loads its exact record by campaign/player/feedback UUID, including observations, nullable strengths and development focus. Collapse clears only the expanded view state, not the form or submitted record. No HTML rendering or inferred score is added.

Date changes reset History pages and collapse normal disclosures, preserving the parent editor. If View submitted feedback targets a known committed record outside the current date range, fetch that exact authorised entry and show it separately with Outside this observation date range. Do not silently change filters or include it in their list. If it also exists in the current result, render only one copy. On player/campaign departure, clear expansion IDs and targeted detail.

Original records remain fixed. The UI says Original submitted feedback while correction support is absent. Do not query `feedback_corrections`, return a fabricated empty correction list or imply that no correction exists. Feature 10 must connect the 0002 and 0004 original plus latest correction presentation before it enables correction use.

Campaign context returns `scope: self`, `requirements_frozen`, nullable `frozen_required_count` and stage. Before freeze, count is null and the label is Final assessment requirements are not set. After freeze, count derives solely from caller owned `final_obligations`. Zero means no frozen requirement for this coach, never campaign closure or pilot success. This slice displays no submitted, waived, outstanding or percentage values. It does not call `get_campaign_completion` or `list_final_obligations` paths requiring the later full completion schema.

The context includes `write_kinds: [preparation]` and `correction_support: unavailable`, constants from this feature's installed function definition, rather than browser selected permissions. Stage and memberships further govern actual preparation editability. Final and closed stages are readable without a final editor. Live voice stays unavailable under the existing feature boundary. Future features must migrate these capability responses and adapters together with their actual schema and permission checks.

### API and data surface

All new functions are caller scoped reads through `POST /rest/v1/rpc/<function>`. They require a current enabled coach and use `auth.uid()` internally, never a body author ID. Keep RLS on underlying tables and use `SECURITY INVOKER` read functions, which run under caller permissions. Obtain caller role/access/version through the existing safe `get_my_access` function, rather than granting direct reads of protected profile columns. Fix search paths, fully qualify objects, revoke anonymous and PUBLIC execution and grant only the intended signatures to authenticated callers. These functions change no data, generate no mutation receipt and add no Worker data proxy.

| Function | Inputs | Result | Material errors |
|---|---|---|---|
| `list_coach_campaigns` | `mode` required enum; optional `query`, `stage`, `cursor`, `page_size` | List envelope; each row has campaign ID/name/team, competition ID/name, stage/version, own membership active/version and access label | AUTH_REQUIRED, FORBIDDEN, INVALID_INPUT, INVALID_CURSOR |
| `get_coach_campaign_context` | `campaign_id` required UUID | Authorised campaign/competition fields, own profile and membership versions, active/historical access, self scoped freeze fields and supported write/correction fields | AUTH_REQUIRED, FORBIDDEN, NOT_FOUND |
| `list_coach_roster` | `campaign_id` required; optional `query`, `membership`, `drafts`, `cursor`, `page_size` | List envelope; full player ID/name, membership active/version, saved draft boolean and own preparation activity fields | FORBIDDEN, NOT_FOUND, INVALID_INPUT, INVALID_CURSOR |
| `get_coach_player_context` | `campaign_id`, `player_id` required UUIDs; optional roster `query`, `membership`, `drafts` | Campaign context, authorised player membership/name, filter match boolean, computed preparation writable flag and own preparation draft or null | FORBIDDEN, NOT_FOUND, INVALID_INPUT |
| `get_coach_roster_neighbors` | `campaign_id`, `player_id` required; optional roster `query`, `membership`, `drafts` | Query fingerprint, selected match flag, nullable previous/next references `{player_id, display_name, membership_version}` | FORBIDDEN, NOT_FOUND, INVALID_INPUT |
| `list_coach_feedback_history` | `campaign_id`, `player_id` required; optional `observed_from`, `observed_to`, `cursor`, `page_size` | List envelope; feedback ID/kind, original observation date, submission time and preview, plus correction support unavailable | FORBIDDEN, NOT_FOUND, INVALID_INPUT, INVALID_CURSOR |
| `get_coach_feedback_entry` | `campaign_id`, `player_id`, `feedback_id` required | Exact caller authored submitted original, identity fields, text, date and time; correction support unavailable | FORBIDDEN, NOT_FOUND |
| `save_feedback_draft`, `discard_feedback_draft`, `submit_feedback` | Exact existing 0002 and 0005 inputs, reviewed content, request UUID and draft/version where required | Existing committed or already committed reference and receipt | Existing validation, version, draft, stage and permission errors |
| `checkPendingResult` logical action | Original actor/context, retained mutation UUID and frozen payload | Existing caller scoped receipt and current authorised record/readback | Unknown remains unknown if absence alone cannot establish failure |

Use exact enum types, UUID types, positive versions, nullable finite dates and bounded inputs from the sections above. Draft result fields are `{id, version, updated_at, observations, strengths, development_focus, observed_on}` with the existing nullable content rules. Detail includes only a submitted entry matching all three requested IDs and `coach_id=auth.uid()`. A valid own entry from a different player or campaign is still NOT_FOUND in this context; do not silently route to its actual player.

Missing or inaccessible campaign/player/entry use the same NOT_FOUND result. Wrong role or disabled access is FORBIDDEN and clears work following fresh safe account status. RPC or schema absence is unavailable, not an empty list. A missing migration blocks release through the existing deployment prerequisite checks. A bad cursor offers Refresh with page reset and preserved selected editor. Safe errors use fixed codes and request correlation; raw query strings, tokens and provider objects are not displayed or logged.

### Temporary state and transitions

| State | Required contents | Optional or nullable contents | Lifetime |
|---|---|---|---|
| Campaign discovery | Actor/session epoch, current/history mode, normalized search, stage, fetch generation | Cursor and authorised pages | Coach session; reset on identity or session loss |
| Roster query | Actor, campaign, normalized search, membership/draft filters, query fingerprint, fetch generation | Cursor, pages, selected match/neighbor result | Campaign context; filters do not own the editor |
| Player workspace | Full actor/campaign/player identity and original editor kind; existing 0004 baseline/provenance/version state | Own draft, retained manual text, intended navigation target with originating session/context/query identity | Parent shared by Write and History |
| History query | Actor/campaign/player, date bounds, fetch generation | Pages, cursor, expanded IDs and separately targeted submitted entry | Current player context, separate from editor |
| Pending mutation | Existing actor owned UUID, frozen action/payload and original context | Receipt/result and navigation intent | Existing controller above RouterProvider, independent of route lifetimes |

The session epoch changes after logout, session loss or a new sign in, including the same actor signing in again. It prevents a late response from an earlier login being reused. Ordinary token refresh within the continuous session does not reset the epoch. Every read request carries epoch, actor, context, normalized query identity and fetch generation. Abort obsolete reads and reject their callbacks even if abort loses the race. Never show old rows or detail as the result of a new query.

Filter changes start loading their own list, clear its old pages and invalidate neighbor results, while keeping the selected context separate. Expansion results can render only while their exact original entry and context remain requested. A late page or expanded entry cannot select a player. Mutation callbacks belong to the existing pending controller, not this read generation.

Known draft save, discard or submission refreshes current original subject data and affected discovery results. If a draft or membership filter changed while the mutation ran, refresh using the latest filter rather than appending into the old result. A detached completion cannot select its original player or apply form reset to the current player. An unknown mutation retains the frozen original form and blocks new feedback mutations, while authorised read navigation remains available with the 0004 pending warning.

Preparation ending, assignment removal/restoration, withdrawal, stale version and whole account disabling keep the 0004 phase and access rules. In particular, ended preparation text never becomes final text. Restored assignment needs fresh same phase eligibility. Whole account disabling clears all contents. Session loss clears pending identities and loaded work; only the limited hidden manual recovery state allowed by 0004 may survive for same actor reauthentication. No previous query cache or pending identity is resurrected after login.

### Refresh, failures and accessibility

Use explicit Refresh plus existing focus/reconnect and before filing checks. No realtime subscription, polling service or background write queue is introduced. Automatic read refresh never submits text, changes selection or replaces dirty editor fields. If a fresh draft version differs, apply 0004's comparison and explicit reconciliation, not an automatic reload into the form. Offline permits allowed manual editing while filing and voice remain disabled; reconnect refreshes context before explicit retry.

Initial list loading has noninteractive placeholders and retains the independent selected heading. A failed later page keeps existing rows with Retry for that same query and cursor. Zero filtered rows offers Clear filters without changing selection. A failed required context read disables filing and shows Retry; it does not turn uncertain access into permission. A confirmed unavailable target hides its loaded work and offers Back to campaigns. Historical or withdrawn readable targets remain readable with the exact write restriction explained.

Search uses a labelled input and explicit Search and Clear buttons. Filters use native labelled selects. An applied query remains distinct from unsent search typing until Search is pressed. Pressing Enter applies Search without submitting the feedback form. No live search request is sent for every keystroke. Date bounds use labelled native controls and Apply date range or Clear dates, with inline invalid range messages.

Use accessible Current/History controls, list landmarks, selected link `aria-current`, and actual disabled navigation buttons with explanatory text. Keep search/filter focus after result changes and announce their load outcome. Load more retains button focus and announces appended count. Previous/Next arrival focuses the player heading. History disclosure uses `aria-expanded` and associated content; late loading updates that disclosure's status without moving focus. These extend the existing WCAG 2.2 AA keyboard, screen reader, zoom and touch checks.

### Security, configuration and evidence

Caller enabled status, role and historical campaign membership gate every new function. All roster aggregates filter the author explicitly before grouping; filtering by saved draft never considers another author's row. No coach supplied actor override, service credential, broad account list, draft contents in summaries or cross campaign history is exposed. Underlying row policies remain the authority even for directly issued requests outside the UI.

No new environment variable, credential, service or provider connection is required. Reuse 0001 local/preview/production configuration and 0006 account release controls. Preview data remains explicitly synthetic with no real Auth/DB/provider calls. Real player data remains behind scope feature 11 approval. Production migration prerequisites now include the workspace read function migration and its exact grants; reviewed migrations still precede merge and serial production promotion.

Retain fixed route labels in Worker logs and no request bodies or raw paths. New ordinary SQL reads create no application telemetry containing filters, names, feedback or credentials. Actor/context caches stay in memory only; do not add browser storage, a service worker data cache or persisted saved filters. Real Auth tests disable credential bearing trace/body capture and retain sanitised assertions. Synthetic UI fixtures remain visibly distinct from live local database evidence.

Extend the existing 0003 preparation manifest with this feature's real workspace checks. The campaign profile inherits them but remains missing until the later final workflow is built. Do not relabel fixture final/correction states as live passes. Pilot still requires actual devices, production smoke and policy evidence; voice keeps its separate eval contract. No new eval framework or judge is necessary for deterministic search, permissions and feedback filing.

### Value sourcing

| Action | Values produced or displayed | Named source |
|---|---|---|
| Campaign discovery | Mode, search, stage, row identity, team/competition, access and cursor | Explicit controls; current own membership and campaign/competition rows; stable database order and normalized query fingerprint |
| Player discovery | Name/reference, withdrawal, saved draft flag and preparation activity | Authorised profile ID/name and membership; caller preparation draft existence and all own submitted preparation entries for this campaign/player |
| Retained selection | Outside filter versus unloaded result label | Server current player match flag compared with separately loaded page IDs; never absence alone |
| Previous/Next | Intended target ID/name/version, direction availability and originating query identity | Current neighbor RPC over full filtered relation and immutable membership order; captured applied roster filters and session/context; fresh target context and true match before every guarded switch |
| Draft resume and filing | Content, baseline, original kind, draft ID/version, reviewed intent and mutation identity | Unique author draft read; parent editor and explicit coach action; browser UUID and existing 0002 atomic RPC/receipt |
| History | Kind, original date, submission instant, preview and full text | Own immutable submitted row matching selected campaign/player; optional date controls; bounded list and exact detail RPC |
| Targeted success detail | Committed feedback ID and range mismatch label | Confirmed mutation reference, fresh authorised detail and current applied date bounds |
| Frozen requirements | Self scope, frozen flag, nullable count and stage | Campaign freeze timestamp/stage and count of caller owned frozen obligations; capability constants from installed read functions |
| Refresh and error recovery | Current access, versions, epoch, query generation and safe result | Existing `get_my_access`, fresh context reads, session lifecycle, request controller and fixed backend error codes |
| Readiness | Pass/fail/missing, runtime, schema and evidence freshness | Existing 0003 runner, pinned real local runtime and actual checks; feature 10 and pilot evidence remain separate |

### Critical test scenarios

| Scenario | Required proof | Criteria |
|---|---|---|
| Real preparation thread | Real local coach with two campaigns and multiple players, saved draft resume, explicit submission, activity update, history detail and later login readback | AC-1, AC-3, AC-5, AC-6, AC-12 |
| Campaign modes | Active open, active closed and former open assignments; stage filter and each searchable context name; unrelated campaigns excluded | AC-1, AC-2, AC-9 |
| Server search and paging | Matches after the initial 20 rows, literal percent/underscore, duplicate names and UUID references; cursor/filter mismatch, page boundaries, dedupe and failed later page retry | AC-2, AC-3, AC-10, AC-11 |
| Private indicators | Another coach's drafts and submissions cannot affect flags, filters, counts or latest time; own multiple preparation submissions count across history pages; final rows do not affect preparation activity | AC-3, AC-6, AC-9, AC-10 |
| Selected context | Filters hide selected player, zero results, matching deep linked player beyond loaded pages, fresh submission removes Saved draft match; editor identity and text remain | AC-3, AC-4, AC-8, AC-11 |
| Neighbor navigation | Full filtered order across page boundaries, disabled ends, outside filter behavior and dirty Save/Discard/Stay; target removed or no longer matching before clean navigation, Discard, known save success or Leave while pending; query changes during a guard or target check cancel the intent, failed Discard checks preserve local edits, pending Leave preserves the unresolved controller; no substituted target or wrapping | AC-4, AC-5, AC-8, AC-9 |
| History queries | Original observed date differs from submitted day, inclusive bounds, invalid range, newest submission order, full detail matching all IDs, wrong player/campaign rejected, targeted success outside range and no duplicate rendering | AC-6, AC-8, AC-10, AC-11 |
| Stage and capability | Real preparation freeze deletes drafts and returns own required count, no freeze returns null, empty own freeze returns zero without claiming completion, absent final/correction paths not called and voice hidden | AC-5, AC-7, AC-9, AC-12 |
| Permissions | Anonymous, player, admin, unrelated coach and disabled coach denied; former coach reads own history but cannot write; withdrawn player remains readable without new preparation writes | AC-1, AC-3, AC-6, AC-9 |
| Response races | Old query page/detail, same actor new login, different actor, detached mutation, lost response, purged draft receipt and stale draft conflict preserve the controller/phase rules and clear disallowed contents | AC-5, AC-8, AC-9, AC-10 |
| Usability and offline | Chromium/WebKit desktop/mobile layouts, keyboard filters/disclosures/next, focus restoration, empty/error states, offline manual edits, reconnect validation and no form overwrite | AC-4, AC-8, AC-9, AC-11 |
| Evidence boundaries | Real local SQL/Auth/Worker checks versus fixtures, no new secret or persistence, no sensitive retained trace, and full campaign/voice/pilot prerequisites stay honestly missing | AC-7, AC-10, AC-12 |

Use the existing Vitest and Playwright setup with real local Auth and database calls for policy and query checks. Use controlled fixtures only for unavailable future visual states and deterministic delayed callbacks, clearly labelled as that evidence. Actual devices and human accessibility retain the separate 0003 requirements.

## Build plan

1. Add the caller authorised read function migration and generated types for campaign discovery, player context, roster activity and immutable history. Prove a thin real path: search a campaign, find a player beyond the first page, resume or submit preparation feedback, then expand its stored original. Preserve existing grants and mutations. Satisfies AC-1, AC-2, AC-3, AC-5, AC-6, AC-9, AC-10, AC-12.
2. Expand campaign Current/History controls and roster search/filter components with stable cursors, derived own indicators, retained selection and accessible loading/empty/error states. Add full filtered neighbors and guarded Previous/Next across pages, with fresh target checks on every branch and query change cancellation before local Discard or navigation. Satisfies AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-11.
3. Complete history previews, disclosures, original observation date range and targeted submission detail. Connect truthful self freeze requirements and original only correction boundary without later schema reads or final writes. Satisfies AC-5, AC-6, AC-7, AC-8, AC-10, AC-11.
4. Integrate query/session generations, explicit and lifecycle refresh, stale drafts, detached mutations, phase/access changes and offline handling with the existing controller. Prove the full local race, permission and navigation matrix without browser persistence. Satisfies AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-10, AC-11.
5. Complete preparation readiness mappings, real browser and database evidence, independent code review and concise verification documentation. Keep full campaign, voice and real pilot gates separate. Satisfies AC-7, AC-9, AC-10, AC-11, AC-12.

The first thread uses actual caller rules and existing atomic writes. Later tasks expand the interface and failure coverage; they do not postpone author privacy or actor isolation. No new player schema, copied activity table, production migration execution or real account creation is part of this design task.

## Consequences

* Coaches can find unfinished work and read player history while keeping a clear campaign and player context.
* Server queries cover unloaded records and preserve private author scope. Counts describe preparation activity, not quality or a required feedback quota.
* Current pages can drift when another tab or admin changes records. Refresh and target validation handle that reality without promising a frozen whole list.
* Memory only login, forms and pending IDs can be lost on reload. After that loss, history inspection precedes a new manual intent; exactly once intent recovery across reload is not promised.
* Filtered navigation, late callbacks and access changes need real interaction tests. Full final status, corrections and voice remain later capability and verification work.

## Follow-up

* [ ] Scope feature 9 connects conversational voice to the existing context and provenance contract, with its separate eval evidence.
* [ ] Scope feature 10 adds final writes, full self completion and original plus latest corrections, updating capability responses and read adapters together with real schema and permissions.
* [ ] Scope feature 11 resolves actual devices, production smoke and privacy approval before real player data. Scope feature 2 still owns coding standards and durable agent context before implementation.
* [ ] Previously deferred optional skills and MCP candidates remain recorded. No new installation, provider connection or tool discovery is required by this feature.
