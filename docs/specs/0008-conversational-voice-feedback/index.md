# 0008. Conversational voice feedback

**Date**: 2026-10-08
**Status**: In Progress

## Summary

Let you speak freely about the selected player during preparation, then answer focused questions about unclear observations. ElevenLabs prepares supported text for your review in the existing form. A short call, private session context and explicit filing keep voice useful without giving the assistant authority to save feedback. Real voice stays disabled until provider, device, privacy and quality evidence passes.

## Requirements

**User stories**

* As a coach, you can describe an observation and clarify it through conversation without filling every section aloud.
* As a coach, you can compare a proposal with your current form, apply selected fields and explicitly save or submit reviewed feedback.
* As a pilot owner, you can bound usage, investigate safe session metadata and see which real voice evidence remains missing.

**Acceptance criteria**

* **AC-1**: Voice is available only in an authorised preparation editor, with live voice configuration enabled. Start requires a gesture and the disclosure on every call. Preview, paused stages, final editors, disabled accounts and unassigned contexts cannot start voice. Final voice belongs to feature 10.
* **AC-2**: The English agent accepts free speech, asks focused questions for concrete examples and preserves stated facts, negation, corrections and uncertainty. Missing observations, strengths or development focus remain absent. It invents no player observations, ratings or selection decisions.
* **AC-3**: The app sends only a neutral player label and preparation phase as conversational context. It sends no stored name, email, history, form text or application identity IDs. Speech may itself contain identifying details. Actual actor, campaign, competition, player and revision binding remains at the application boundary.
* **AC-4**: Finish and review requests a structured proposal while connected, waits at most twenty seconds within the five minute call cap, then ends the connection. Cancel, backgrounding, context departure or invalidation stops capture and drops unfinished output. Late or mismatched output cannot enter an editor. Ending without a proposal is a valid outcome with manual entry available.
* **AC-5**: The Worker validates allowed proposal fields and the current session binding before returning a proposal for review. Fields start unselected. Applying replaces only selected fields after comparison with the current form, preserves manual baselines and does not alter the observation date or file feedback.
* **AC-6**: Applied fields retain every unfiled voice binding through edits and repeated proposals, as in 0004. Saving and submission validate those bindings atomically with the feedback write. Stage or access revision changes invalidate old voice even after restoration. Receipt recovery can recover an existing commit, but cannot create a new write from invalid voice text.
* **AC-7**: One coach has at most one outstanding authorised provider session across tabs and devices. Start requests are idempotent (repeating the same request does not create another call). Setup uncertainty, credential replay and uncertain provider closure cannot bypass that restriction.
* **AC-8**: Each call has a provider enforced maximum of 300 seconds. The app warns with thirty seconds remaining and ends at the cap. It reserves at most twenty starts per coach and one hundred across SFDA per Singapore calendar day. A reservation consumes allowance even if setup fails. These are usage bounds, not a guaranteed currency spending cap.
* **AC-9**: Stored voice data contains only identifiers, context revisions, configuration identity, timing, status and safe failure details. It contains no audio, transcript, credentials or proposed text. Ended session metadata is deleted automatically after thirty days. The app holds proposals and private temporary state only in memory.
* **AC-10**: Microphone denial, unsupported capture, startup failure, empty speech, malformed output, provider failure and offline conditions preserve the manual path. A complete validated proposal delivered before a connection failure remains reviewable only while its binding is valid. No failed call reconstructs content or starts a paid replacement automatically.
* **AC-11**: The pilot is restricted to adults, with SFDA approval of eligibility, permissions and actual global processing arrangements before real use. Audio saving is off and text retention is zero days, with current configuration and observed deletion evidence. The interface makes no claim of immediate deletion or Enterprise Zero Retention Mode.
* **AC-12**: Sessions use the official React SDK and private WebRTC credentials issued by the Worker. Provider keys stay server side. Each execution is bound to a pinned immutable agent version and reviewed configuration fingerprint, including shared privacy and duration settings. Missing or changed configuration identity blocks live start and readiness.
* **AC-13**: The existing ten text cases and twenty speech cases are reviewed under 0003. Speech has one clean and one noisy version of every text scenario. Every essential fact passes, at least eighteen of twenty speech cases score at least 4 from both reviewers, and any invented observation, mixed player or approval bypass blocks readiness. Every attempt remains visible.
* **AC-14**: Real Auth, database, Worker and browser tests prove permission, quota, concurrency, cancellation, atomic filing and retention boundaries. Provider evidence proves actual version identity, microphone behaviour, speech quality and privacy. Actual iOS Safari and Android Chrome checks, accessibility review and fresh human evidence are required. Fixture results cannot substitute for live evidence.

## Decision

**Chosen option**: The official `@elevenlabs/react` SDK with private WebRTC sessions, a blocking browser client tool for proposal delivery, Worker validation and caller authenticated atomic feedback functions (basis: 0001, 0002, 0004, your integration choices and the verified ElevenLabs React, client tool and token documentation).

**Content review**: You confirmed the revised assembled specification on 8 October 2026 after an independent model identified six session contract gaps and you authorised their recommended fixes. Those resolutions are recorded below and in the verification plan. Document checks passed. Implementation remains unstarted and requires separate authorisation. Feature status stays Proposed until implementation advances it.

**Permission boundary**: Design documents only. This does not authorise scaffold creation, dependency or skill installation, migrations, account setup, microphone use, paid provider calls or deployment.

**Implementation skills**: No community skill is installed or applied. You chose to record the discovered skills and MCP connections for later.

