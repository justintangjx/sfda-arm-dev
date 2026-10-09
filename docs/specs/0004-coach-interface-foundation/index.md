# 0004. Coach interface foundation

**Date**: 2026-10-07
**Status**: In Progress

## Summary

Give coaches a fresh desktop workspace with their player roster beside a focused feedback form and history. Phones use the same flow as separate roster and player views. Voice proposes text for explicit coach review, while the accepted database rules govern every save and submission. This specification is design work and authorises no coding or provisioning.

## Requirements

**User stories**

* As a coach, you can choose a campaign and player, write or resume feedback, and understand what you can submit now.
* As a coach, you can review a voice proposal without losing your own edits or filing unapproved text.
* As a coach, you can use your own feedback history and corrections on a desktop or phone, including with a keyboard or screen reader.

**Acceptance criteria**

* **AC-1**: The design is fresh, desktop first, with warm neutral surfaces, dark text and restrained green accents. The visual values and component inventory below are the design source for implementation.
* **AC-2**: After coach login, show assigned campaigns, then the selected campaign's roster. Campaign, player reference, competition and stage stay explicit. Selection uses unique IDs, not display names. Every player displays a short reference.
* **AC-3**: Desktop shows the roster beside the selected player's workspace. Narrow layouts show the roster first, then the full player workspace with Back to roster. Reflow preserves all actions and avoids horizontal page scrolling.
* **AC-4**: Write feedback and History are tabs in the same player workspace. Changing tabs preserves the editor. History contains only the coach's own submitted records, with original and latest corrected content together by default.
* **AC-5**: The form has observations, optional strengths and development focus, and an observation date initially blank for new feedback. Submission requires observations and a valid date no later than today in Singapore. A saved incomplete draft may omit those fields, following 0002.
* **AC-6**: Saving a draft is explicit. An existing draft for the current context loads automatically with a saved label. Unsaved navigation offers Save draft and switch, Discard or Stay. Temporary state is in memory only; reload loses unsaved text and login.
* **AC-7**: Preparation submission is one explicit action. Final submission requires full review and confirmation. Success stays on the selected player, shows the committed result, clears the preparation editor for a new observation or replaces the final editor with read only submitted feedback.
* **AC-8**: Speak feedback is alongside the written form when voice is enabled and opens a panel above it. Proposals remain separate until the coach selects and applies fields. Existing edits remain visible. Applied fields retain voice provenance through subsequent edits and proposals; invalidation restores their prior manual baseline and keeps any permitted mixed text separate and nonfileable. Cancellation, stale context and provider failure never save or submit feedback automatically.
* **AC-9**: Stage, current account, assignment and obligation status determine available actions. Setup, competition pause and closed stages have no feedback writes. An editor keeps its original kind when a stage changes; starting the new phase is explicit and does not transfer old text. Former campaign coaches retain authorised reads. Completion shows only the caller's own obligations and counts, never another coach's feedback.
* **AC-10**: Loading, empty, unavailable, failure and offline states have clear text and recovery actions. Offline editing remains in memory while voice, saving and submission are disabled. No automatic offline submission queue exists.
* **AC-11**: Stale saves preserve local edits for reconciliation. Mutations use fixed request IDs and expected versions from 0002. An actor owned controller retains unresolved actions across route changes and exposes recovery. Editor inputs and proposal application are read only while a mutation is pending or unknown, and no competing write starts before reconciliation. Late results cannot populate another player's editor, overwrite newer edits or create a duplicate submission.
* **AC-12**: Logout, account disabling and identity changes clear private loaded data and voice state. Expired sessions hide work data and never transfer an old user's form to a new user. Permission failures cannot expose unrelated records.
* **AC-13**: The target is WCAG 2.2 AA. Keyboard navigation, focus, tabs, dialogs, labels, errors, contrast, resizing and screen reader announcements have explicit behaviour and verification. Automated results do not substitute for human accessibility evidence.
* **AC-14**: Foundation fixtures and live integrations remain distinct evidence under 0003. The build establishes reusable screens and contracts, with real login/data and live voice owned by their feature slices. No fixture, disabled voice control or visual state is presented as a verified live provider operation.

## Decision

**Chosen option**: A roster beside a player workspace on desktop, with sequential views on phones, built from React components and CSS Modules (basis: your layout choices, architecture 0001 and verified Vite support).

**Content review**: You confirmed the documented design on 7 October 2026, then explicitly approved applying all four independent review recommendations. UI-1 through UI-4 are resolved in the flows below. Status remains Proposed because the feature is unbuilt.

**Design completeness**: The four identified interaction gaps are closed. Implementation still needs separate authorisation, the approved scaffold and the owning feature integrations; this is not implementation or release evidence.

**Permission boundary**: Documents only. No scaffold, package installation, migration, live account, microphone capture, provider call or deployment is authorised.

