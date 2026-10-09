# Campaign and player workspace reasoning

## Context

Your first real coach path proves one preparation feedback journey. The expanded workspace needs to remain usable when the coach has several campaigns, a larger roster and repeated observations per player. Names can repeat, saved drafts are private, and an admin may change stage or membership while a coach is working.

Scope feature 8 asks for campaign discovery, player rosters, draft resume, history and clear current stage. The earlier interface defines desktop and phone layouts, safe pending actions and phase transitions. This feature must preserve those decisions while adding filters and navigation that do not discard unfinished work.

The project remains planning only. No application or project context files exist. The six earlier approved specifications supply its stack, permissions and release boundaries. Final feedback operations, voice and real data rollout have separate future features.

## Options considered

### Option 1: Keep simple paginated lists

Use the initial 0004 lists and route links without new search, roster filters or richer history navigation (basis: 0004).

* Pro: Fewest new functions and interaction states.
* Con: Finding drafts or players after the first page becomes slow, and it does not satisfy your selected discovery requirements.

### Option 2: Add scoped database queries and guarded navigation

Filter and derive own activity in caller authorised SQL, using temporary UI state and the existing mutation controller (basis: 0001, 0002, 0004, 0005 and 0006).

* Pro: Covers the complete authorised dataset without downloading it and preserves existing feedback and access rules.
* Con: Requires explicit cursor/query handling and tests for selection, filter and permission races.

### Option 3: Load the whole roster and history into a client index

Fetch all readable records into browser memory and search locally (basis: client indexing as an alternative to bounded cursor pagination).

* Pro: Simple immediate filtering after the initial download.
* Con: Retains much more private data, gives a larger initial request and drifts from the approved bounded read and access refresh behavior.

## Rationale

Option 2 fits the small relational pilot without adding a search provider or frontend data framework. Search and own activity must cover records beyond the first loaded page, so a client only filter would miss work. Existing row policies, fixed roles and explicit author restrictions apply to both content and aggregates (basis: 0001 and 0002).

The selected editor is independent of a filtered list. Otherwise a successful submission that consumes a saved draft could make the editor disappear, or changing a filter could discard unsaved text. Neighbor reads supply exact full UUID targets, while existing dirty and pending guards protect any switch (basis: 0004 and your choices 11 and 12).

Preparation has no quota, so counts and latest submission time describe activity without percentages. Frozen requirement count is useful before the final workflow exists, but cannot imply submitted, waived or completed work. Full final readiness remains feature 10 and the real evidence contract remains 0003 (basis: scope, 0002, 0003 and choice 14).

### Internal recommendations and alternatives

| Detail | Chosen recommendation and reason | Runner up |
|---|---|---|
| New persistence | Reuse domain records and temporary state; no preference or activity table | Saved preferences and counters, add lifecycle and synchronization work |
| Search | Explicit Search with literal database matching before paging | Search only loaded rows, misses players and campaigns |
| Read functions | Caller permissions, explicit own author predicates and current safe account checks | Privileged broad reads and client filtering, increases exposure |
| Roster order | Preserve creation time and full UUID order from 0002 | Alphabetic controls, add mutable sort behavior without a chosen need |
| Draft and activity | Separate boolean draft marker from own submitted count/latest instant | Treat draft as a submission or summarize all coaches, gives false or private metrics |
| Query lifecycle | Epoch/context/query generation and explicit obsolete result rejection | Last response wins, can render old data under a new player |
| Next player | Server filtered neighbor, named target and existing navigation guard; fresh target check on every branch before local Discard or navigation | Next loaded array element or checking only after Save, misses page boundaries or filter races |
| History date | Original observation date range, submission time shown separately | Submission time range, answers a different training period question |
| Frozen state | Null before freeze, self count after freeze, no full completion claim | Display zero completed or a percentage before real final support |
| Future integration | Separate later capability migrations and honest unavailable adapters | Query absent tables and report empty success |

These recommendations settle implementation details rather than leave new business choices to the coding agent (basis: existing domain invariants, bounded cursor pagination, current caller authorization and optimistic concurrency).

## Confirmed choices

You chose a separate specification and selected all recommendations in the question rounds. You confirmed the reused model and requested an independent critique by another model. You approved the recommended navigation fix and confirmed the completed design content on 8 October 2026. Document checks passed after the edit. No application verification ran because implementation has not started. Design confirmation does not authorise coding or provisioning.

| Choices | Confirmed result |
|---|---|
| 1 | Separate 0007 extending existing specifications |
| 2 | Preparation and readable history/status; final operations stay in feature 10 |
| 3 and 4 | Current open assignments first, historical view, campaign/team/competition search and stage filter |
| 5 and 6 | Player name/reference search, active/withdrawn and own saved draft filters |
| 7 and 8 | Newest submission first, preview expansion, selected campaign/player history only |
| 9 | Own preparation submission count and latest submission time, without a quota or percentage |
| 10 | Existing domain model, own derived fields and temporary UI state, no new personal data or table |
| 11 and 12 | Keep filtered out selected player open, guarded roster links and full filtered Previous/Next |
| 13 and 14 | Observation date range, own frozen requirement count and current stage, full final completion later |

### Independent critique

An independent read only review by `gpt-6-astra` on 8 October 2026 found one material interaction gap. The original contract checked a Previous/Next target after Save, but did not require the same check for clean navigation, Discard or Leave during a pending action. The reviewer reported no other missing value sources or load bearing architecture decisions.

You approved its recommended fix. Every Previous/Next branch now requires a fresh permitted target that matches the captured filters, with cancellation when the originating query changes. Local Discard takes effect only after that check succeeds. The contract retains the existing pending controller and adds race scenarios for all branches. Main thread document checks passed after the edit. The independent reviewer did not run a second pass or any application checks.

## References

**Project sources**:

* [Scope feature 8](../../scope/scope.md), expanded coach workspace and Tracer Bullet GA delivery.
* [0001](../0001-architecture-environments/index.md), existing React, Supabase, Cloudflare and memory only sessions.
* [0002](../0002-fresh-data-model-access-rules/index.md), keys, draft/submission rules, current caller access, bounded reads and freeze.
* [0003](../0003-verification-harness-eval-contract/index.md), real local evidence, readiness profiles and actual device gates.
* [0004](../0004-coach-interface-foundation/index.md), visual source, routes, pending ownership, phase transitions and accessible navigation.
* [0005](../0005-first-real-coach-feedback-path/index.md), real preparation integration and minimal freeze storage.
* [0006](../0006-account-roster-operations/index.md), account access, membership restoration and production account boundary.

**Practices**:

* Bounded cursor pagination with explicit query identity.
* Current caller authorization for content, existence and aggregates.
* Optimistic concurrency and explicit reconciliation for mutations.

**External source reuse**:

The existing stack and references preference carry forward. No new provider or library decision needed current external research. The official sources already recorded in 0001 through 0006 remain available through those documents; they were not fetched again. No skill, MCP server or provider connection was installed.
