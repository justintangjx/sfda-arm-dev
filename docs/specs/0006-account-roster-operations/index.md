# 0006. Account and roster operations

**Date**: 2026-10-07
**Status**: Proposed

## Summary

Give admins an account directory and campaign membership controls. Let eligible users recover their password by email, without public registration or an admin choosing their password. Preserve account and campaign history when access is removed. Extend the approved local feedback path with production controls, while keeping production activation behind release evidence.

## Requirements

**User stories**:

* As an admin, you can provision individual coach and player accounts, inspect progress, correct display names and manage access.
* As an admin, you can add, remove and restore campaign members without losing history or frozen assessment obligations.
* As an eligible admin, coach or player, you can recover your password through email and return to normal login.

**Acceptance criteria**:

* **AC-1**: Individual coach and player provisioning retains the identity, disabled pending profile, durable dispatch, replacement, receipt and reconciliation rules in 0005. There is no public signup, role conversion, email editing, bulk import or account deletion.
* **AC-2**: Enabled admins have separate Accounts and Campaigns sections. The account directory supports name search, role and access filters, exact email lookup, bounded pagination and safe setup status. Login emails appear only in authorised account details. Coaches never receive player emails.
* **AC-3**: Admins may edit a coach or player's display name after provisioning is ready, and disable or explicitly reenable its account using a required reason and expected version. Disabling immediately blocks database work access, preserves memberships and history, and permanently invalidates outstanding application password links. Reenabling never restores those links or silently changes memberships.
* **AC-4**: Membership actions address one person at a time and preserve their row, version and audit history. Before freeze, admins may add, remove and restore eligible members. After freeze, no new coach or player may be added, an existing removed coach may be restored, and a withdrawn player cannot be restored. Frozen obligations, permanent pairings and waivers do not change through account or membership actions.
* **AC-5**: Public recovery is available to enabled admin, coach and player accounts with verified Auth email and a recorded successful initial password setup. Unknown, disabled, unverified and incomplete accounts receive the same public response. Recovery creates neither an Auth account nor a profile. Incomplete invitations use admin setup replacement.
* **AC-6**: Recovery uses private durable records with safe progress readable by enabled admins, including requests initiated publicly. Records contain no raw email, password, link or device and network metadata. An enabled admin may request recovery for an eligible account with a required reason. No admin receives or selects the password.
* **AC-7**: Each account has one current application password link across setup and recovery. A fresh accepted request reserves a new revision and invalidates older application contexts before dispatch. An explicit new recovery request after the cooldown can replace missing, expired or unknown mail. A repeated request never dispatches again, including after interruption. Unknown send outcomes do not claim delivery or rollback.
* **AC-8**: Password completion requires the current application capability, provider proof, matching target and current account eligibility. The browser retains proofs and passwords only in memory. Recovery attempts global refresh token revocation, returns no session to the browser and directs users to fresh login. Existing access tokens can remain valid until expiry. A password change cannot be rolled back after a later bookkeeping or revocation failure.
* **AC-9**: Production account routes remain disabled until their technical release prerequisites pass. Production uses custom Supabase SMTP, Cloudflare request throttling, database email cooldowns and Supabase Auth limits. Missing required configuration fails closed. Previews use synthetic fixtures and make no real Auth, database or mail calls. Local checks use real local Supabase.
* **AC-10**: Production admins are established through a separate trusted operator procedure with explicit target checks and verified identity. Ordinary app operations cannot grant an admin role or manage admin profile access. Interrupted operator work can be reconciled without adopting an unrelated Auth account, overwriting a password or creating a second administrator.
* **AC-11**: Concurrent requests, account removal, stale versions, identity drift, lost responses and provider failures have explicit safe outcomes. Current actor and target checks govern new side effects. Audits attribute authenticated admin changes and verified password completion accurately, while public email initiation is never falsely attributed as an authenticated user.
* **AC-12**: The existing GA harness provides real local account, recovery, membership and permission evidence, meaningful race and failure checks, browser checks and an independent review. Production mail delivery, actual Cloudflare throttling, actual devices and privacy approval remain explicit pilot release evidence. Missing evidence blocks readiness and is never represented as a pass.

## Decision

**Chosen option**: Extend the existing Supabase and Worker account path with a private recovery journal and shared current link state. Reuse caller authorised SQL functions for profile and campaign changes. Keep email and password in Supabase Auth (basis: 0001, 0002 and 0005).

**Mode and scope**: FEATURE, scope feature 7, Tracer Bullet, GA. This is a separate specification extending 0005. Earlier specifications remain the source for unchanged behavior.

**Project context**: No source files, scaffold, package manifest, AGENTS.md or CLAUDE.md exist at design time. The approved specifications supply the stack. Implementation must establish the earlier foundation first.

**Permission boundary**: Design only. This document authorises no coding, provisioning, migrations, installations, connections, publication or deployment.

