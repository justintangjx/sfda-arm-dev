# Rationale: Coach interface foundation

## Context

Your SFDA coach pilot needs a focused interface for repeated preparation observations, singular final assessments and reviewed voice proposals. Existing specifications settle hosting, identity, data rules and verification. This workspace still contains documents only, with no application scaffold, Git repository or agent context files.

You chose a fresh visual direction, desktop priority, campaign then roster navigation, a roster beside the player workspace, Write feedback/History tabs, warm neutrals with green accents and a written form with a clear voice action. You also chose explicit dirty navigation, separate voice proposals, offline memory editing, player references, a blank new observation date, automatic draft resume and sequential phone screens.

The existing rules constrain the interface. Feedback remains private, submitted originals are immutable, draft expiry is destructive, final waivers are permanent, account disabling differs from assignment removal and sessions persist only in memory. Coaches need accurate context and safe recovery when an action or session changes while they are typing.

## Options considered

### Option 1: Separate roster and player pages on every device

Use a simple page transition whenever a coach opens a player (basis: standard list/detail navigation and your campaign entry flow).

* Benefit: straightforward composition and a consistent narrow layout.
* Cost: desktop coaches repeatedly leave the roster to compare or switch players.

### Option 2: Desktop split workspace and sequential phone views

Keep the roster beside one player's form/history on desktop, then adapt to sequential narrow views (basis: your selected desktop and phone layouts).

* Benefit: desktop context stays visible, while phones avoid cramped columns.
* Cost: focus, route state and unsaved navigation must work across both compositions.

### Option 3: Three columns for roster, editor and history

Keep all surfaces visible at once on a wide screen (basis: an information dense workstation layout).

* Benefit: history can be referenced without a tab switch.
* Cost: forms and corrected text become cramped on ordinary laptops, and phones need a larger structural change.

## Rationale

Option 2 follows your desktop priority without sacrificing phones. Tabs let a coach focus on writing or history while retaining the form in a common parent context. Full original/latest correction display follows 0002, rather than quietly substituting the corrected version. Short UUID references distinguish names without inventing jersey numbers or adding personal fields (basis: your answers, data specification 0002 and scope feature 5).

CSS Modules are already supported by Vite and keep the warm neutral/green direction explicit without an added styling service. Tailwind is a valid alternative with an official Vite integration, but you selected CSS Modules. System fonts, text branding and native controls avoid asset or package prerequisites for this small pilot (basis: your styling and design choices, verified Vite/Tailwind guidance).

React Router's data router supports the selected blocker while remaining library usage under 0001. A declarative BrowserRouter would require another navigation interception approach. Browser unload warnings cannot offer the custom app dialog or guarantee mobile recovery, so the interface does not claim to save on exit (basis: verified React Router blocking guidance and browser unload constraints).

Explicit proposal comparison protects manual edits; applying text is separate from filing it. Final review is deliberate because a submitted final cannot be revised by the coach. Dirty prompts and immutable request snapshots reduce accidental loss and duplicate intent while preserving 0002's authority (basis: your proposal/submission choices, data rules and idempotent mutation practice).