Use the supplied standard English voice and the provider's managed default language model during authorised setup. Record their exact identities and settings before creating the reviewed agent version. Subsequent default changes do not alter that version. A manually selected voice or model is the alternative and needs another reviewed configuration and fresh relevant evidence.

Use native Worker Fetch requests for the small provider control surface and Supabase functions for authoritative session and write checks. A custom audio transport and a separate voice backend are the alternatives. This feature adds neither, nor a knowledge base, raw audio store, transcript archive or provider write tool.

## Feature design

### Scope and prerequisites

This is scope feature 9, preparation only. Reuse 0001's browser and Worker modules, 0002's assignments and feedback model, 0003's harness, 0004's visual and editor contracts and 0007's workspace navigation. Those are approved designs, not built prerequisites in this repository. The earlier authorised scaffold, real preparation path and agent context must exist before implementation here.

Use the existing `VoicePanel` and `ProposalReview` above the editor. This feature supplies their live adapter and more precise finish behaviour. Keep the current player name and reference visible in the app. The agent receives the literal label `selected player`, not that name or reference. No final editor or final capability is activated by this slice.

### Stored and temporary data

Add one table, `voice_sessions`. UUIDs are generated unique identifiers. Times use `timestamptz` and database time. Foreign keys preserve the campaign and permanent pairing relationship from 0002, with restrictive deletion.

| Fields | Type and requirement | Source and rule |
|---|---|---|
| `id`, `start_request_id` | Required UUIDs | Database ID; browser request ID generated before dispatch. Unique `(coach_id, start_request_id)` |
| `coach_id`, `campaign_id`, `competition_id`, `player_id`, `kind` | Required UUIDs and kind enum | Verified caller and existing authorised permanent pairing. Kind is constrained to preparation |
| `campaign_version`, `caller_version`, `coach_membership_version`, `player_membership_version` | Required positive integers | Authoritative rows captured together at reservation, not browser selected revisions |
| `config_fingerprint`, `agent_version_id`, `authorisation_kind`, `authorisation_evidence_id`, `authorisation_until` | Nullable text, enum and instant until claim, required thereafter | Trusted Worker manifest and verified production activation or local verification record with its expiry. The reservation caller cannot select these values |
| `status`, `version` | Required state enum and positive integer | Session transition functions. Each metadata change increments version |
| `created_at`, `updated_at`, `reservation_until` | Required instants | Database reservation time; reservation expires thirty seconds later if no dispatch was armed |
| `dispatch_id`, `dispatch_authorised_at`, `dispatch_until`, `dispatch_started_at` | Nullable UUID and instants, immutable when set | Database generated single dispatch identity, ten second authorisation window and committed dispatch intent. A started dispatch is never reclaimed or repeated |
| `hold_until`, `credential_valid_until` | Nullable instants | Proven absolute last redemption and call bound. Null after an uncertain dispatch means reconciliation only, never immediate expiry |
| `local_outcome`, `provider_state` | Required enums | Local outcome starts open; provider state starts not_issued. Independent transitions below preserve cancellation during remote uncertainty |
| `local_ended_at`, `proposal_revoked_at`, `provider_terminal_at` | Nullable instants | First local ending, irreversible cancellation or binding revocation, and authenticated provider terminal observation |
| `provider_conversation_id`, `proposal_id`, `proposal_accepted_at`, `identity_verified_at`, `connected_at`, `finish_requested_at`, `ended_at` | Nullable text reference, proposal UUID and instants | Token response, accepted proposal metadata, mandatory observed execution identity, server recorded connection/finish events and safe closure. No token or proposal text is stored |
| `duration_seconds`, `failure_code` | Nullable nonnegative integer and allowlisted code | Verified timing where available; unknown duration stays null. Failure code never contains provider response text |

Required foreign keys reference the coach profile, campaign competition and matching `competition_pairings` record. Historical session metadata is owned by its coach. An enabled admin may inspect metadata for troubleshooting, without conversation content. Browser callers cannot directly insert, update or delete session rows.

Statuses are `reserved`, `authorising`, `active`, `finishing`, `proposal_ready`, `completed`, `cancelled`, `failed`, `expired` and `uncertain`. A partial unique index permits one outstanding row per coach in reserved, authorising, active, finishing, proposal ready or uncertain. Only safe closure permits a terminal status outside that index. Keep uncertain closure in `uncertain`, including a locally ended call whose credential may still be usable. Proposed text remains temporary browser state.

`local_outcome` is `open`, `finished`, `failed`, `timed_out` or `cancelled`. The first local ending fixes its outcome and `local_ended_at`, except cancellation may supersede another outcome and always sets `proposal_revoked_at`. Binding or execution identity failure also sets that irreversible revocation instant. `provider_state` is `not_issued`, `unknown`, `live` or `terminal`; remote reconciliation changes only remote state and safe closure, never clears revocation or restores a proposal.

`authorisation_kind` is `production_activation` or `local_verification`. For an abandoned open controller, an accepted proposal yields local outcome finished; otherwise expiration yields timed_out. After safe closure, finished maps to completed, cancelled to cancelled, failed to failed and timed_out to expired. Status describes lifecycle, not filing authority; the independent acceptance, identity and revocation fields decide proposal eligibility.

Index `(coach_id, created_at)`, `created_at`, outstanding coach rows and terminal `ended_at`. Quota counts are derived from reservations whose creation time falls in the database's current Singapore day. Serialize reservation count and insert with one transaction lock shared by all SFDA starts. Existing reservations remain for at least thirty days, so daily counting does not lose records. Failed reservation transactions consume no allowance and issue no credential.