**Overrides when this feature is built**: Replace 0005's local only account release guard with the gates below. Add shared link checks to all setup and recovery paths, including setup replacement and password completion. Add permanent link invalidation to account disabling. Restrict player restoration to before freeze. Keep 0005's ordinary provision journal role constraint and all its other identity and dispatch invariants.

**Boundary**: This feature supplies account and membership maintenance, not a player portal, final feedback UI, campaign closure, voice, email editing or deletion. Stage controls implemented by 0005 remain setup to preparation and preparation to competition. Later transitions stay unavailable until scope feature 10 is built. No repeated implementation of the coach workspace is required.

**Review state**: You confirmed the design content on 7 October 2026 after choosing to skip independent critique. Document checks passed. Implementation remains unstarted. Status remains Proposed until implementation advances it; content confirmation does not authorise coding or provisioning.

## Rationale

Reasoning, alternatives, confirmed choices and verified sources: see [rationale.md](rationale.md).

## Feature design

### Reused data and exact completion meanings

Reuse `profiles`, campaign memberships, permanent pairings, frozen obligations, receipts and audits from 0002, and `private.account_setup_operations` from 0005. Profiles keep one fixed role and one existing Auth identity. Private records are outside exposed schemas, with direct anonymous and authenticated grants revoked.

Provisioning ready means a verified Auth identity, linked profile and known accepted invitation request with the authorised activation recorded. It does not prove delivery or password selection. Display name editing requires this ready checkpoint. Public recovery additionally requires verified Auth email and a known successful password initialization, recorded below. A lost successful password response with no recorded initialization uses admin setup replacement; it is not guessed complete.

Add two private records. UUIDs and times come from the database, unless the existing browser request or planned Auth identity rule specifies otherwise. Foreign keys restrict deletion. Retention follows 0002 and 0005 until scope feature 12 supplies an approved deletion procedure.

| Record | Required fields | Nullable fields | Keys and relationships |
|---|---|---|---|
| `private.account_password_state` | `profile_id` UUID, `revision` positive bigint, `version` positive integer, `created_at`, `updated_at` instants | `current_link_kind` enum setup or recovery, `setup_operation_id` UUID, `recovery_operation_id` UUID, `password_initialized_at` instant, `next_email_allowed_at` instant | Primary key references one profile. At most one current link: setup references a 0005 operation, recovery references the record below. Both references belong to this profile. A null kind requires both references null. A nonnull kind requires exactly its matching reference. |
| `private.password_recovery_operations` | `id` UUID, `target_profile_id` UUID, `request_id` UUID, `source` enum self_service or admin, `email_fingerprint`, `request_hash`, `fingerprint_version` integer 1, `link_revision` positive bigint, `status` enum, `version`, `created_at`, `updated_at` | `requested_by` UUID, `reason` text, `capability_digest`, `email_attempt_id` UUID, `email_started_at`, `password_changed_at`, `refresh_revoked_at`, `safe_error` enum, `claim_id` UUID, `claim_until` instant | Target references one profile, account to many operations. Admin requester references a profile and must be an enabled admin at initiation, with required reason. Self_service has null requester and reason. Partial unique keys are `request_id` for public requests and `(requested_by, request_id)` for admin requests. Each scoped request belongs to one exact payload. |

Recovery status is `reserved`, `started`, `accepted`, `unknown`, `failed` or `password_changed`. It describes the last known provider outcome, not delivery. A revoked or replaced link is derived from the shared head rather than rewriting old history. `refresh_revoked_at` records only a known successful global signout response. Safe errors are `PROVIDER_REJECTED`, `PROVIDER_UNAVAILABLE`, `IDENTITY_CHANGED`, `OUTCOME_UNKNOWN`, `SESSION_REVOCATION_UNKNOWN` and `SUPERSEDED`.

For recovery only, reason is one of the fixed codes `requested_by_account_owner`, `link_missing_or_expired` or `after_access_restoration`, selected by the admin. Render their fixed human labels and use those labels in the audit reason. Do not accept free text in recovery records, so a reason cannot accidentally retain an email, password or link. Other profile and membership reasons retain the 0002 text contract.

Digest and attempt fields are absent while reserved, populated together at start and fixed thereafter. Use the email normalization, SHA256 and database version 1 request hash contract from 0005. The request hash covers action, target, source, requester, reason and email fingerprint, never password or raw proof. Add indexes for recovery list `(created_at, id)`, target history `(target_profile_id, created_at, id)` and admin requester. The single operation row and guarded version transition permit only one current driver claim. Composite foreign keys from shared state to each operation include the profile ID, with matching composite unique keys on the referenced records. Shared state is locked by profile, so different operations cannot bypass its cooldown.

