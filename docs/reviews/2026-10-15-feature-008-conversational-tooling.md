# Review, feature/008-conversational-tooling, 2026-10-15

**Reviewed by**: GPT 6 Astra (author on GPT 6.1)
**Scope**: 54 files, feature/008-conversational-tooling vs main, including the working tree and 26 untracked files. The count includes the lockfile and generated database types, or 52 files without them. Merge base: `67a4ca20389d6c9d31fb15a9b4e9c7e4b94d3627`.
**Verdict**: Blocked

The review scope was `git diff 67a4ca20389d6c9d31fb15a9b4e9c7e4b94d3627`, plus files returned by `git ls-files --others --exclude-standard` before this report was created.

## Summary

This change adds preparation voice sessions, database usage limits and filing guards, Worker routes, browser proposal review and local provider verification tooling. The database owns the important permission and lifecycle rules, and provider activation remains explicitly disabled. The current browser integration cannot start a conversation, the local application path cannot supply its authorised request identity, and the tests leave important boundaries unexercised. These implementation findings are separate from the already disclosed missing provider, device, quality and privacy evidence.

## Blockers

### 🔴 The SDK throws before either voice entry point starts, `src/app/voice/LiveVoicePanel.tsx:89`

**Problem**: The transport calls `setMuted(false)` before `startSession()`. In the installed `@elevenlabs/react` 1.17.0, `ConversationInputProvider.setMuted` requires an existing conversation and throws `No active conversation. Call startSession() first.` when its conversation reference is null. The same sequence exists in `src/app/voice/compatibility.tsx:72`. I reproduced the exception against the installed package without contacting the provider.

**Why it matters**: Once the Worker returns an authorised token, the application catches this exception and immediately fails the call without ever starting WebRTC. The compatibility runner also issues its credential before invoking this failing entry point, so its first probe aborts and leaves the issued checkpoint unresolved. Completing provider configuration will not make either path work.

**Suggested fix**: You can remove the input setter before startup and initialise mute state through a supported SDK lifecycle. If an explicit unmute is needed, it must happen after a conversation exists. Exercise both the real React adapter and the compatibility entry against the installed SDK, with provider I/O replaced at its boundary, so a mocked transport cannot conceal this failure.

## Major

### 🟠 StrictMode reuses a permanently disposed voice controller, `src/app/voice/LiveVoicePanel.tsx:153`

**Problem**: The controller is created with `useMemo` at line 108, but the effect cleanup calls its permanent `dispose()`. The application root in `src/app/main.tsx:8` enables StrictMode. During local development, React runs effect setup, cleanup and setup again while retaining that memoized controller. `dispose()` sets `disposed = true` permanently in `src/app/voice/controller.ts:429`. The second `recover()` sets `blocking` to true, then rejects its own result because `current()` requires the controller to be undisposed.

**Why it matters**: This affects the documented `pnpm dev:voice` path before a token request or SDK start. The snapshot remains blocked, `startUnavailable` disables Start, and the same state feeds the editor's filing controls through `onBlocking`. Even if a later render clears that visual state, `start()` still returns because the controller remains disposed. This is independent of the SDK exception above. Replaying setup, cleanup and setup against the real controller produced `blocking: true` and zero start requests.

**Suggested fix**: You can make effect ownership safe for repeated setup and cleanup, creating a usable controller for each active lifetime while preserving immediate cancellation on actual departure. Add a development StrictMode mount check that reaches an enabled Start action and can still save manual feedback after recovery completes.

### 🟠 The application cannot use the start ID authorised by its local run, `src/app/voice/controller.ts:295`

**Problem**: Every Start creates a new random UUID. The Worker authorises only an exact case tuple, including `startRequestId`, from the preissued private run in `src/worker/voice-configuration.ts:207`. The launcher only installs that record into Worker bindings. It does not pass a selected case to the application, and the controller has no input for its recorded start ID. README says the browser verification driver must use that ID, but no application driver is implemented. The compatibility page is a separate provider probe and does not exercise application routes or filing.

**Why it matters**: Even with valid configuration, matching fixture metadata and the preceding browser bugs fixed, clicking Start in the documented synthetic application run sends an unlisted UUID and receives `VOICE_UNAVAILABLE`. The intended conversation through Auth, Worker, database, review and explicit filing cannot be completed through the supplied UI.

**Suggested fix**: You can implement the bounded application verification driver and a way for it to supply the selected case's stable request identity to the real controller. Keep the Worker case comparison authoritative and keep ordinary starts separate from local verification. Prove that the recorded case reaches reservation once and that replaying its identity does not issue another token.