This is a fresh design direction, rather than a visual copy of the reference demo. Use React Router's data router through `createBrowserRouter` and `RouterProvider` within the already selected library setup. It supports the required navigation blocker without adding another framework. Use native HTML controls and local accessible components. Tailwind and a component library are alternatives; you selected CSS Modules, and this feature adds neither. Use system fonts and a text wordmark, SFDA Coaches. No remote fonts, player portraits, stock imagery or invented official SFDA logo are required.

## Feature design

### Visual source and values

These values govern coach pages and their shared login surface. They are a small feature design system, not a new public marketing site. Keep CSS custom properties in `src/app/styles/tokens.css` and use `.module.css` for component styles. Actual files are created only during authorised implementation.

| Value | Definition and use |
|---|---|
| Page and surface | Page `#F7F6F2`, card/form surface `#FFFFFF` |
| Text | Main `#17231B`, secondary `#526257`; use text labels alongside status colours |
| Main action | Green `#166534` with white text; hover `#14532D` |
| Focus and danger | Focus `#1D4ED8`; error/danger `#B42318` with visible text |
| Borders | Control boundary `#7A877D`; decorative separator `#DADFD9` |
| Typography | Native system sans serif. Body and inputs 16 px, supporting text at least 14 px, headings 24 or 32 px. Line height at least 1.5 for body content. |
| Spacing and shape | 4, 8, 12, 16, 24, 32 and 48 px spacing values; 8 px corners; restrained borders rather than heavy shadows |
| Actions | At least 44 by 44 CSS px interaction area, visible 2 px focus outline with 2 px offset; no icon only critical actions |
| Width | Main container at most 1440 px. At 960 px and wider, roster width 280 px with 24 px gap and a flexible player workspace. Below 960 px, sequential views. |

Text and control contrast must be verified at implementation, including hover, focus, disabled and selected states. Disabled controls retain a readable reason outside the control. A desktop context header may remain sticky only while it does not obscure focused content; narrow or short viewports use normal document flow. Animations are limited to short state transitions and respect reduced motion.

### Screens, routes and composition

Routes are browser navigation, not new Worker API endpoints. UUID parameters identify existing entities. The `tab` query value is write or history, with write the default; invalid tab values use write. Never place text, names, emails, credentials or voice content in URL parameters. Page titles are generic, such as Player feedback | SFDA Coaches.

| Screen and route | Composition and actions |
|---|---|
| `/login` | Text wordmark, email/password form, show password control, Sign in, safe error/status region. No public registration. Password recovery and activation links appear only when the account feature provides working routes. Allow password manager autofill and paste. |
| `/coach` | Header with coach display name and Sign out; heading Your campaigns; paginated campaign list with name, team, competition, stage and current or historical access label. No global player metrics or cross coach dashboard. |
| `/coach/campaigns/:campaignId` | Campaign context and Back to campaigns; roster with display name, player reference, withdrawal and own final status when applicable. Desktop right pane prompts Choose a player. Narrow layout is the full roster page. |
| `/coach/campaigns/:campaignId/players/:playerId?tab=write` | Same campaign context; selected name/reference; stage/access banner; Write feedback and History tabs. Desktop retains roster. Narrow layout has Back to roster. The write panel holds optional voice panel, observation date, observations, strengths, development focus and actions. |
| Same player route with `tab=history` | Read only own submissions, latest first, with phase, observation date and submission time. Each correction shows original and latest full text/date together, with Admin label, reason and an action for ordered correction history. No submitted Edit action. |

Campaigns and roster use explicit Load more paging, 20 rows by default and at most 100 per request, using 0002's stable creation time/ID ordering. History pages use submission time/ID descending. Loading a later page preserves selection and focus. Initial foundation does not add search, sorting controls or virtual scrolling; the expanded workspace feature can design those separately. Short references use the first eight hexadecimal characters of the player UUID. If a collision occurs in loaded rows, expand those references to full UUIDs. References are display hints, never lookup keys.

Competition and informational dates do not unlock actions. Format observation dates as calendar dates, such as 7 Oct 2026, without converting their date to a UTC midnight. Format submitted instants using fixed Asia/Singapore, including SGT. Omit absent optional competition dates rather than fabricate dates or countdowns.

### Component inventory

| Component | Responsibility |
|---|---|
| `CoachShell`, `CampaignList`, `CampaignContext` | Shared header, navigation, stage/access context and campaign paging |
| `PlayerRoster`, `PlayerContext`, `PlayerWorkspace` | UUID selection, short references, responsive composition and stable context ownership |
| `FeedbackTabs`, `FeedbackEditor` | Accessible tabs, form fields, inline validation, explicit draft save and reviewed submission |
| `VoicePanel`, `ProposalReview` | Visible capture state and field comparison/application, through a future voice adapter |
| `FeedbackHistory`, `CorrectionHistory` | Original and corrected text, read only metadata and bounded history |
| `NavigationGuard`, `FinalReview`, `DraftConflict` | Safe dialog flows, with no automatic overwrite or background submission |
| `PendingActionController` | Actor owned mutation state above routed workspaces, outcome reconciliation and safe return to an affected editor |
| `AsyncState`, `StatusBanner`, `FieldError` | Consistent loading, empty, safe errors, offline status and assistive announcements |