For setup operations, add nullable `account_link_revision` bigint, set once before dispatch and thereafter immutable. The existing setup generation and capability remain required. Their currentness additionally requires the shared head to point to that exact setup operation and revision. The legacy root pointer alone is no longer sufficient.

`password_initialized_at` is written after a known initial password success. The 0005 success recorder updates it and the setup root `password_setup_at` in one database transaction. Subsequent recovery preserves this initial timestamp. A trusted bootstrap records it only after proof of a known password for that administrator. Migration backfill copies known setup root timestamps; it never infers initialization from ready status or email confirmation. Existing local bootstrap admins require the trusted verification step described below.

Initialize a shared row for each existing profile with revision 1 and no current link. This deliberately invalidates all earlier setup URLs on upgrade; admins explicitly replace unfinished links. Seed any existing cooldown from the latest recorded setup email start plus 60 seconds. Do not invent an account revision for an old URL or infer a successful password change. New profiles receive their shared row atomically with creation, before any email reservation.

### Recovery and shared link lifecycle

1. A same origin request passes environment, input and request limits. Normalize its email in Worker memory. A service only lookup resolves an Auth identity and profile using the fingerprint. Require verified email, current access and known password initialization. Public callers receive no result from this lookup.
2. A transaction locks the target profile, shared state and operation in that order. Check the request hash and existing record before reserving a fresh operation. A replay returns internal safe progress only and starts no driver. Ineligible or cooldown requests create no recovery record, consume no new revision and disclose nothing publicly.
3. For a fresh eligible request, allocate the operation, advance the shared revision, point the head to it, reserve a 30 second execution claim and set `next_email_allowed_at` to database time plus 60 seconds. This commits the dispatch intent. For an admin request, its caller keyed receipt and audit commit here too. Public requests use their journal uniqueness, never a receipt under the unverified target's identity.
4. The fresh driver generates 32 random bytes with Worker Web Crypto, encoded base64url. Store only their SHA256 digest. Under the same claim, version and head checks, allocate an attempt ID, mark started and extend the target cooldown to at least start time plus 60 seconds before calling `resetPasswordForEmail`. Fetch the target Auth identity again and require UUID, verified email and original fingerprint to match. Use a 10 second provider timeout. No database lock spans the call.
5. Record a known acceptance or rejection only for the exact operation, claim and attempt. A crash, timeout or expired claim after started yields unknown. Never redispatch that attempt, even if it might not have left the process. Reserved operations whose driver is lost also require a new explicit request after cooldown. There is no public Resume command and no automatic mail retry.
6. A fresh explicit request after cooldown creates a new operation and head revision. It may replace an accepted, failed, expired or unknown attempt. A lost response is retried with the same request ID while the form survives, returning the same generic public acknowledgment without sending again. Reload loses that ID; the database cooldown still applies.

Apply the same 60 second account email cooldown to initial setup sends and setup replacement. Reserve shared state only after a profile exists and before a dispatch attempt starts. If a setup driver reaches this point during cooldown, return safe pending progress with `EMAIL_COOLDOWN`; do not change the head or claim a send. A later explicit Resume can acquire a new claim and reserve its first send. Once started, only explicit replacement can send again, as in 0005. A replacement does not advance either root generation or shared head until the transaction passes the cooldown and current profile checks. Existing known receipts are replayed before a fresh cooldown decision.

Any setup or recovery reservation invalidates prior application links, including an open password form. Known acceptance does not restore an earlier head if the new email fails. A stale late provider observation can update its own safe outcome after claim validation but cannot activate, change the head or invalidate the newer operation.

Account disabling locks and advances shared state in the same transaction as access removal and audit, clearing the link kind and both references. Keep initialization and cooldown timestamps. Reenabling advances the profile version only and does not create a link. All password handlers check access and the shared head before proof consumption, and again before the external password update. A disable or replacement after that final check may race a provider change already underway; the password may change, but current database access stays blocked. There is no distributed rollback claim.

### Password completion and sessions

Keep `/auth/setup` and the six field setup POST in 0005, adding shared head checks. Add `/auth/recovery` for recovery journal links. Both pages capture proof query fields in memory before the router starts, immediately remove the entire query with history replacement, use no referrer and no store responses, and consume no provider proof on GET. They share accessible password fields and the existing password policy: at least 12 Unicode code points, at most 64 UTF8 bytes, no control characters, no trimming or forced character mix.

Recovery POST fields are `operationId`, `revision`, `capability`, `tokenHash`, `type` fixed recovery, and `password`. Confirmation is browser validation only. Resolve the exact capability digest, target, head revision and access through a service only context function. Verify the capability before the provider token hash. Use a request scoped public Auth client for `verifyOtp`, require its returned user ID to match, recheck shared head and eligibility, then call `updateUser` using that temporary session. No privileged password override is used.