WCAG 2.2 AA and WAI tab/dialog patterns define an assessable target, not an accessibility claim from a mock screenshot. The harness distinguishes fixture, real database, provider and human evidence. That lets this foundation deliver reusable UI surfaces without claiming the later integrations are built (basis: your accessibility choice, scope's recorded WCAG target, WAI guidance and verification specification 0003).

## Independent review

A separate model, GPT-6 Astra, reviewed the draft on 7 October 2026 at your request. It read the local specifications, changed no files and fetched no references. Its verdict was revise before approval: visual values, read sources and future integration ownership were sufficiently specified, but four interaction decisions remained open. You initially left them unresolved, then explicitly approved applying all four recommended fixes. The feature design now incorporates them.

| Finding | Failure identified | Approved resolution |
|---|---|---|
| UI-1: unresolved mutation ownership | Leaving unmounts a workspace and ignores its late results, without specifying who retains Check result or prevents a competing preparation submission | Keep pending actions in an actor owned controller outside routed workspaces; reconcile outcomes there, suppress stale editor updates and block competing writes in the affected context until reconciliation. Apply the identity loss privacy rules. |
| UI-2: editing during mutations | An immutable request snapshot does not determine whether later typing is allowed or erased by successful reset/navigation | Make editor inputs and proposal application read only while the mutation is pending or its outcome unknown; unlock preserved input on confirmed failure, and perform the stated reset/navigation on confirmed success. |
| UI-3: phase transition | Current stage determines kind, but old preparation text must remain in its original context and never become final automatically | Latch the editor's original kind; retain permitted manual text read only when that phase ends, with an explicit discard/start current phase transition loading that phase's own draft or blank form. Refresh eligibility before resuming same phase editing. Voice remains invalidated. |
| UI-4: voice provenance | Restoring manual values where safe does not define subsequent edits or repeated applications, risking loss or relabelling stale voice as manual | Keep each applied field voice bound through later edits and proposals, retaining its last wholly manual snapshot. Invalidation restores that snapshot and may show later mixed edits in a nonfileable comparison while access permits. Session/account loss discards voice comparison content. |

UI-1 through UI-4 are now resolved in the state model, interaction flows, value sources, scenarios and build plan. The pending controller remains outside route lifetimes; input locks avoid newer edit reconciliation; latched kind prevents phase transfer; and per field provenance prevents stale voice text becoming manual by editing or repeated application. A reviewed draft save establishes a filed baseline through 0002, rather than adding voice metadata to the database. Your approval authorises these document changes, not implementation. The review reported no additional blocking accessibility or value source omission. No second independent review or application test has been run since applying the fixes.

## Source verification notes

Your earlier preference for concise verified references is carried forward. A read only helper checked primary Vite, Tailwind, React Router and WAI guidance during this conversation. Existing WCAG, architecture, data and harness references were reused without fetching their recorded links again. The helper also reported browser unload limitations; no custom unload save flow is promised.

Some reported guidance may have come from official search excerpts rather than a full rendered page. It verifies the documented patterns, not their behaviour in a future pinned package set. Actual router blocking, focus restoration, mobile resizing and accessibility still need implementation evidence. No source check installed dependencies, opened a microphone or called a live data/provider integration.

No additional tool was selected beyond built in CSS Modules and the already approved React Router library. Earlier deferred skills and connections remain deferred. Provider execution and atomic voice binding remain explicit future integration prerequisites, rather than endpoints invented in an interface document.

## References

**Project sources**

* [SFDA scope](../../scope/scope.md), feature 5, GA verification and Tracer Bullet delivery.
* [Architecture 0001](../0001-architecture-environments/index.md), React/Vite/router, configuration, sessions and preview boundary.
* [Data rules 0002](../0002-fresh-data-model-access-rules/index.md), drafts, immutable feedback, singular finals, access and voice context.
* [Verification contract 0003](../0003-verification-harness-eval-contract/index.md), actual browser matrix and distinct live/human evidence.
* Your design answers on 7 October 2026 and confirmed temporary state model.

**Practices**

* Stable identity and actor/context scoped async state.
* Explicit review, optimistic versions and idempotent mutations.
* Semantic controls and WCAG 2.2 AA, reused from the scope's recorded standard.

**Verified guidance**

* [Vite features](https://vite.dev/guide/features.html), built in CSS Modules.
* [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite), considered styling alternative.
* [React Router blocker](https://reactrouter.com/api/hooks/useBlocker), app navigation guard.
* [React Router navigation blocking](https://reactrouter.com/how-to/navigation-blocking), data router flow and confirmation.
* [React Router unload hook](https://reactrouter.com/api/hooks/useBeforeUnload), browser unload warning boundary.
* [WAI tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), keyboard and activation pattern.
* [WAI modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), naming, focus and keyboard behaviour.

These links are human references. Later agents use the recorded contract rather than fetching them again.