An hourly Worker scheduled trigger reconciles every outstanding status, in bounded pages, without requiring another browser request. Unarmed reservations or claims expire at their reservation or dispatch deadline with proof that no provider request was permitted. Started authorisations, active calls, finishing calls, proposal ready rows and uncertain rows use the closure rules below. An expired finish window closes unfinished delivery; it does not erase an already accepted valid proposal. A proven absolute hold deadline permits conservative closure. A null hold deadline retains the restriction and raises a safe operational alert until positive reconciliation establishes closure.

Set `ended_at` to database time when safe closure is recorded, including conservative expiry, and never backdate it from an untrusted browser event. Then delete terminal rows with `ended_at` at least thirty days old. Scheduled functions accept no browser credential. Failure raises a safe operational error and retries on the next scheduled run. Do not copy these rows into permanent audits, receipts or logs with a different retention period. Feedback mutation receipts retain their existing rules and contain no voice content.

| Temporary state | Contents and lifetime |
|---|---|
| Voice controller | Current session and provider IDs, context generation, operation state, credential during connection setup, timing and cancellation marker. Actor owned memory, cleared on session loss or departure |
| Proposal | Browser generated UUID, session reference, normalised nullable text fields and authoritative captured binding. No date, rating, author or target fields. Cleared under 0004's review and invalidation rules |
| Editor provenance | Per field manual or filed baseline, proposal IDs and all unfiled session bindings. Reuse 0004; typing never removes a binding |
| Accessible live text | Current exchange text needed to follow the conversation. Replace it as turns advance and clear it at call end. No transcript history or persistent caption log |

### Agent and proposal contract

Enable provider agent versioning and pin the exact immutable version in token issuance. The reviewed configuration contains the standard voice ID, exact language model and settings, English language, prompt, tool schema, 300 second duration, disabled audio saving, zero day retention and global processing profile. Privacy and call limits are shared settings rather than frozen version contents, so inspect those separately for drift.

The prompt asks for concrete examples when an observation is vague, clarifies rather than guesses and preserves uncertainty. It may leave every unsupported section empty. It never uses prior feedback, invents ratings or follows speech that changes application context or bypasses review. If speech concerns another player, ask the coach to return to the selected player or switch explicitly in the app. It cannot resolve another person's identity or fetch records.

Configure one blocking client tool named `prepare_feedback_proposal`. Its only parameters are optional strings `observations`, `strengths` and `development_focus`. The app normalises absent or blank fields to null. Reject unknown properties, wrong types, prohibited fields and limits above 10,000, 5,000 and 5,000 Unicode characters respectively. Do not silently truncate. If all fields are null, return no proposal and preserve the form.

Disable runtime prompt, voice, language model and tool overrides. The only app supplied conversational variables are the prescribed neutral label and phase. No knowledge base or external retrieval tool is configured.

The browser handler accepts a tool call only for its active Finish and review operation and matching controller generation. It creates the proposal UUID, submits the fields to Worker validation and keeps the returned proposal in memory. Tool output only acknowledges preparation or a safe validation failure to the agent. It never calls draft save, submission, a stage action or an admin operation.

### Capture and finish lifecycle

Start shows this disclosure beside its action: “Your speech is sent to ElevenLabs to prepare a draft. Audio saving is off. Conversation text is scheduled for deletion. Start only if you are authorised to share these observations.” The exact approved notice version is part of the configuration fingerprint. Clicking Start acknowledges it for that call. It is not a claim that SFDA's underlying permission process has been completed.

Require current enabled coach access, active preparation memberships, no unresolved feedback mutation and live prerequisites. Request microphone permission from the gesture before dispatching the paid start path. If permission is denied, stop without a reservation. On a permitted start, freeze request identity and context, reserve the session, verify provider configuration, claim and arm the single dispatch under the checks below, then obtain a private WebRTC token with pinned `version_id`. Use the provider returned conversation ID, require the SDK connected ID to match and perform the mandatory execution identity check. Release any microphone stream used for permission probing; never leave two capture streams.

The start response uses `Cache-Control: no-store`. The token exists only in request and browser memory, never a database field, URL, log or storage entry. A repeated start request returns the existing metadata, without minting another token. If the original credential response was lost, show setup outcome unknown and reconcile that session; never reissue a credential as a retry. Provider requests that may have created a session receive no automatic retry.

Allow up to thirty seconds for local connection setup. The reviewed compatibility record supplies `dispatch_to_issuance_bound_seconds` and `credential_redemption_bound_seconds`. The first bound covers the latest possible provider issuance after the final dispatch authorisation, including delayed dispatch and uncertain request completion. The second covers last redemption or replay after issuance. Their source must be an authenticated provider contract or a verifiable credential rule with explicit semantics, supported by synthetic exercises. A client timeout or a few successful experiments cannot establish an upper bound.

Before arming dispatch, set `hold_until = dispatch_until + dispatch_to_issuance_bound_seconds + credential_redemption_bound_seconds + 300 seconds + 30 seconds`. A verified absolute credential expiry may tighten it only when the contract proves it limits every redemption or replay. Ordinary application starts require both finite bounds and reviewed replay behaviour. An unexpected response or uncertainty outside that contract makes `hold_until` null and requires positive reconciliation. Never release such a row merely because ten seconds, five minutes or thirty days have elapsed. Initial compatibility probes use the separate trusted path below; they do not waive this rule for application sessions.

While connected, show listening or assistant speaking and retain reachable Finish and review and Cancel actions. Manual editor input remains available unless a feedback mutation is pending. An active conversation prevents new feedback filing until it is finished or cancelled; it does not overwrite local typing. Warn once at thirty seconds remaining, using connected time for the display and provider configuration for the actual cap.