After a known password update, record password_changed and the verified target attributed completion event. Attempt `signOut({scope: 'global'})` on the temporary user session, then record a known revocation response separately. Always discard temporary session state in finally. Return no JWT, refresh token, cookie or Auth object. Setup completion also uses global scope in this feature so replacement does not preserve old refresh sessions. Existing access JWTs remain valid until their configured expiry; account disabling still blocks database work immediately through current rows.

A failed bookkeeping call must not prevent the global signout attempt. Preserve the known provider update result in request memory while reporting any later uncertainty. After an unknown update result on a verified matching temporary session, attempt global signout as cleanup as well, without claiming password success. Invalid or mismatched proof only receives temporary local session cleanup.

A clean response is `{outcome: password_changed, sessions: refresh_revoked}`. If the password changed but revocation or its record is unknown, return `{outcome: password_changed, sessions: unknown}` with guidance to log in and sign out other sessions through the same email recovery path. Never say all sessions ended immediately. If password outcome itself is unknown, return `OUTCOME_UNKNOWN` and offer normal login with the chosen password first, followed by explicit recovery or admin setup replacement. Do not repeat OTP consumption automatically. App cancellation cannot promise cancellation of an external password change already underway.

### Account and membership surfaces

Use the 0004 components, colors, typography and focus behavior. `/admin/accounts` contains the account directory and an individual Add coach or player form. `/admin/accounts/:id` shows display name, fixed role, current access, login email, setup readiness, safe setup operations and safe recovery history. Display name editing is available only for ready coach and player profiles. Disabled pending profiles can be blocked further but never enabled through a shortcut around 0005. Admin profiles have read only name and access controls, plus eligible recovery actions.

Provision, Resume, setup replacement, account access and admin recovery are explicit separate actions. Explain that a new password link invalidates older ones. Name and access changes and membership removal or restoration require the 0002 text reason, at most 2,000 characters. Admin recovery requires the fixed reason selection above. Use fixed initial assignment reasons already approved in 0005 for first admission. Disable and replacement confirmations default to Cancel. Do not automatically resend mail, reenable an account or restore a membership after a timeout.

Enforce the ready checkpoint inside `update_profile_name`, not just in the form. A deliberate Disable action increments the profile version and clears the shared head even when a pending profile is already disabled. This invalidates the version captured for pending activation, so a later setup resume cannot silently enable it. Return `RECONCILIATION_REQUIRED` rather than treating reenabling as ordinary initial activation.

`/admin/campaigns` lists campaigns with name, team, competition and current stage. `/admin/campaigns/:id` shows coach assignments and player roster, with active and inactive rows distinguished and an active filter. Creation and initial stage actions reuse 0005. Admission pickers exclude disabled or pending profiles and require the correct fixed role. Target eligibility is checked again in SQL, not trusted from the picker. Each row offers only currently supported Add, Remove or Restore actions and requires its expected version. After freeze, explain the player restoration restriction and retain withdrawn players in history. Do not expose another coach's private draft or create a final stage control here.

`/forgot-password` is reachable from login and the minimal account status page, including for a signed in user who wants to change password. It asks for email and always says: If this account is eligible, check your email for a password link. Offer a new explicit request after 60 seconds without exposing eligibility. No recovery history or operation identifier appears publicly. Player accounts keep `/account` status, own known login email in session and these password and signout actions, with no campaign portal.

Admin action state retains its request UUID and frozen payload in memory until a known result. Disable additional conflicting actions while pending. On a lost response, reconcile through safe progress or the caller's receipt before attempting another effect. Version conflicts preserve local input and offer Reload current values. Dirty forms guard in app navigation with Stay or Discard; do not store drafts in browser persistence. Session loss clears actor owned request state, account details and email. Read controls show loading, empty, error and retry states with keyboard focus and accessible status announcements.

### API surface

Worker JSON fields reject unknown keys. All mutations require exact `APP_ORIGIN`, a 16 KiB body limit and the relevant request limits. UUID request IDs are required for nonpassword writes. Passwords and proofs are neither hashed into receipts nor retained. Ordinary data and writes continue through caller authorised Supabase reads and RPCs.