### Temporary state model

Reuse the complete data model in 0002. There are no new database tables, profile fields or stored UI preferences.

| State | Required contents | Nullable or optional contents | Ownership and lifetime |
|---|---|---|---|
| Selected context | Actor ID, campaign ID, player ID once selected, currently permitted kind derived from stage, context generation | Player ID before selection or permitted kind during a paused stage | One current workspace. Route IDs are validated against authorised reads. |
| Editor | Original actor/campaign/player/kind, observations/strengths/focus text, form revision, dirty flag, baseline snapshot, current stage/access revision, per field provenance | Observation date, draft ID and expected version; nonfileable comparison after voice invalidation | One editor per current context. Kind is latched when opened, not recomputed on stage changes. Parent workspace retains it across tab changes. New date is null. |
| Voice proposal | Proposal ID, proposed text fields, originating context and version binding, review status | Selected fields before approval | Separate from editor. Applied fields retain their voice binding and previous manual values. No transcript or audio is retained. |
| Loaded records | Authorised campaign, membership, roster, feedback, correction and own completion snapshots, fetch generation | No record until loaded | Memory only and keyed by actor/context. Old fetches are aborted or ignored. |
| Pending action | Action, UUID mutation ID, immutable form/baseline snapshot and field provenance, original actor/campaign/player/kind, expected versions, started time, status, detached flag | Committed result until received; intended navigation target until abandoned | One actor owned controller above `RouterProvider`, outside routed workspaces. One unresolved mutation at a time. Retry keeps the same ID and snapshot. |

Editor status is empty, loading draft, clean draft, dirty, saving, submitting, conflict, outcome unknown or read only. Saved means confirmed committed by the data action, not merely sent. An unavailable committed draft receipt is not a current saved draft. The interface never stores feedback, tokens or proposal content in local storage, session storage, IndexedDB, cookies or a service worker cache.

### Resolved review decisions

You approved all four independent review recommendations. These are implementation rules, with detailed flows below and matching verification scenarios.

| ID | Approved rule | Affected criteria |
|---|---|---|
| UI-1 | Retain unresolved actions outside routed workspaces, reconcile using the same request ID and prevent competing writes until reconciliation | AC-6, AC-7, AC-11, AC-12 |
| UI-2 | Make editor inputs and proposal application read only while pending or unknown; unlock preserved input on confirmed failure and apply the stated result on confirmed success | AC-6, AC-7, AC-8, AC-11 |
| UI-3 | Latch the editor's original kind; retain permitted old manual text read only and explicitly discard/start the new phase without copying it | AC-5, AC-6, AC-9, AC-12 |
| UI-4 | Preserve field voice bindings through edits and proposals; invalidation restores the last baseline without an unfiled voice binding, with mixed text separate and nonfileable | AC-8, AC-9, AC-11, AC-12 |

### Editing, draft and submission flows

Selecting an editable player first looks up the one draft for actor, campaign, player and kind. Inputs wait for that lookup, so a late saved draft cannot overwrite new typing. Load the draft with its ID/version and Saved draft label. No draft starts the new blank form. Write and History share this parent state; entering History does not discard text. Context changes unmount it only after the navigation decision.

Show all three text fields, label the optional fields and place the date before observations. Observations accept at most 10,000 characters; strengths and focus at most 5,000 each. Use visible labels, helper text and remaining counts near limits. Blank optional text normalises to null. Present draft save as Save draft. It is available for changed incomplete feedback where writes are allowed, and passes the explicit reviewed form intent from 0002. There is no autosave.

Submit feedback in preparation validates the complete snapshot, then sends one explicit atomic submission. Review final assessment in the final stage opens a dialog showing the player/reference, campaign/team/competition, date and all text, with the permanent singular submission consequence. Confirm through Submit final assessment. The dialog's default focus is Cancel. Every feedback mutation freezes its snapshot, makes editor inputs read only and disables proposal application, new conversations and competing mutation controls while pending or unknown. Stop and Cancel remain available for an existing conversation. A confirmed failure restores the preserved form subject to current stage/access and any voice invalidation; success uses the committed result. Do not accept later typing into that frozen form.

Success announces Feedback submitted, stores the returned identity and offers View submitted feedback. Stay on the selected player. Preparation resets to a new blank form and blank date after confirmation. Final displays the returned read only assessment. Refresh history and own completion from authorised reads. Never increment campaign totals optimistically or claim campaign closure from one final submission.