Finish and review stops coach audio input, enters processing and sends a fixed `sendUserMessage` request for the client tool. The documented React input control is `setMuted(true)` through the input hook. Muting is not proof of microphone release: the pinned SDK integration must prove actual capture stops while the proposal can still return. If that cannot be established, end the call immediately, return no unfinished proposal and keep voice activation blocked until the contract is resolved. Do not label a still capturing microphone as stopped.

The finish deadline is the earlier of twenty seconds and the remaining call time. A validated proposal is retained, then `endSession()` releases the connection and all owned media tracks. At timeout, empty output, invalid tool output or the hard cap, end without inventing a proposal. No post call transcript retrieval generates text. Keep the form and allow another explicit Start once the prior provider session is reconciled.

Cancel, `visibilitychange` to hidden, `pagehide`, context departure, logout, session expiry, account disabling or detected binding change immediately closes local capture, abandons finish and ignores late callbacks. No unload action saves feedback. Best effort cancellation records metadata when possible; page exit cannot promise delivery. Returning to the page refreshes current access and reconciles the existing session before another start. Backgrounding does not resume capture automatically.

### Provider closure and compatibility

A browser disconnected callback is a local event, not independent proof of provider termination. The Worker reads the named conversation's status and actual agent version using its own provider credential. This read is mandatory at `/connected`, and is also used for closure reconciliation. That response can contain content; hold it only for the request, project allowed status and identity fields, and discard everything else. Never log, persist, return or use transcript or analysis text as a proposal. This is a metadata probe, not the draft delivery path.

The Worker must observe the exact issued conversation ID, reviewed agent ID and expected immutable agent version before marking the session active. Record `identity_verified_at` only after that match. A missing, inaccessible or mismatched identity ends local capture, revokes proposal eligibility and keeps manual entry available. There is no inference from the requested version or browser supplied ID. The compatibility gate must establish that this observation is available during connection on the pinned provider contract. Zero day deletion before observation is missing identity, not an exception. Proposal acceptance and filing require this recorded successful check even if the provider later deletes its record.

Safe closure requires either the proven absolute hold deadline or positive proof that the provider session is terminal and its credential can no longer create or reconnect a call. Terminal status alone is sufficient only when the reviewed replay contract proves the credential was consumed irreversibly. Otherwise hold the restriction until credential exhaustion as well. A missing conversation, failed probe or unrecognised status remains uncertain; a 404 under retention is not automatically proof of termination. End, cancel and background actions close pending delivery immediately even while the server holds the restriction. A proposal delivered and validated before a transport failure can still be reviewed in its original valid context.

Before activation, real synthetic checks must establish dispatch/issuance and credential redemption bounds, token replay behaviour, private agent access, actual execution identity at connection, terminal status semantics, microphone release and maximum duration. The provider control adapter implements these reads with native Fetch and the pinned API contract. Unexpected or missing fields fail closed. The docs do not establish those timing bounds, replay rules, a server cancellation endpoint or physical capture release from mute, so none is assumed here.

### API surface

Worker routes require a verified Supabase bearer token, current enabled profile and the configured same origin. IDs in the body never choose the actor. All responses are uncached. JSON bodies reject unknown keys; proposal bodies are limited to 96 KiB, other bodies to 8 KiB. Errors contain only an allowlisted code and request ID. The handler limits the streamed body rather than trusting its declared length.

Reuse 0006's native Cloudflare limiter pattern with voice specific namespaces: `VOICE_REQUEST_LIMITER` has a 60 second period and limit 30 for trusted client address plus route class; `VOICE_PROJECT_LIMITER` has period 60 and limit 120 for this environment. Check them before remote Auth or provider work. They are approximate burst controls, while database reservations enforce the exact daily limits. Local process limits do not claim deployed limiter evidence. Provider control and database requests have ten second timeouts; a timed out side effect becomes uncertain, not automatically retried.

HTTP mapping is 400 for invalid input, 401 for missing or invalid Auth, 403 for a disabled or wrong role, 404 for unavailable subjects, 409 for busy/stale/ended conflicts, 413 for a large body, 429 for burst or daily limits and 503 for unavailable configuration or dependency. A reserved start with uncertain issuance returns 202 and safe session metadata. Quota replies include the database derived reset instant. Status read uncertainty returns safe metadata without claiming a provider end.