| Endpoint or function | Method | Inputs | Safe result | Auth and key errors |
|---|---|---|---|---|
| Existing 0005 account and setup routes | Unchanged | Existing exact contracts | Existing progress and conflict envelopes | Current enabled admin where applicable; new release guard and shared head rules |
| `admin_list_accounts` | POST RPC | `name_query` optional string up to 160; optional role and enabled filters; cursor; page size | Profile ID, name, role, access, profile version, derived setup status; next cursor | Enabled admin; FORBIDDEN, INVALID_INPUT |
| `/api/admin/accounts/lookup` | POST | `email` required | Existing profile safe reference or not_found, never raw email or unlinked Auth details | Enabled admin; INVALID_INPUT, PROVIDER_UNAVAILABLE |
| `/api/admin/accounts/{id}` | GET | Profile UUID | Safe profile detail plus verified Auth login email | Enabled admin; NOT_FOUND, FORBIDDEN, PROVIDER_UNAVAILABLE |
| `update_profile_name`, `set_profile_access` | POST RPC | Existing 0002 inputs, expected version, reason and mutation ID | Profile reference and version | Enabled admin, coach/player target only; VERSION_CONFLICT, ACCOUNT_SETUP_PENDING |
| `set_campaign_coach`, `set_campaign_player` | POST RPC | Existing campaign, person, active flag, nullable creation version, reason, mutation ID | Membership reference and version | Enabled admin; PAIR_CONFLICT, VERSION_CONFLICT, STAGE_CONFLICT |
| `/api/accounts/recovery` | POST | `requestId` UUID and `email` | 202 `{outcome: check_email}` | Public; only input, environment, request rate or general service failure may change response |
| `/api/admin/accounts/{id}/recovery` | POST | `mutationId` UUID, `expectedProfileVersion` positive integer, `reason` fixed code, all required | 201 fresh recovery safe projection or 200 replay; safe pending or provider failure outcome | Enabled admin; ACCOUNT_NOT_READY, ACCOUNT_DISABLED, VERSION_CONFLICT, EMAIL_COOLDOWN |
| `/api/admin/recovery-operations` | GET | Optional target profile UUID; cursor; page size | Operation ID, target ID/name/role, source, admin requester ID when present, reason, status, version, timestamps, derived current flag and safe error; next cursor | Enabled admin; FORBIDDEN, INVALID_INPUT |
| `/api/admin/recovery-operations/{id}` | GET | Operation UUID | Same safe operation projection | Enabled admin; NOT_FOUND |
| `/api/accounts/recovery-password` | POST | Exact six fields above | Password and session outcome only | Current capability and provider proof; LINK_INVALID, OUTCOME_UNKNOWN |

`admin_list_accounts` never returns email, fingerprints, claims or digests. Name search matches a literal case insensitive substring; escape SQL wildcard characters, use bound parameters and retain stable `(created_at, id)` cursor ordering. Default page size 20, maximum 100. The campaign list and both membership lists also paginate with 0002 ordering. Account lookup uses a POST body so raw email is absent from URL history. Recheck current admin access before emitting privileged Auth detail after its network call.

Public recovery returns the same 202 body for ineligible targets, cooldown, repeats, request hash conflicts and individual mail acceptance, rejection or unknown outcome. A database failure in the universally required lookup can return generic 503; errors in target specific provider calls keep the generic 202 and internal safe state. Syntactically invalid input is 422 and public request throttling is 429 with a fixed 60 second retry hint independent of account. No account specific cooldown value is returned publicly. Do not claim constant network timing; return no branch specific payload or headers and test for obvious response differences.

New service only functions, outside user grants, are `lookup_recovery_identity`, `begin_public_recovery`, `get_worker_recovery_context`, `start_recovery_attempt`, `record_recovery_outcome`, `get_recovery_password_context`, and `record_recovery_password_result`. Their signatures accept only named request, target, claim, version, attempt and verified outcome fields required above. `begin_admin_recovery` runs under the actual caller JWT, commits its receipt and intent, and returns safe progress without a claim secret. The Worker then retrieves its private driver context through the service wrapper after verifying current admin and committed intent. Public begin uses its separate service function with source fixed self_service, never a caller selected actor. All functions fix search paths and fully qualify objects.

Extend existing setup context and outcome functions to inspect and update shared state. Service only recorders recheck operation, exact attempt and target identity. Known password completion is deduplicated by operation and attempt ID. A late same operation completion record may report an external success without making that link current again. No generic journal patch, arbitrary actor override or public progress RPC is exposed.

### Security, limits and audits

Application access always uses current enabled profile and fixed role checks. Database writes keep 0002 row and lock rules. For account link transactions lock current requester and target profiles in UUID order, then password state and operation. Membership transactions retain competition, campaign and membership locking from 0002. A provider action requires current actor where applicable, target eligibility, exact head and live claim immediately before dispatch. Existing in flight provider effects cannot be retroactively prevented.

Use the native Cloudflare binding `ACCOUNT_REQUEST_LIMITER` with a 60 second period and limit 10 for request keys derived from route class and trusted client address. Email initiation and password proof routes use separate fixed route classes. A separate `ACCOUNT_PROJECT_LIMITER` binding has period 60 and limit 60, checked with one project and environment key to reduce bursts. Record distinct namespace IDs in reviewed Cloudflare configuration. These counters are approximate and per location, not an exact global budget. Address values are transient limiter keys only, never stored in application records, logs or evidence. Trust Cloudflare's client address field at the deployed edge, not an arbitrary forwarded header. Local mode uses the 0005 process limiter and controlled test discriminators; it does not prove deployed limits.