### Pending mutation ownership

The controller sits above route lifetimes and is keyed by the authenticated actor. Save, discard and submit register their frozen action before dispatch. Route unmounting never drops that action or its result. Read requests can be aborted, but abandoning a page does not assert cancellation of a database mutation. The controller consumes responses for its actor/request ID independently of the route generation; stale callbacks never update another editor.

Leaving marks the action detached and abandons any Save draft and switch navigation target. Show a safe Work action pending or Outcome unknown banner with Return to feedback, using the retained IDs and fresh authorised context. A later result never forces navigation back. Other contexts remain readable, but new feedback mutations are disabled while the actor has an unresolved action. Returning to the affected context surfaces the frozen form read only and Check result using the same action/ID, without starting a new write.

Reconciliation checks the receipt plus current authorised state. A confirmed draft save loads its existing draft/version; a confirmed submission shows its immutable record and the appropriate current form. A deleted draft is unavailable, not Saved. A confirmed failure restores the frozen form only in its original context under current access and the phase and voice invalidation rules below. Receipt absence alone is not a confirmed failure while a request may still be in flight; keep Outcome unknown until a definitive result is available. Only after reconciliation may another mutation begin. No actor/context mismatch can display retained contents.

Logout, a different actor, disabling or session loss clears the controller, including request IDs, snapshots and results; a late response cannot recreate it. Session expiry may preserve only the permitted manual form described below, not the pending action or voice comparison. After memory loss, inspect current draft/history before a new intended write. Closing or reloading can still lose recovery IDs; no persistence or guaranteed recovery across those events is promised.

### Navigation and conflicts

Use the existing React Router library as a data router so `useBlocker` guards app navigation and browser back/forward within the app. On dirty context navigation, display Save draft and switch, Discard and Stay. Save succeeds before proceeding; failure stays with the editor. Discard clears the local unsaved form, not an existing persisted draft. Deleting a saved draft is a separate explicit Discard saved draft action with confirmation and 0002's versioned delete. Stay returns focus to the initiating control. Changing tabs requires no guard.

Guard sign out with the same save/discard/stay intent while the account is still authorised. Disable Save if current stage or permission no longer allows it, explain that reason and retain Discard/Stay where access permits. A context switch cancels a voice session and discards its proposal before loading the next player. During a pending mutation, navigation warns that the outcome is unresolved and offers Stay or Leave. Leave retains the controller action and abandons any automatic navigation intent. Signing out additionally warns that recovery state will be lost, then clears it without asserting cancellation of the database transaction.

Only attach `beforeunload` while dirty or an action is unresolved. It may request the browser's generic leave warning, not this custom save dialog, and is unreliable on some mobile exits. No unload handler silently saves. Losing a tab or reloading loses unsaved input and the memory only session, consistent with 0001.

A draft version conflict displays the local snapshot beside the latest authorised saved snapshot. Load saved draft explicitly discards local edits; Keep my edited version acknowledges the comparison and uses the latest expected version, but still requires a new explicit Save draft action. A race after reconciliation can fail again. Never merge automatically. If the saved row disappeared, do not recreate it until current stage and permission have been rechecked; an ending stage does not allow migration of the old draft into final feedback.

### Editor phase transitions

Latch the editor's original kind when it opens. Compare that kind with refreshed stage and eligibility before offering writes; never change its identity because the stage changed. When preparation ends, cancel voice and invalidate applied voice fields first. Retain permitted manual text read only, labelled Preparation text from an ended stage. Remove the saved label for a draft confirmed purged from the database. The remaining local text is not a saved draft or an editable final.

When final feedback becomes writable, offer Discard old text and start final assessment. Confirm discarding old local text, then load the final kind's own draft or a new blank editor/date. Never copy preparation text, draft identity or voice comparison into it. While paused or closed, offer only authorised history and local discard. An unresolved mutation must be reconciled before starting another phase.

If an assignment is removed within the same phase, retain permitted manual text read only. Restoring the existing assignment permits Resume editing only after refreshed eligibility for that original phase, player and obligation; invalidated voice text never resumes. If the phase has ended, use the explicit new phase transition instead. Whole account disabling clears all content.

### Stage and access presentation

| Authoritative state | Coach presentation |
|---|---|
| Setup | Preparation has not opened; roster and authorised history readable, write actions absent |
| Preparation | Active assignment and active player permit drafts and repeated submissions |
| Competition | Feedback paused during competition; history remains readable |
| Final feedback | Outstanding frozen obligation and active coach permit one final; withdrawn frozen players remain assessable; submitted or waived obligations show read only status |
| Closed | Campaign closed; history and corrections remain readable, no coach writes |
| Former campaign coach | Historical access label; no write or voice capture actions |
| Disabled account or missing profile | Clear work state and show safe access unavailable account status |