| Endpoint or function | Method | Inputs | Output and authority | Material failures |
|---|---|---|---|---|
| `/api/voice/sessions` | POST | `startRequestId: UUID`, `campaignId: UUID`, `playerId: UUID`, `acknowledged: true`, all required | New session metadata, captured binding and private token once; existing metadata only on replay. Enabled active preparation coach | `VOICE_UNAVAILABLE`, `VOICE_BUSY`, `QUOTA_EXCEEDED`, `START_UNKNOWN` |
| `/api/voice/sessions/{id}` | GET | Session UUID | Own safe metadata, conservative hold time and locally meaningful recovery state. Current enabled coach; no token or proposal recovery | `NOT_FOUND`, `AUTH_REQUIRED`, `PROVIDER_STATUS_UNKNOWN` |
| `/api/voice/sessions/{id}/connected` | POST | `conversationId: string`, `expectedVersion: integer` | Mandatory authenticated provider observation of exact conversation and agent version; recorded identity check and updated session version. Same session author and current binding | `CONTEXT_CHANGED`, `CONVERSATION_MISMATCH`, `EXECUTION_IDENTITY_UNAVAILABLE`, `VERSION_CONFLICT` |
| `/api/voice/sessions/{id}/finish` | POST | `expectedVersion: integer` | Original finish deadline and current metadata. Repetition never extends the deadline | `CONTEXT_CHANGED`, `SESSION_ENDED`, `VERSION_CONFLICT` |
| `/api/voice/sessions/{id}/proposal` | POST | `proposalId: UUID`, `fields: object`, both required | Normalised nullable fields, proposal ID and binding for review. Worker validates text then atomically checks the session. Response text is not stored | `INVALID_PROPOSAL`, `CONTEXT_CHANGED`, `FINISH_EXPIRED` |
| `/api/voice/sessions/{id}/end` | POST | `reason: finished or cancelled or backgrounded or failed or timed_out`, required | Recorded local outcome plus reconciled or uncertain provider state. Idempotent for the same terminal intent; cancellation wins over pending delivery | `NOT_FOUND`, `PROVIDER_STATUS_UNKNOWN` |
| `reserve_voice_session` | POST RPC | Start request UUID, campaign/player IDs | Atomic caller scoped context capture, quota reservation and outstanding restriction. Preparation coach only. No caller chosen configuration or provider authority | `VOICE_BUSY`, `QUOTA_EXCEEDED`, `CONTEXT_CHANGED` |
| `validate_voice_binding` | POST RPC | Session UUID | Own captured binding only if revisions and proposal eligibility still match. Used before application, not just at filing | `CONTEXT_CHANGED`, `PROPOSAL_UNAVAILABLE` |
| `save_feedback_draft`, `submit_feedback` | POST RPC | Existing 0002 inputs plus `voice_session_ids: UUID[]` when applied fields retain voice | Existing committed or replayed receipt. Eligible author; binding validation and filing occur in one transaction | Existing codes plus `VOICE_CONTEXT_CHANGED` |

Session metadata transitions are narrow Worker only functions for claiming and arming provider authorisation, recording provider identity, beginning finish, accepting a proposal ID, ending locally and recording safe provider closure. They require the trusted Worker credential, a verified actor reference supplied by the Worker and matching session ownership. They never accept feedback text. Reservation and caller binding checks use the caller's own JWT (the existing Auth token).

Reservation grants no provider authority. The Worker loads its reviewed manifest and verifies the applicable activation or local run record, current feature configuration and actual shared provider settings. A service only claim transaction rechecks the captured revisions, current role, stage and memberships under the shared locks, requires an unexpired reservation, and binds that trusted configuration and authorisation record. It creates one immutable `dispatch_id` with `dispatch_until` the earlier of ten seconds after database time and the verified authorisation expiry. The browser cannot provide any of these authority values. Only the request that won this claim may proceed; another request receives metadata.

Immediately before Fetch, the Worker rechecks the trusted record's expiry and environment, then atomically arms that exact dispatch under the same ownership, original revision, current permission and deadline checks. Arming sets `dispatch_started_at` and provider state unknown before the external effect. It returns a dispatch authorisation valid only until `dispatch_until`. The Worker checks that deadline immediately before invoking Fetch, with no intervening awaited operation. No database lock spans Fetch. A stale claimant cannot arm, renew or replace the dispatch; an armed attempt is never sent again, including after a crash before Fetch.

Database fencing prevents a stale claimant from regaining application authority. It cannot retroactively prevent an external effect already authorised across the provider boundary. Revocation after the final check can race that effect; binding checks still forbid its output from filing. A delayed effect is safe to expire only within the verified full dispatch/issuance bound. A late token response is recorded only for its dispatch ID, never returned to a revoked or expired controller, and does not reopen delivery or extend a deadline. A failed or lost token request becomes failed only with definite proof of no provider side effect, otherwise uncertain. Do not issue another token to discover whether the first succeeded.

Proposal acceptance records `proposal_id` and `proposal_accepted_at` once. It requires verified execution identity, open local outcome, no revocation, current original binding and the first finish deadline. Repeating validation for that UUID revalidates the submitted fields and binding without extending finish time; a different UUID is rejected. Cancellation records revocation without clearing the historical UUID. Response delivery and route generations are separate; the browser renders a result only for the original actor, context, finish and proposal UUID.

| Transition | Durable local and proposal rule | Provider restriction |
|---|---|---|
| Accept proposal | One UUID, identity check and acceptance time; no prior local end or revocation | Proposal ready remains outstanding until safe closure |
| End after finish, transport failure or timeout | Record the first local end. Keep an already accepted proposal eligible if its original binding remains valid. No unfinished delivery may subsequently be accepted. Entering the finish processing window alone does not record a local end | Unknown closure stays uncertain; no replacement call |
| Cancel, background or binding invalidation | Set irreversible revocation, close local delivery and ignore late callbacks. Cancellation supersedes another local outcome | Reconcile remote state independently |
| Reconcile provider or expire safely | Preserve local outcome and proposal revocation. If a lost controller remains open, close delivery; preserve only a previously accepted eligible proposal | Release only under the safe closure rule; set terminal status and `ended_at` |
| File reviewed text | Require accepted UUID, verified identity, no revocation, locally ended capture and valid original revisions under the session lock | Remote closure uncertainty alone does not reject an already delivered proposal |

Cancel, proposal acceptance and a new filing transaction serialize on the same session row, following the shared lock order. If cancellation commits first, acceptance and a new voice write fail. If filing commits first, cancellation cannot undo that committed receipt; it only revokes remaining unfiled use. Reconciliation never restores a revoked UUID. These rules apply even when all local outcomes temporarily share remote status uncertain.