The database 60 second target cooldown is authoritative across Worker locations and setup/recovery requests. Configure Supabase's separate public Auth limits and production email quota, initially 60 emails per hour for the small pilot, subject to a lower SMTP provider quota. Record the actual effective configuration before release. Provider limits apply even to direct Auth requests; Worker controls cannot cover Supabase's public endpoints. No raw provider error or rate response is exposed publicly.

Use a 900 second Auth access token lifetime for this feature, verified against the actual local and production settings. This bounds the ordinary expiry window to 15 minutes when issued under that configuration, not instant revocation. Refresh remains only in memory while the page is open, as in 0001. Existing longer lived tokens require their original expiry or a separately approved revocation intervention; changing configuration does not shorten them retroactively.

Audit existing profile and membership changes in their committing transactions. Add actions `admin_recovery_requested`, `recovery_link_requested`, `password_recovery_completed` and `password_refresh_sessions_revoked`. Admin initiation records its real actor with receipt; known completion and revocation record the verified proof target. Public initiation and its mail acceptance remain private journal observations without a user audit actor. Do not misattribute an anonymous requester to the target or use bootstrap actor kind for public traffic. Metadata contains only IDs, source, revisions, safe state and codes. Retain required admin reasons without adding email or proof values.

Logs add fixed labels `account_directory`, `account_lookup`, `account_detail`, `recovery_request`, `admin_recovery_request`, `recovery_operations_list`, `recovery_operation_read` and `recovery_password`. Reuse 0001 request ID, status, duration, environment and release fields. Never log raw URLs, paths, queries, email, name, credentials, provider exceptions or bodies. Account detail and proof pages have no store responses. Secret bearing tests disable trace, screenshot, video and request body capture, retaining sanitised assertions only.

### Trusted administrator procedure

Provide a separately invoked operator command, never a Worker route, public RPC or CI job. Ordinary account functions retain coach/player role inputs. The operator command requires `APP_ENV`, explicit expected Supabase project reference, Auth URL, database target and a production confirmation typed against that reference. Local mode still verifies CLI loopback targets. Refuse preview, mismatched targets, unlinked existing emails or role conflicts before side effects. Runtime service and database credentials come from the authorised operator environment, never arguments or committed files.

The administrator whose account is being established supplies their own password through concealed input in the trusted operator session. Require their identity and email ownership to have been checked by the trusted operator, with a required recorded reason; this is an operator verification, not a claim that the application sent or consumed an email proof. Only this trusted bootstrap may create an email confirmed admin identity after that verification. Ordinary coach/player setup must never use this exception.

Allocate a planned Auth UUID and operation UUID using Node Web Crypto before creation. Save a private local checkpoint under ignored `.local/operator-operations/`, with only operation ID, planned UUID, email fingerprint, fixed role admin and safe checkpoint. Persist intent before calling Auth Admin creation with trusted `app_metadata.sfda_admin_bootstrap_operation_id` equal to the operation UUID, the account owner's supplied password and confirmed email. Concealed input is neither printed, logged nor persisted. After any uncertain create response, fetch only the planned UUID and require the original marker and fingerprint; do not create again or adopt by email. Verify normal password login returns that same confirmed identity before linking or marking known initialization. Attempt local signout and drop that temporary session.

A trusted database owner transaction creates the fixed admin profile, enabled access, shared password state with known initialization and an `admin_bootstrapped` audit event with bootstrap actor kind and operation ID. It uses no ordinary admin receipt falsely attributed to an account that did not exist yet. A unique audit action and operation ID prevents duplicate completion. Resume reconciles this committed transaction and the exact planned Auth identity; an existing different profile blocks. This procedure can establish the first or an additional admin, with the same ownership verification. Existing 0005 synthetic bootstrap admins use verify existing mode: prove normal login to their exact already linked admin UUID, then record only missing known initialization, without changing password, role or access.

The local checkpoint is an ignored operational aid, not public release evidence. On a lost checkpoint, stop for trusted reconciliation instead of guessing identity or resetting credentials. Auth creation is not atomic with database linking; a failed link leaves no app access and must be resumed deliberately. Production invocation and actual accounts require separate user authorisation at implementation time.

### Configuration and release gates

Reuse the 0001 environment values and secrets. Add `ACCOUNT_OPERATIONS_ENABLED`, boolean default false for production. Local mode enables the real local account path. Preview always denies these routes before secret or service lookup regardless of this flag. Production requires the flag, exact production origin, Supabase targets, both Cloudflare limiter bindings and a complete reviewed technical release record; absent or failed limit configuration returns a safe unavailable response before provider calls.

Keep SMTP host, port, username, password, sender address and sender name in Supabase's managed Auth SMTP configuration. Select the provider during scope feature 11 release setup, recording its actual quota, sender verification, ownership, support and cost. No SMTP credential enters the browser, Worker bundle or public repository. No new email SDK, Durable Object, queue, ORM, monitoring service, skill installation or MCP connection is selected. Existing optional skill and connection records remain deferred.