Show Your final assessments with submitted, waived and outstanding counts from `scope: self`, after freeze. Before freeze, show Final assessment list not set rather than a misleading zero complete count. A player without this coach's frozen obligation shows No final assessment required. Show withdrawal as roster status, without inventing participation or performance facts. Permanent waiver reason comes from that coach's own waiver record.

### Voice interaction boundary

If `voiceEnabled` is false, hide Speak feedback. When true and the current context permits writing, open an inline panel above the form. It shows the selected player/reference and phase, with Start conversation requiring an explicit gesture before any microphone request. No automatic recording on page load. Voice states are idle, requesting microphone, listening, assistant speaking, processing, proposal ready, cancelled or failed, each with visible text. Stop ends capture and awaits the proposal; Cancel ends the session, clears its temporary proposal and files nothing. The future voice specification owns actual session termination, provider transport and timeout limits.

Show proposed observations, strengths and focus separately from the current form. No proposal changes the observation date. Field selection starts empty. Applying selected fields is an explicit coach action after comparison, replacing only selected fields and preserving their prior baseline without an unfiled voice binding. It changes the editor's dirty state without saving. If the coach typed while the conversation ran, compare against the current form, not its old starting snapshot. Save and submit stay separate actions.

For each applied field, retain its last wholly manual value (or explicitly saved and reviewed draft baseline), applied proposal IDs and context bindings. Subsequent typing does not turn a voice derived field into manual content. Repeated proposal application preserves the original baseline and accumulates its unfiled bindings rather than using mixed text as a new manual baseline. Filing requires every retained binding to remain valid. Unselected fields and the date keep their existing provenance. These records are temporary UI metadata, not database columns.

Carry the caller, campaign/player/kind and campaign/profile/membership revisions from 0002's voice binding. Validate before delivering, applying and filing a proposal. A stage, account or membership revision change cancels the session and drops late output. For each field with an invalid binding, remove its mixed value from the fileable editor and restore its retained manual or already reviewed draft baseline. While the actor still has read access to that original context, show the displaced value separately as Voice text from a changed context, cannot be saved. That comparison is read only, has Dismiss and no Apply or Save action, and is cleared on context departure, starting a new phase or session/account loss. Other manual fields remain intact; their editability follows the phase/access rules. Do not file old voice content under a new phase or restored permission. Disabling the whole account clears everything.

Confirmed Save draft or submission files reviewed content through the existing data contract. Only that committed content becomes the new stored baseline and loses temporary unfiled voice provenance. Unknown outcomes retain the frozen snapshot and bindings for reconciliation, with no new filing intent. An invalidated frozen snapshot may only recover an already committed receipt; if no commit exists, do not replay stale voice content as a fresh write. Restoring permission alone never validates an old proposal.

Live voice filing requires the future voice/data adapter to honour that binding atomically at the database write boundary; a client check alone is insufficient. This foundation defines the UI contract and simulated states, not a new unverified provider endpoint or a shortcut around 0002. Until that adapter exists, live voice is unavailable and cannot be enabled through a UI property.

### Action and data contracts

The browser uses caller scoped reads and functions from 0002. The table names logical component actions; it does not create public HTTP endpoints. Actor identity and authorisation are verified by the existing backend contracts, never trusted from route state.

| Action | Inputs | Output/source | Access and material failures |
|---|---|---|---|
| `signIn` | Email, password | Supabase Auth and `get_my_access`; memory only session | Public login UI; invalid login, missing/disabled profile or noncoach role show safe status. Account activation/recovery belong to their feature. |
| `loadCampaigns` | Current actor, page cursor | Own `campaign_coaches`, campaigns and competition context | Enabled coach, including former memberships; unavailable reads reveal no unrelated existence |
| `loadPlayerWorkspace` | Campaign/player UUIDs, context generation | Campaign, own assignment, authorised player membership/display name, own obligation and current kind draft | Enabled current or former assigned coach; missing/inaccessible target is unavailable, not an arbitrary profile lookup |
| `loadHistory` | Same context, page cursor | Own submitted `feedback_entries` and their `feedback_corrections` | Same read scope; no other author input |
| `saveDraft` | Current context, reviewed content, mutation ID, draft ID/version when editing | `save_feedback_draft`, then confirmed receipt/reference and readback | Enabled active coach, writable stage; version, draft existence and permission failures preserved safely |
| `discardSavedDraft` | Draft ID, expected version, mutation ID | `discard_feedback_draft` | Author with current write permission; missing/version conflict requires refresh |
| `submitFeedback` | Context, full reviewed snapshot, mutation ID, optional consumed draft ID/version | `submit_feedback`, then authorised result/history | Active coach and valid current stage; final duplicate, waived obligation, future date and stale draft are rejected |
| `checkPendingResult` | Retained request ID and original actor/context | Own `mutation_receipts` read and current authorised result/draft/history; valid retries reuse the frozen action | Current caller and read scope under 0002; no write replay for an invalid voice binding, and absent receipt alone is not proof of rollback |
| `loadOwnCompletion` | Campaign UUID | `get_campaign_completion`, own obligations/waivers; require self scope | Current or former enabled coach; no global completion inference |
| `voiceSession` | Explicit gesture, current binding and permitted environment | Future voice adapter's state/proposal, with validation contract above | Enabled writable context; unavailable adapter, microphone denial, stale binding or provider error leaves manual path |
| `signOut` | Approved local navigation decision | Supabase sign out plus local context/cache/capture clear | Current session; no feedback save during cleanup |