Status probes use only the row's provider conversation reference. No route accepts an arbitrary provider conversation or agent ID to inspect. An inaccessible session uses the same safe unavailable response as a missing one. Admins cannot issue coach sessions, impersonate proposal review or inspect temporary proposal content. No provider webhook or tool authenticates to these routes as a coach.

### Atomic filing and value sourcing

Extend the preparation write functions from 0002 without changing their explicit review, version or receipt semantics. `voice_session_ids` is the distinct union of bindings retained on selected or edited fields, maximum 100 IDs. Omitted or empty means a wholly manual or previously filed baseline. The genuine app never omits an unfiled binding to make a mixed field look manual. There is no cryptographic claim that a coach cannot independently type or copy text; the coach already has authority to author manual feedback.

For a new voice write, lock each named session and the current caller, campaign and membership rows, in a consistent order shared with access and stage mutations. Capture and validate all original revisions, ownership, preparation kind, accepted proposal identity, verified execution identity, locally ended capture, no revocation and current write permission within the same transaction that files content. A locally ended call with an accepted proposal may file even while provider closure is uncertain; a revoked proposal or absent metadata may not. Transport failure alone does not revoke an already accepted proposal. Stage, access or membership revision mismatch always does.

Adopt a fixed lock order for overlapping operations: the shared SFDA reservation lock first where used, then profiles in UUID order, competition, campaign and memberships in primary key order, session IDs in UUID order, then draft and receipt targets. A coach operation normally locks only its caller profile; admin operations preserve 0006's sorted requester/target profile order. Admin access disabling locks the affected profile before changing its version; stage and membership mutations retain their competition lock and share the campaign or membership row locks used by voice checks. Never acquire the reservation lock after a profile or session lock, or a coach profile after a competing session lock. Concurrency tests must prove linear ordering for revocation versus capture and filing, rather than relying on separate reads.

Resolve an already committed matching feedback receipt before treating a binding mismatch as permission to replay. Receipt recovery returns only the existing authorised commit reference. A missing receipt does not establish failure while an earlier write may still run. Pending controllers retain their frozen snapshot and IDs under 0004. If a binding becomes invalid, forbid a fresh write replay and restore field baselines after the outcome is reconciled. A confirmed filed draft or submission becomes the new baseline and clears temporary unfiled provenance.

Before applying fields, call the binding check and compare against the current form revision. Apply nothing if that check fails or another mutation has locked the form. Preserve the original baseline and accumulate session bindings across later edits or proposals. On metadata deletion, revision change or proposal revocation, use 0004's nonfileable comparison and baseline restoration. The twenty second proposal deadline limits delivery, not the coach's review time; a delivered proposal remains subject to its binding and the thirty day metadata lifetime.

| Action or display | Value | Named source |
|---|---|---|
| Open voice | Visibility, permitted phase, selected name/reference | Validated `/api/config`, caller scoped workspace context and latched editor kind from 0004/0007 |
| Start | Actor and permanent subject binding | Verified Auth identity and atomic reservation reads of 0002's profile, campaign, memberships and pairing |
| Start | Acknowledgement and notice version | Explicit Start body and the reviewed notice version in the configuration fingerprint |
| Authorise dispatch | Configuration, evidence identity, dispatch fence and deadline | Trusted Worker manifest, verified activation or installed local run record, current provider settings and locked database claim/arm functions |
| Provider context | Neutral label and phase | Literal `selected player` and `preparation` from this installed feature contract |
| Connect | Token, conversation reference, pinned version | Worker authenticated provider token response with reviewed agent/version parameters; matched SDK connection ID |
| Session timing | Reservation/dispatch deadline, credential deadline, display countdown, hard cap | Database 30/10 second windows, authenticated dispatch/issuance and redemption contract, SDK connected event and provider maximum of 300 seconds |
| Quotas | Current day, coach and SFDA counts, reset time | Database instant in `Asia/Singapore`, reservation rows and limits 20/100 in this spec |
| Finish | Twenty second deadline | First server finish timestamp, connected call cap and fixed 20 second setting; repetitions reuse it |
| Review | Proposal UUID, fields and support limits | Browser UUID generator, live client tool arguments, Worker schema validation, recorded actual execution identity and accepted proposal ID |
| Apply or file | All voice bindings and manual baseline | Per field provenance from 0004, original session revisions and current locked database rows |
| File result | Saved/submitted identity and outcome | Existing atomic feedback function and caller receipt, never provider text or an optimistic UI label |
| End or recover | Local outcome, irrevocable proposal state, provider status and actual version | Locked local transition metadata and narrow authenticated provider projection for the row's reference; unknown remote outcome never restores a proposal |
| Retention | Deletion cutoff and observed provider deletion | Database terminal end time plus thirty days; separate synthetic provider privacy evidence with actual observation times |
| Quality and readiness | Scores, critical findings, identity, device and freshness | 0003 reports, the approved text/speech corpus and human signoffs against the reviewed configuration |
| Paid execution | Plan, price basis and case cost acknowledgement | Provider account owner's dated plan and model/voice charge record, linked to the activation evidence. No price is inferred from this document |
| First local evidence run | Issuer, target, cases, limits and expiry | Trusted 0003 runner after explicit maintainer request and cost acknowledgement, private local record installed at Worker startup, fixed fixture targets and server validation below |

### Security and configuration

Feedback stays private to its coach and admins under 0002. Session metadata Row Level Security (per row access rules) permits its enabled author and enabled admins, never another coach or a player. Neither can directly mutate it. Worker service functions have explicit grants; a broad service credential never becomes a general feedback write adapter. A session UUID or provider credential alone grants no database or filing access.