Before technical production activation, require local GA account checks, reviewed migrations and generated types, invitation compatibility, limiter configuration, actual SMTP sender and synthetic mailbox delivery preflight, and the checked trusted operator procedure. An authorised first production deployment may then exercise only synthetic accounts to collect endpoint, delivery, limiter and login evidence. Real coach or player data requires the separate scope feature 11 pilot approval, privacy decisions and actual device evidence. A configuration flag alone does not establish those approvals. There is no hosted staging environment; rollback disables account routes and preserves journals rather than dropping schema or undoing a known password change.

Update the existing 0003 readiness manifest rather than introduce a second runner. Preparation retains its original local path requirements. Campaign adds these account and membership checks when this feature is claimed built. Pilot additionally requires actual production SMTP, Cloudflare binding and configured Auth evidence, safe administrator establishment, devices and real data approval. Voice remains disabled and separate. Production migrations remain manually reviewed and applied before merging dependent code; main deployment retains its serial promotion and migration recheck rules from 0001.

### Value sourcing

| Action | Values | Named source |
|---|---|---|
| Browse and find accounts | Name, role, access, version, readiness, cursor | Current profiles, 0005 setup checkpoint, bounded SQL query inputs and stable created time/ID order |
| Exact lookup and detail | Auth ID and email, linked profile reference | Worker normalized email fingerprint lookup or profile UUID, then Auth `getUserById`; current admin check before output |
| Name and access change | Actor, target, new value, expected version, reason, audit and receipt | Verified caller JWT, form, current profile and 0002 functions; link invalidation in same disable transaction |
| Membership action | Role, person, active flag, stage, pairing owner and freeze | Selected profile and membership versions, current database campaign and competition records; 0002 locks and fixed constraints |
| Public recovery eligibility | Verified email, enabled role and known initial password | Current Auth identity, profile, shared password initialization; backfill only known 0005 success |
| Recovery intent | Source, requester, reason, fingerprint, request identity, hash, revision and cooldown | Fixed route source, verified admin or null public requester, form, Worker SHA256, browser UUID, database hash and locked state/time |
| Dispatch | Capability, digest, claim, attempt, URL and target email | Worker random bytes, database committed intent/start, exact head, current Auth identity, `APP_ORIGIN` plus /auth/recovery or existing /auth/setup |
| Password and session result | Current link, provider target, chosen password, success and revocation | In memory form proofs, private context, verified OTP user, actual update/signout responses, deduplicated recorder |
| Safe admin progress | Operation, status, current flag, reason and time | Recovery journal plus shared head comparison; never delivery inference |
| Administrator establishment | Trusted target, planned identity, verified ownership, known password and completion | Operator environment and typed target check, private checkpoint, verification reason, concealed owner input, actual Auth identity/login and committed bootstrap audit |
| Release readiness | Environment, feature flag, binding, SMTP and Auth settings, evidence freshness | Runtime config, managed provider config, reviewed release record and existing 0003 runner; human privacy/device approval from scope feature 11 |

### Failure handling and critical test scenarios

| Scenario | Required evidence and outcome | Criteria |
|---|---|---|
| Complete recovery | Real local provision, captured invitation, password setup, normal login, explicit recovery, captured mail, changed password and fresh login for all three roles; admin initialization uses trusted verification | AC-1, AC-5, AC-8, AC-10, AC-12 |
| Account management | Directory search and filters, literal wildcard name, duplicate names, cursor boundaries, exact email lookup, private detail and stale name/access changes | AC-2, AC-3, AC-11, AC-12 |
| Removed and disabled accounts | Old caller JWT cannot access work after disable; memberships remain; reenable restores only active scopes; old application links stay invalid | AC-3, AC-7, AC-11 |
| Membership matrix | Admission and pairing collision before freeze; removed coach reads own history without writes; player withdrawal retains history; player restore before freeze only; frozen coach restore adds no obligations; no new rows after freeze | AC-4, AC-11, AC-12 |
| Public privacy and eligibility | Unknown email, orphan Auth identity, unverified email, setup ready without password record, disabled profile, all eligible roles and cooldown have equal public status/body/headers except universal input/rate failures | AC-5, AC-6, AC-11 |
| Send races and interruption | Same UUID same payload, changed payload, competing UUIDs, multiple Worker drivers, expired claim, process termination before and after started, accepted response lost and explicit new request after cooldown; no duplicate dispatch | AC-1, AC-6, AC-7, AC-11 |
| Cross flow link races | Setup replacement versus recovery versus disable; old operation with edited revision cannot pass capability and shared head; late callback cannot change newer head or reactivate target | AC-3, AC-7, AC-8, AC-11 |
| Provider identity drift | Changed Auth email, missing target or wrong returned user stops send/update and never adopts or retargets; safe admin reconciliation, generic public result | AC-1, AC-5, AC-8, AC-11 |
| Password uncertainty | Proof GET consumes nothing; invalid capability rejected before OTP; update timeout, bookkeeping failure, global signout failure and lost final response report actual uncertainty without automatic OTP replay | AC-8, AC-11 |
| Session evidence | Recovery globally revokes old refresh sessions in actual local Auth; demonstrate preexisting access JWT remains valid until expiry while current disabled profile rules still deny work | AC-3, AC-8, AC-12 |
| Permissions and attribution | Anonymous, other role, disabled admin, forged metadata and service recorder calls denied; public request has no user audit actor; admin receipt replay and known completion do not duplicate audit | AC-2, AC-6, AC-10, AC-11 |
| Trusted operator failures | Wrong project, preview, conflicting email/role, missing checkpoint, uncertain create, wrong marker, normal login mismatch and database failure cannot grant or overwrite access; successful resume commits once | AC-10, AC-11, AC-12 |
| Environment and delivery | Missing production flag/binding/config denied; preview never calls providers; SMTP acceptance differs from actual synthetic delivery; native deployed throttling and provider settings require real release evidence | AC-9, AC-12 |
| Browser and artifacts | Chromium and WebKit, desktop and mobile sizes, keyboard reasons/confirmations, unsaved navigation, session loss, generic recovery, proof stripping and no credential persistence or retained artifact leak | AC-2, AC-6, AC-8, AC-12 |

