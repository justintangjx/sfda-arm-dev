# 0005. First real coach feedback path rationale

## Context

You have approved the stack, data rules, verification contract and interface design, but nothing has been implemented. The next build needs to prove that a provisioned coach can save useful feedback for a real assigned player record. A fixture screen alone cannot establish account or database access behavior.

You want to keep planning separate from execution. The first proof will use local Supabase, the local Cloudflare runtime and synthetic people. Production onboarding needs separate delivery, recovery and real data evidence. Memory only login and explicit feedback saving are already settled constraints.

Supabase Auth account creation and application database writes cannot share a transaction. Setup must remain safe when a provider response is lost, email status is uncertain or an administrator loses access during a request. The future builder needs those decisions recorded rather than hidden in implementation guesses.

## Options considered

### Option 1: Operator seeded accounts and a coach editor

Create all local identities and assignments with an operator fixture command, then connect the coach feedback screen.

**Pros**

* Fewest UI and server operations before the first saved feedback proof.

**Cons**

* Does not prove the requested admin provisioning path, password setup or partial account recovery.

### Option 2: Minimal admin setup and one complete local feedback thread

Let an admin provision two identities, set up one campaign and open preparation. Connect normal coach login and reviewed submission, then add saved drafts and failure coverage.

**Pros**

* Proves the intended workflow across every layer while keeping the first release local.
* Reuses approved domain and UI rules, with durable progress for provider failures.

**Cons**

* Requires a small provisioning journal and real tests of invitation behavior before the thread is accepted.

### Option 3: Finish the complete account lifecycle first

Build production invitation delivery, public recovery, admin management and expanded roster operations before connecting feedback.

**Pros**

* Gives later features a more complete account foundation.

**Cons**

* Delays evidence for the product's central outcome and expands the scope before a usable thread exists.

## Rationale

Option 2 matches your Tracer Bullet sequence: prove the useful path across every layer, then expand it. A local admin page is enough to exercise genuine privileged setup without treating production account release as an accidental side effect. The journal preserves partial identities and records uncertainty instead of deleting an account or blindly repeating creation.

The planned Auth UUID and trusted metadata let a resumed request locate its own account. The provider types support those inputs, but their existence alone cannot establish the server's invitation behavior. The specification therefore makes real pinned local compatibility tests a gate, with redesign required on failure. No additional mail platform or browser stored session is introduced.

## Confirmed choices

All recommended choices below were accepted during this design conversation. They are design approval, not execution permission.

| Round | Confirmed choices |
|---|---|
| 1 to 4 | Local synthetic proof; minimal admin web setup; real draft, preparation submission and own history; users choose their password through setup links |
| 5 to 8 | Admin activates only after provisioning completes; expired links need admin replacement; partial accounts stay without work access; durable private setup progress |
| 9 to 12 | Existing application email stops new creation and offers explicit profile selection; journal has fingerprints and safe identifiers without raw email or links; retain journal until approved deletion; trusted local first admin bootstrap |
| Model confirmation | Reuse the approved domain entities and add one private operation journal, linked to requesting admin and confirmed Auth identity |
| 13 to 16 | Worker verifies setup proof and updates password before normal login; minimum 12 characters with spaces and managers allowed; ordered admin sections; Open preparation is the only stage UI here |
| 17 to 20 | Any enabled admin can resume; lost create responses require planned UUID and trusted marker checks; unknown password results try normal login first; new setup endpoints are local only |

## Independent review and approved resolutions

You requested a read only critique from a different model, gpt-6-astra, on 7 October 2026. The reviewer read the draft and related local specifications without fetching the reference links or changing files. It found eight decisions needed before build. You then approved all recommended fixes. The main author applied them in index.md. This records resolved design decisions, not an implementation test.

| Finding | Approved resolution | Verification in the build contract |
|---|---|---|
| FP-1, unauthenticated link generation | Fresh 32 byte application capability per link, digest only in private storage, current link pointer and latest generation plus Supabase proof and user match | Numeric and operation identity tampering, previous capability and replacement before dispatch. AC-4 |
| FP-2, direct pending activation | Existing profile enable primitive rejects journal managed pending accounts; only the guarded atomic completion can perform initial enablement | Direct RPC attempts at every checkpoint, revocation and explicit later reactivation. AC-2, AC-9 |
| FP-3, interrupted email ambiguity | Durable attempt start before dispatch, immutable attempt identity, interrupted started attempts unknown, explicit replacement rather than resend | Process termination before and after dispatch and before success recording. AC-3, AC-10 |
| FP-4, stage evidence versus schema | Pull forward exact freeze storage and preparation ending transaction; corrections explicitly unavailable until their later slice | Real admin RPC freeze, purge, rollback and save race. AC-11, AC-13 |
| FP-5, cross admin step gap | Profile creation, receipt, audit, captured version and journal progress are one caller authorised commit | Lost transaction response followed by another admin's resume. AC-2, AC-3 |
| FP-6, private claims in public results | Browser RPC returns safe progress; service only orchestration lookup returns the execution claim | Authenticated claim and digest reads denied. AC-9, AC-12 |
| FP-7, Auth identity drift | Recheck planned UUID, original trusted marker and email fingerprint before every send; drift requires reconciliation | Changed Auth email or marker does not silently redirect mail. AC-3, AC-9 |
| FP-8, incomplete value contracts | Exact safe conflicts, fixed initial reasons, caller keyed resume receipts, current child link resolution and parent password attribution | Conflict payloads, retry dedupe, reasons and child link completion scenarios. AC-3, AC-4, AC-5, AC-10, AC-12 |