Dates and lengths use 0002's validation rules; Singapore today is a UI convenience derived from the current instant and fixed Asia/Singapore zone, with the database authoritative at write time. Do not infer saved state from a date picker or client clock. Read callbacks carry actor/context generation and ignore aborted or old generation results. Mutation outcomes reach the actor owned controller by request ID even after route departure; only a matching authorised editor may render them. Inputs remain read only until reconciliation, so a reply cannot erase subsequent typing.

### Async, error and offline states

Initial loading shows the context being requested and noninteractive placeholders, not another player's old text. Empty campaign lists say No campaigns assigned, contact your admin. Empty rosters say No players in this campaign. Empty history says No submitted feedback yet. Missing or inaccessible routes show This workspace is unavailable with Back to campaigns. Request failures offer Retry; failed later pages retain already authorised rows and do not duplicate them on retry.

Offline detection combines browser connectivity hints with actual request failures. Show Offline, unsaved edits remain in this tab. Disable voice, save and submit while known offline; typed manual edits remain allowed except when a mutation is pending or unknown, or the original phase/access is read only. Returning online refreshes access/context and offers explicit retry, never queued submission. A provider failure can occur while the database remains reachable, so it affects voice only and leaves permitted manual writes available.

Use safe error codes and request IDs. Map 0002's transient retries to at most two repeats, 250 ms and 500 ms, with identical mutation ID and frozen snapshot. Do not retry permission, validation or stage conflicts. A lost response becomes outcome unknown, with Check result inspecting the caller scoped receipt and current state before any permitted replay of the same action/ID. An invalid voice binding permits receipt recovery only, never replay that could create a write. It never starts a new observation merely because a response was lost. Reload loses that pending ID; coach must inspect current draft/history before manually starting another intended write. Submitted final uniqueness remains a database invariant.

Stage change follows the latched phase transition rules and cancels capture/proposals. A draft purged by stage transition is shown as unavailable once verified; do not announce Draft saved from a replay whose committed row no longer exists. Permission or account errors trigger fresh safe account/context checks. An expired session hides loaded work and may hold only manual form values temporarily outside the rendered work UI, after restoring baselines for voice derived fields. Restore them only after the same actor signs in, still has access, and the original phase/context remains valid. Clear pending actions and voice comparisons on session loss; inspect current draft/history before another mutation. A different actor or disabled account clears all work state.

### Accessibility contract

Use semantic headings, landmarks, lists, labels and buttons. Provide Skip to main content. Label the roster navigation and expose the selected player with `aria-current`. Moving to a new player focuses its heading after load; returning to the roster restores focus to that player's link if it is loaded. A tab switch follows the WAI pattern with one active tab stop, arrow navigation, Home/End and Enter/Space activation. Manual tab activation avoids loading or replacing content just from arrow movement.

Dialogs have an accessible name, focus inside, keyboard containment, Escape to dismiss the decision without discarding edits, and focus return to the invoker. Initial focus is the safe Cancel/Stay action for final submission and destructive decisions. During an unresolved mutation, closing a dialog does not claim to cancel the transaction; preserve its context bound pending status. Use native dialog behaviour where appropriate, with explicit testing rather than assuming it satisfies every requirement.

Fields use persistent labels, required indicators, `aria-invalid` and associated error text. On invalid submit, show an error summary and focus it, with links to the fields. Submission/save results and loading updates use polite status announcements; urgent access failure uses an alert. Do not announce every keystroke or elapsed recording second. Stop/Cancel remain reachable by keyboard during capture. No status depends only on colour, sound or animation.

Verify readable text at 200% resize, reflow at 320 CSS px and 400% browser zoom, visible focus not hidden by headers, contrast, keyboard navigation, reduced motion and an actual screen reader. This is the target and verification contract, not a certification. The 0003 browser matrix covers Chromium/WebKit desktop and mobile layouts; actual assistive technology and device results remain human evidence.

### Security, preview and configuration

Reuse 0001's configuration response, origin checks, memory only Auth, no cache policy and provider secrets boundary. No new environment variable or secret is introduced by this UI feature. No browser or shared module imports Worker secrets. Render feedback as plain text with line breaks, never executable HTML or unsanitized Markdown. Treat route IDs and provider content as untrusted input. No telemetry or log records feedback, player names, email, passwords, transcripts or raw URLs.