### 🟠 Microphone permission is checked after credential issuance, `src/app/voice/controller.ts:297`

**Problem**: Start changes the label to `requesting_microphone` and immediately calls the Worker start endpoint. The first microphone acquisition is inside the later SDK `transport.start()` at line 336, after the Worker has reserved allowance and issued the credential. There is no permission or capture support check before that request.

**Why it matters**: A coach who denies microphone access, or uses unsupported capture, still consumes a reservation and can leave an issued credential awaiting reconciliation. This contradicts the explicit capture contract in spec 0008, which requires permission from the Start gesture before the paid path and no reservation on denial. It also delays another attempt for a failure that can be detected locally.

**Suggested fix**: You can check capture support and request microphone permission from the Start gesture before calling the application start API. Release every permission probe track before SDK capture begins, and preserve cancellation ownership if permission resolves after departure. A denied or unsupported microphone should produce no reservation or provider request.

### 🟠 Authenticated lifecycle and filing races lack executable coverage, `src/worker/voice.test.ts:33`

**Problem**: The Worker suite tests preview rejection, origin and bearer rejection, invalid configuration and isolated provider projections. No test reaches an authenticated `handleVoiceRequest` lifecycle, including dispatch fencing, issuance recording, connected identity, proposal acceptance or cancellation. The new database suite has an ordinary filing path and a disable versus claim race at `supabase/tests/voice-sessions.test.ts:463`, but no cancellation versus acceptance or filing race, no accepted proposal filing after stage or membership restoration, and no committed receipt recovery after voice revocation. The existing generic feedback tests do not supply real voice session IDs for these cases.

**Why it matters**: These are the new security and atomicity boundaries required by AC-6, AC-7 and AC-14. The passing controller tests replace the complete transport and API, while the SQL tests bypass Worker orchestration with service calls. Consequently, neither suite proves that a valid authenticated application request uses the right actor, dispatch, session and cancellation ordering. This gap can be closed with local synthetic tests and does not depend on paid provider or device evidence.

**Suggested fix**: You can add authenticated Worker integration coverage with real local Auth and database state, replacing only provider I/O. Add deterministic database races for cancellation, acceptance and filing in both commit orders, plus invalid revision restoration and existing receipt recovery. Assert the resulting persisted state and absence of a second dispatch or fresh invalid write.

## Strengths

* The database separates local cancellation, proposal revocation and provider closure. Its frozen credential rule allows conservative reconciliation without trusting a later configuration change, and the filing path validates session bindings under locks.
* Browser and Worker projections exclude internal dispatch and provider references. Proposal fields are strictly bounded and checked, provider responses are projected to safe metadata, and production activation cannot be supplied by a local run record.

## Test coverage

I ran `pnpm exec vitest run src/app/voice/controller.test.ts src/worker/voice.test.ts src/domain/voice.test.ts tools/harness/voice.test.ts`. All 18 tests in four files passed. This is Node evidence for those suites, not browser, workerd, database permission or live provider proof.

The following command reproduced the installed SDK precondition without a provider call or any file change:

```sh
node --input-type=module <<'JS'
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ConversationProvider, useConversationInput } from '@elevenlabs/react';
let result;
function Probe() {
  const { setMuted } = useConversationInput();
  try { setMuted(false); result = 'returned'; }
  catch (error) { result = error.message; }
  return null;
}
renderToString(React.createElement(ConversationProvider, null, React.createElement(Probe)));
console.log(result);
JS
```

Result: `No active conversation. Call startSession() first.` The relevant installed implementation is `node_modules/@elevenlabs/react/dist/conversation/ConversationInput.js`, in `setMuted`.

I also loaded the unchanged controller source through TypeScript transpilation in memory and replayed `recover()`, `dispose()`, `recover()`, `start()` with a successful empty current session response. The result was `{"blocking":true,"startRequests":0}`. This establishes the controller lifetime failure; the visible disabled controls are traced from the React component and screen code, rather than claimed as a completed browser run.

The review covered the changed application, Worker, SQL, SDK patches, harness, configuration, documentation, generated types and lockfile. SQL access rules, lock ordering, proposal eligibility, quota accounting, closure and retention were inspected statically together with their tests. I did not identify another confirmed SQL defect in that read.

Docker socket inspection was denied by the filesystem sandbox, so I did not rerun the real database suite. No paid provider call, microphone capture, application browser verification, hosted check, device check or deployment was performed. The unconfigured provider manifest, missing speech assets and remaining rollout evidence are disclosed project limits, not additional defects inferred by this review. Only this findings file was written.