Render proposals as plain text. Treat speech, tool parameters, route IDs and provider errors as untrusted. No speech instruction changes application identity, context, permission or approval. Log only request IDs, named route templates, release identity and allowlisted outcome codes. Do not log body contents, raw URLs, provider responses, tokens, names, audio or captions. Disable provider debug capture and ensure session correlated operating records have at most the selected thirty day retention.

SFDA's named approver must attest the adults only pilot roster, coach and player permissions, actual Cloudflare/Supabase/ElevenLabs and language model processing arrangements, the reviewed disclosure and approved deletion procedure from feature 12. This is an activation prerequisite, with a dated private approval reference and a sanitised public readiness result. No age column, date of birth or legal compliance claim is added. Unknown eligibility or unapproved processing blocks real data use.

| Setting or record | Source and exposure |
|---|---|
| `ELEVENLABS_API_KEY` | Local ignored secret file or production Worker secret binding; never the browser or PR jobs |
| `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_VERSION_ID` | Recorded during authorised provider setup; Worker configuration, pinned private agent version |
| `VOICE_CONFIG_FINGERPRINT` | Reviewed canonical configuration hash using 0003's fingerprint rules, without secret values |
| `VOICE_REQUEST_LIMITER`, `VOICE_PROJECT_LIMITER` | Native Cloudflare bindings with distinct reviewed namespaces and the 30/120 per minute limits above; missing production bindings block remote voice work |
| `VOICE_ENABLED` | Explicit false default from 0001. True only after fresh applicable readiness evidence; preview always false |
| `VOICE_ACTIVATION_EVIDENCE_ID` | Verified production activation record under 0003, with its current applicable expiry. Local verification is separately authorised below |
| `VOICE_LOCAL_RUN_RECORD` | Local startup binding loaded by the trusted verification launcher from its private record, absent from ordinary local use, preview and production. No HTTP route can create or replace it |
| Voice configuration manifest | Reviewed safe file under `verification/voice-config.json`: agent/version references, exact voice/model identities and settings, prompt/tool digests, shared privacy/duration settings, global profile, notice version, authenticated dispatch/issuance and redemption bounds, replay rules and fixed 300/20/20/100 operating limits |
| Private approvals and pricing record | Actual SFDA and provider account owner records; sanitised evidence references only in public artifacts. Missing review disables real activation and paid adapters |

The manifest's first exact voice/model values come from the authorised standard voice and managed default setup, then are pinned. Shared provider privacy and duration are verified at start, not inferred from an immutable agent version. A mismatch, inaccessible configuration, missing finite dispatch/credential bound, unexpected conversation version or expired authorisation evidence fails closed for application sessions. An emergency disable makes every new start unavailable and cancels local capture on the next focus or control action; it does not claim instant termination of remote calls.

The trusted 0003 live runner is the sole issuer of local run authorisation, after an explicit maintainer request on reviewed code and the required cost acknowledgement. It writes schema version 1 records to an ignored private `.local/voice-verification/<runId>.json` file. Required values are run UUID, issuer and acknowledgement references, issue time, expiry no later than fifteen minutes after issue, mode, exact local app origin and Supabase instance identity, configuration/runtime/corpus fingerprints, selected cases and limits. Application cases also bind each synthetic actor, campaign, player and stable start request UUID from the dedicated fixture. Public evidence retains only sanitised references and digests. A browser supplied file, header or acknowledgement Boolean is not authority.

There are two explicit local modes, both denied in preview and production:

* **Compatibility probe**: The runner's narrow provider adapter operates on the reviewed private synthetic agent without calling application start or feedback routes. It checks the local target, provider privacy/duration configuration, pinned agent, synthetic assets and pricing before execution. It may lack the dispatch/redemption measurements or capture/identity proof that it is there to collect. One run issues at most one credential and permits one connection attempt, or two explicitly selected sequential attempts for a replay probe, with no automatic retry and no overlap. Each connected call has the provider 300 second cap and the overall run has the existing fifteen minute bound. An exclusive local runner lock and an atomic private checkpoint keyed by provider agent preserve dispatch intent, conversation references and safe outcomes across crashes. No credentials or real speech are checkpointed. Uncertain issuance or unresolved credential use blocks another paid probe across runs until positive provider reconciliation or a subsequently proven complete bound establishes closure. Exiting or deleting an evidence report is not reconciliation.
* **Synthetic application session**: After compatibility passes, the trusted launcher installs the private record into `VOICE_LOCAL_RUN_RECORD` at local Worker startup. The Worker independently requires `APP_ENV=local`, exact loopback app and Supabase targets, matching fixture instance, unexpired record, current fingerprints and a case matching the caller, context and start UUID. Its claim function binds the verified run reference and enforces one dispatch per selected case, maximum ten cases, under the shared reservation lock. Normal session, quota, replay, identity, capture and filing contracts all apply. Production activation and final quality/device signoffs may still be missing; the approved local run substitutes only for production activation, not compatibility requirements. The test interface identifies live verification with synthetic data.

Neither mode grants real data eligibility, production activation or an unrestricted local bypass. Ordinary local use and PR jobs remain provider disabled. The installed record is trusted because only the reviewed maintainer launcher can set the local Worker binding; remote callers cannot alter process configuration. Invalid target, expiry, case, fingerprint or missing acknowledgement prevents any provider request. The private compatibility checkpoint follows the same safe closure rule; a lost checkpoint requires trusted reconciliation, never a fresh assumed session. The runner automatically prunes closed private checkpoints and expired local authorisation files after thirty days at its next invocation. These are synthetic local verification records under 0003; application session metadata still has hourly automatic database deletion after thirty days of safe closure.