Work data requires the current enabled coach profile and campaign read scope. Admin/player accounts cannot enter coach work views. UI gates communicate permissions; actual policies and atomic functions enforce them. Clear memory on identity changes, and never reuse caches across actors. Recheck access on focus/reconnect, before filing text and on permission errors. During an active voice session, the future adapter supplies current binding validation and invalidation; the UI cannot invent current permission from a stale snapshot.

Public preview uses synthetic fixtures and a visible Preview: sample data banner, with Changes are temporary. Voice stays hidden under preview's false flag, and no microphone or privileged provider/data operation occurs. Isolated local UI tests may inject simulated voice states, clearly classified as fixture evidence. There is no production fallback to fixtures if keys or integrations fail. Real login/read/write evidence belongs to the first real feedback path; live voice evidence belongs to the voice feature.

### Value sourcing

| Displayed or computed value | Named source |
|---|---|
| Visual values and assets | This specification's token table, system fonts and text wordmark |
| Coach name and permitted role | Own Auth identity and `get_my_access` under 0001/0002 |
| Campaign/team/competition/stage | Authorised campaign and competition rows |
| Current/historical assignment and player withdrawal | Own coach membership and campaign player membership `is_active` |
| Player name/reference | Allowed profile display name and player UUID; reference is its defined display prefix |
| Feedback kind | Latched editor kind, compared with refreshed stage for write eligibility; stored entry kind for history |
| Draft contents/version and saved label | Author's stage specific draft and confirmed mutation/readback, never unsent form state |
| Form text/date and dirty flag | Coach input, saved baseline and explicit selected proposal fields; new date begins null |
| Singapore today and display times | Fixed zone plus current instant for hints; database date/time rules for saved content |
| Original/latest correction and attribution | Original entry, latest revision and ordered corrections; fixed Admin label |
| Own final counts/status/waiver reason | Self scoped completion result and own frozen obligations/waivers |
| Proposal fields and validity | Future adapter output and 0002 context binding, per field manual or reviewed draft baseline, proposal IDs and accumulated unfiled bindings |
| Nonfileable voice comparison | Displaced mixed field value on binding invalidation, held only in its authorised original context |
| Pending request/result and retry | UUID generator, actor owned controller above routes, immutable action/baseline snapshot, database receipt and safe codes |
| Context generation and revision checks | Incremented parent context generation, actor identity, form and backend revisions |
| Voice visibility/preview mode | Validated `/api/config` environment and `voiceEnabled`; preview always false |
| Offline, busy and safe recovery state | Connectivity hints, actual request outcome and context bound pending action |

### Critical test scenarios

| Scenario | Required verification |
|---|---|
| First screen thread | Login/coach status, campaigns, roster, player editor and history render with explicit synthetic context and defined visual values. AC-1, AC-2, AC-14. |
| Responsive navigation | Desktop split and narrow sequential views, browser back, retained tab editor, long names and collision references. AC-2, AC-3, AC-4, AC-6. |
| Inputs and submission | Blank new date, incomplete draft, future date, lengths, preparation one action, final review/cancel/confirm, retained player and correct post submit form. AC-5, AC-6, AC-7. |
| Navigation protection | Dirty player/campaign changes, save success/failure, local discard versus persisted delete, sign out, generic reload warning limitations. AC-6, AC-11, AC-12. |
| Pending ownership and input lock | Start save/submit, attempt typing/application, leave before response, receive commit or lost response on another route, return and reconcile with the same ID. No newer text is erased, competing write starts or old navigation target fires. Repeat with failure, sign out and another actor. UI-1, UI-2; AC-6, AC-7, AC-8, AC-11, AC-12. |
| Original phase and restoration | End preparation with local text, then open final while the same player remains selected. Old manual text is read only; explicit discard/start loads only final draft or blank values. Remove/restore assignment within and across phases; unresolved actions block transition. UI-3; AC-5, AC-6, AC-9, AC-12. |
| Voice provenance | Apply a field, edit it, apply another proposal, then invalidate any retained binding. Restore the original baseline and show permitted mixed text only as nonfileable comparison. Check unchanged manual fields, saved reviewed baseline, unknown outcome recovery and comparison clearing on session loss. UI-4; AC-8, AC-9, AC-11, AC-12. |
| Voice comparison | Typed edits during conversation, no field selected by default, explicit apply without save, unchanged date, context change/cancel, hidden disabled voice and manual fallback. AC-5, AC-8, AC-10, AC-14. |
| Read scope and phases | Current/former/disabled coach, other roles, paused/closed stages, withdrawn frozen player, singular final, own waived/outstanding counts and no other coach content. Real evidence requires 0002. AC-4, AC-9, AC-12, AC-14. |
| Corrections | Original and latest text/date together, Admin attribution, reason and ordered history after closure. AC-4, AC-9. |
| Error and async handling | Empty data, failed paging, offline edits, provider outage independent of DB, old player response, stale versions, lost response and unavailable draft receipt. AC-10, AC-11. |
| Identity loss | Old form hidden during expiry, same actor restoration only with valid context, different actor clears state, disabled account clears caches and voice. AC-8, AC-11, AC-12. |
| Accessibility | Keyboard tab/dialog/focus patterns, field errors, screen reader status, contrast, 200% text and 400% reflow without obstruction. AC-3, AC-13. |
| Honest evidence | Preview cannot invoke live Auth/voice/data or retain real records; fixture status never satisfies database, device or live voice gates. AC-8, AC-12, AC-14. |