The review considered the create then invite runtime behavior an explicit compatibility gate, rather than a proven flaw. Keep that gate and its stop for redesign rule. The application capability authenticates the current email context; it does not pretend to bind the provider's token hash cryptographically. It adds no mail provider or persistent browser session.

After the fixes, the same independent reviewer checked the revised contracts and confirmed FP-1 through FP-8 resolved at specification level, with no material residual contradiction introduced. Main thread document checks also confirmed the required sections, all 13 acceptance criteria mapped to scenarios and build tasks, and valid local links. Real Auth, database and browser checks remain future implementation evidence.

You accepted the completed design on 7 October 2026. Scope feature 6 links the specification and its build milestones. The feature remains unbuilt, so its specification status remains Proposed. Acceptance does not authorise coding, provisioning or deployment.

## Provider evidence and limits

The source research ran during this design conversation. The links below are recorded for human reference; no provider account, connection, email or live authentication flow was exercised. Sources were observed on 7 October 2026. SDK master source is evidence of available types and wrapper behavior, not the future committed dependency version.

* The Auth admin implementation posts createUser attributes to the Auth admin endpoint and does not send invitation mail itself. The typed attributes include an optional explicit UUID, trusted app_metadata and email confirmation flag.
* inviteUserByEmail sends an invitation and returns a user. Its ordinary data field is editable user metadata, so it cannot be the trusted correlation marker. The observed references do not prove invitation behavior for every previously created unconfirmed account; that is an explicit local compatibility assertion.
* generateLink exposes a hashed token and action link but does not send mail. It would require a separate sender, which this slice does not select.
* Email templates expose a token hash. verifyOtp accepts invitation and recovery token hash types. updateUser requires the resulting authenticated session. Keeping that session inside the Worker follows from those operations and the accepted memory only browser boundary.
* resetPasswordForEmail requests recovery mail. Behavior after an invitation has been verified but password setting failed still needs the specified real local test. Separate browser password setup and login likewise need direct evidence; the token hash API alone is not a blanket cross device guarantee.
* Local Supabase documentation describes captured Auth mail. Tool names and ports can differ by CLI/runtime version, so current CLI status supplies the capture address. Capture proves local integration rather than external mail delivery.

## References

**Project sources**

* [Scope feature 6](../../scope/scope.md), the first real coach feedback path and GA workflow.
* [0001](../0001-architecture-environments/index.md), runtimes, environment separation, Auth storage and logs.
* [0002](../0002-fresh-data-model-access-rules/index.md), account identity, preparation storage, access checks and atomic mutation protocol.
* [0003](../0003-verification-harness-eval-contract/index.md), preparation readiness, real database evidence and artifact rules.
* [0004](../0004-coach-interface-foundation/index.md), responsive components, editor, navigation and pending action ownership.

**Practices and standards**

* Durable operation checkpoints for external effects, current authorisation at commit, optimistic concurrency, narrow privileged functions and explicit human approval before filing feedback.
* WCAG 2.2 AA verification remains the project accessibility target, with human evidence separate from automated assertions.

**Links, verified during design**

* [Supabase Auth admin implementation](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts), create, invite and link wrapper behavior.
* [Supabase Auth type definitions](https://raw.githubusercontent.com/supabase/supabase-js/master/packages/core/auth-js/src/lib/types.ts), explicit admin UUID, trusted metadata and token hash types.
* [Invite a user by email](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), managed invitation API.
* [Generate an email link](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), link generation without selecting a separate sender.
* [Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates), token hash and verification link construction.
* [Verify a token](https://supabase.com/docs/reference/javascript/auth-verifyotp) and [update a user](https://supabase.com/docs/reference/javascript/auth-updateuser), temporary verified session followed by password update.
* [Send password recovery email](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), explicit replacement after verification or uncertain password setup.
* [Local CLI workflows](https://supabase.com/docs/guides/local-development/cli-workflows), [local configuration](https://supabase.com/docs/guides/local-development/cli/config) and [local testing](https://supabase.com/docs/guides/local-development/cli/testing-and-linting), actual local service and mail capture evidence.