Use the existing Cloudflare scheduled handler for expiry reconciliation and metadata cleanup. This adds no queue, object storage or separate scheduler service. The app derives operating counts and duration where known from session metadata. Safe alerts cover repeated configuration mismatch, failed cleanup and held uncertain sessions. They contain no player content. Native provider billing remains the source of actual cost.

### Verification contract

The required scenarios and provider evidence are in [verify.md](verify.md). They extend 0003's registry, with separate local database, local browser, provider text, provider audio and human results. The twenty speech cases use the existing ten scenarios under clean and noisy conditions. All essential facts pass and both reviewers score at least eighteen cases at 4 or 5. Critical findings in any attempt cannot be erased by retry.

Use current provider Agent Testing APIs for simulations and tool tests. Do not build on the deprecated simulation endpoint. Paid runs remain explicitly requested, concurrency one and without automatic retry. Use at most ten selected cases per run and the existing fifteen minute live run bound; collect complete corpus coverage across compatible runs. Print the selected cases, reviewed pricing basis and expected bounded duration, then obtain the maintainer's cost acknowledgement under 0003 before execution.

Provider default prices and model/voice charges are not known in this planning repository. The provider account owner supplies and approves the current pricing record before a paid adapter is enabled. Its actual values are configuration evidence, like account and agent IDs, not an amount the builder invents. Usage limits do not constitute a hard spending guarantee. Voice readiness includes fresh relevant configuration and privacy checks even when a code change keeps the same agent version.

## Build plan

Follow the confirmed Tracer Bullet approach. Prove one real preparation thread through every layer before broadening speech and failure coverage. This is a future plan, with voice activation held separately from implementation.

1. Establish the narrow session migration, grants, reservation/transition functions and atomic feedback binding extension needed for one synthetic authorised player. Include one outstanding session, trusted claim/dispatch fencing, durable local revocation, quotas and every state cleanup contract in that thread. Satisfies AC-1, AC-3, AC-6, AC-7, AC-8, AC-9, AC-12, AC-14.
2. Build the trusted local run issuer and bounded compatibility probe first. After compatibility passes, connect real local Auth, Worker, pinned private agent and React WebRTC adapter for Start, mandatory execution identity, one focused conversation, Finish, tool delivery, Worker validation, field application and explicit saved feedback readback. Keep the target synthetic and production activation disabled. Satisfies AC-1 through AC-6, AC-7, AC-8, AC-9, AC-10, AC-12, AC-14.
3. Complete capture release, every state/provider closure reconciliation, background and context cancellation, uncertain startup, duplicate tool handling, identity loss and all atomic revision races. Prove cancellation versus acceptance/filing and crash recovery without a subsequent browser request. Preserve manual baselines and pending receipts throughout. Satisfies AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-12, AC-14.
4. Complete provider configuration drift checks, bounded body/error handling, scheduled expiry/deletion, disclosure, private approvals and safe operational visibility. Prove actual microphone and credential compatibility before allowing live activation. Satisfies AC-1, AC-3, AC-7, AC-8, AC-9, AC-11, AC-12, AC-14.
5. Extend the harness with the reviewed ten text and twenty speech cases, rights and asset identity, real provider execution/version evidence and actual device and accessibility checks. Record every attempt, missing result and human signoff under 0003. Satisfies AC-2, AC-3, AC-4, AC-5, AC-6, AC-10, AC-11, AC-12, AC-13, AC-14.
6. Verify the built feature, run its appropriate tests, obtain an independent GA implementation review and document the release evidence. Activate real voice only through the separate approved release path after every applicable gate passes. Satisfies AC-1 through AC-14.

## Consequences

You get conversational preparation feedback through the selected providers, with supported partial drafts, a preserved manual form and one explicit filing path. Quotas and metadata make pilot operation inspectable without a content archive.

There are costs. Every start needs fresh permission, provider configuration and observed execution identity checks. Calls may finish without a proposal, uncertain provider closure may delay another call and backgrounding ends capture. An uncertain dispatch without a proven complete bound can require provider reconciliation with no automatic release time. Metadata adds a migration and scheduled maintenance. The first trusted compatibility run has a separate narrow bootstrap, not production authority. Standard scheduled deletion has no documented immediate deletion guarantee. Actual privacy, device, credential and version proof remain required before use, and paid evaluations need reviewed pricing and explicit acknowledgement.

The initial voice and model are supplied defaults pinned at setup, not a claim that a particular preset already meets the quality bar. The user review, field provenance and atomic context guard remain necessary even after useful provider evaluations.

## Follow-up

* [ ] Feature 10 designs final voice eligibility and its full review path. This specification does not enable final sessions.
* [ ] Authorised provider setup supplies exact agent, version, voice/model IDs and current configuration. Complete the compatibility, pricing and privacy evidence in verify.md before activation.
* [ ] SFDA confirms adults only eligibility, permissions, actual global processing and the approved deletion procedure. Retention observations do not establish that policy on their own.
* [ ] Optional skills deferred by you: ElevenLabs `agents`, Supabase `supabase-postgres-best-practices`, Cloudflare `workers-best-practices` and `wrangler`, React Router `react-router`. Confirm the Router installation path before any installation. No skill installation is authorised here.
* [ ] Optional MCP connections deferred by you: local Supabase first, then Cloudflare's relevant managed server and ElevenLabs hosted MCP during corresponding setup. No connection is authorised here.
* [ ] After authorised implementation, capture real commands and voice ownership in the appropriate agent context. This spec does not create or edit AGENTS.md.

## Rationale

Reasoning, alternatives and the verified source record are in [rationale.md](rationale.md).