## Build plan

These are future tasks after a separately authorised scaffold. The Tracer Bullet starts with one complete screen thread and then hardens its interactions. Fixtures prove UI surfaces only, while later real feedback and provider slices connect the approved data boundaries. There is no database migration in this feature.

Implement resolved UI-1 through UI-4 as specified, including their dedicated verification scenarios. No interaction decision from that review remains delegated to a coding agent.

1. Add the coach tokens, core semantic components and data router. Define context typed read/action interfaces and one synthetic campaign/player/editor/history thread, with clear fixture evidence. Satisfies AC-1, AC-2, AC-4, AC-14.
2. Build campaign paging, desktop roster/workspace and narrow sequential routes, player references and shared context state. Add loading/empty/unavailable states and tab focus behaviour. Satisfies AC-2, AC-3, AC-4, AC-9, AC-10, AC-13.
3. Build controlled editor validation, automatic draft resume, explicit draft save, preparation submission, final review and read only success/history projections. Keep all identity and backend contracts aligned with 0002. Satisfies AC-4, AC-5, AC-6, AC-7, AC-9, AC-11.
4. Add dirty navigation, persisted draft discard, conflict reconciliation, the actor owned pending controller, input locks, latched phase transitions, actor isolation and safe offline/expiry transitions. Verify departure, return, lost and late responses with controlled fixtures under UI-1, UI-2 and UI-3. Satisfies AC-5, AC-6, AC-7, AC-9, AC-10, AC-11, AC-12, AC-13.
5. Build the voice panel/proposal review component contract and isolated simulated states. Implement UI-4 per field provenance, baseline restoration and nonfileable comparison; enforce UI-2 application locks. Hide disabled/preview voice and keep live provider work unavailable until its feature adapter is approved. Satisfies AC-5, AC-8, AC-9, AC-10, AC-11, AC-12, AC-14.
6. Run the scenario matrix through Vitest and Playwright in the 0003 browser profiles, record actual human accessibility evidence, obtain independent GA review and document the interface contract and remaining live gates. Do not count fixture tests as permission/provider proof. Satisfies AC-1 through AC-14.

## Consequences

You get a clear desktop workflow and a usable phone path without a second interface or another styling dependency. The chosen visual values keep implementation consistent, and explicit context/proposal controls reduce accidental filing under the wrong player.

The work includes real interaction complexity: navigation blocking, pending outcomes, conflicts and accessible focus need careful tests. Editing pauses until an unresolved mutation is reconciled, even after navigation. Starting a new phase discards the prior local form explicitly. Voice invalidation restores its last manual or filed baseline; subsequent mixed edits remain comparison only and cannot be silently reused. Final confirmation adds a deliberate step. Phone users switch views to return to the roster. Memory only sessions and unsaved forms can be lost when a browser closes, and no navigation warning can guarantee recovery on every device.

Native controls reduce dependencies but still require accessibility verification. Foundation screens and simulations do not make the app ready for real feedback or voice. Atomic voice context validation, account recovery and actual provider/device behaviour need their owning feature designs before live use.

## Follow-up

* [ ] First real feedback path must connect these interfaces to actual memory only Auth, caller scoped reads and atomic functions, with local database evidence under 0002/0003.
* [ ] Expanded workspace owns search and richer roster navigation; no unpaginated whole roster fetch or client only count is implied here.
* [ ] Account operations owns activation, recovery, authorised production account surfaces and verified role routing beyond the coach UI.
* [ ] Voice design must settle its actual transport/endpoints, microphone/device behaviour, timeouts, atomic binding validation and retention evidence before live enablement. Reuse the comparison and cancellation contract here.
* [ ] Final feedback and pilot features connect real obligation completion, production smoke, devices and policy evidence. Visual states do not waive those gates.
* [ ] No new stack tool is selected. Previously deferred skills and MCP connections remain optional and are not installed, searched or connected by this design.
* [ ] After authorised implementation, capture real commands and component ownership in agent context. This design does not edit `AGENTS.md` or `CLAUDE.md`.

## Rationale

Reasoning, alternatives and source verification notes are in [rationale.md](rationale.md).