Use Vitest and real local database/Auth requests for transaction and provider behavior, Playwright for actual Worker/browser flows and the existing runner for readiness. Provider fault injection complements rather than replaces actual compatibility tests. The UI does not silently retry an unknown email or password effect. No additional voice eval is part of this feature.

## Build plan

1. Add the reviewed private recovery and shared state migration, setup revision extension, known initialization backfill and shared disabling guard. Generate types and prove one vertical path from a real eligible local coach through Forgot password, captured mail, changed password and login. Ship only the minimum recovery UI needed for that thread. Satisfies AC-1, AC-3, AC-5, AC-7, AC-8, AC-11, AC-12.
2. Add the account directory, exact email lookup, details, safe recovery history, admin requested recovery and existing provision actions. Connect profile changes with version, reason and actor owned pending state. Prove coach/player maintenance and all role eligibility boundaries. Satisfies AC-1, AC-2, AC-3, AC-5, AC-6, AC-11, AC-12.
3. Connect campaign lists and individual membership maintenance to existing caller authorised RPCs. Enforce the player restoration restriction and pairing/freeze rules through real database tests, then verify the accessible UI. Satisfies AC-3, AC-4, AC-11, AC-12.
4. Expand link, claim, cooldown, audit, identity drift and provider uncertainty coverage. Complete shared setup integration and global revocation outcomes. Build and verify the trusted operator procedure with synthetic identities and safe checkpoints. Satisfies AC-1, AC-5, AC-6, AC-7, AC-8, AC-10, AC-11, AC-12.
5. Add Cloudflare and Auth request controls, guarded production configuration and readiness mappings. Complete local GA checks, independent review and safe release documentation. Keep production disabled pending SMTP selection and approved synthetic production evidence, then real pilot gates in scope feature 11. Satisfies AC-9, AC-10, AC-11, AC-12.

The first thread contains the head, current access and dispatch invariants before it sends mail. Later tasks broaden coverage and surfaces rather than postpone safety. There is one additive account migration unless the implemented 0005 migration has already shipped and needs a separate compatible adjustment. No destructive schema reset, production migration execution or live email is part of this design task.

## Consequences

* Admins can maintain accounts and memberships without losing feedback history or silently changing final obligations.
* A single link head makes old application links invalid across both password flows, with durable outcomes for interrupted email requests.
* Conservative dispatch behavior can require another explicit email request even when no mail was actually sent. Known initialization requirements can send uncertain initial setups back to admin replacement.
* Refresh revocation cannot instantly invalidate every existing JWT. Current database checks remain necessary, and public Supabase endpoints retain their own provider limits.
* Custom SMTP, trusted admin setup and synthetic production evidence add release work. There is no hosted rehearsal environment or automatic external rollback.

## Follow-up

* [ ] Scope feature 11 selects and configures SMTP, approves production setup, records actual delivery and limiter evidence, and resolves real data, consent, minors, region and device gates before pilot.
* [ ] Scope feature 12 supplies the approved deletion procedure covering account, setup, recovery, audit and operator checkpoint retention.
* [ ] Future email changes and role conversion require separate designs. No current UI or generic provider patch may introduce them implicitly.
* [ ] Existing optional official skills and MCP candidates remain recorded for later consideration. Connect and install nothing in this phase.
