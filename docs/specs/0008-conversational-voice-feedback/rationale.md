# Conversational voice feedback rationale

## Context

Coaches need to turn spoken preparation observations into useful written feedback while keeping control of what is filed. The workspace already has an editable form, private history and a strict authoring boundary. Player context can change during a call, and permission restoration must not revive an old proposal.

This is a new web feature in a planning repository with no application source, Git repository or AGENTS.md. Freshness against a remote branch could not be checked. Scope feature 9 supplies the intent, Tracer Bullet approach and GA verification depth. Specifications 0001 through 0007 supply the approved foundation rather than evidence of implementation.

You fixed React, Cloudflare, Supabase and ElevenLabs Agents. You chose preparation first, English including Singapore speech, free speech with concrete follow up questions, supported partial output and explicit review. Privacy, device capture and paid provider behaviour require evidence before a real pilot.

## Options considered

### Option 1: Hosted agent with the official React SDK and WebRTC

Reuse the selected provider's browser transport and a blocking client tool for structured proposal delivery (basis: 0001, your choices and the verified React, token and client tool documentation).

The main benefit is one integration that fits the existing React form and keeps provider keys in the Worker. The cost is dependence on SDK capture and provider credential behaviour, which need real compatibility checks.

### Option 2: Hosted agent with WebSocket sessions

Use authenticated signed session URLs and the provider SDK's WebSocket path (basis: the verified React SDK documentation).

It offers direct transport control and a useful alternative if WebRTC compatibility fails. It introduces more audio transport configuration and does not remove the context, approval or privacy requirements.

### Option 3: Build the audio transport and conversation controller

Own browser audio, turn handling and provider integration directly (basis: explicit ownership of integration behaviour).

It gives maximum control over capture and termination. It also adds substantial device, lifecycle and error handling work to a small pilot. There is no measured need for that extra surface.

## Rationale

Option 1 best fits the selected providers and existing form. The client tool delivers a proposal while the connection remains open; it does not need a stored transcript or a provider save action. The Worker checks structure and subject binding, and the database checks the original revisions with the final write. This resolves the integration owed by 0002 and 0004 (basis: those specifications and atomic authorisation at the write boundary).

Standard audio saving off and zero day scheduled deletion match your selected pilot policy. They are distinct from Enterprise Zero Retention Mode, and neither the interface nor evidence may claim synchronous deletion. Actual global and downstream model processing needs SFDA approval before real use (basis: your policy choices and the verified audio saving, retention, Zero Retention Mode and data residency documentation).

The supplied voice and managed default model avoid an unsupported preset choice in a repository without provider configuration. Their exact IDs and settings are captured during authorised setup and then pinned. Versioning alone does not freeze shared privacy and duration settings, so those are independently checked (basis: your setup choice and verified versioning documentation). The documented duration setting supports the chosen 300 second cap (basis: verified conversation flow documentation).

The twenty second finish window, background cancellation and manual fallback are your explicit choices. React input mute and typed messages are building blocks, not proof of physical capture release or reliable structured output. A real compatibility gate makes that uncertainty visible rather than giving the builder permission to weaken Stop (basis: verified React SDK documentation and 0004's capture contract).

Session metadata is an operational record, not a voice draft archive. Database serialization enforces one outstanding session and the 20/100 daily reservations. The existing provider conversation read supplies observed status and actual version, but its content is discarded rather than used to generate a proposal (basis: verified conversation retrieval documentation, least privilege and your metadata model). A mandatory execution identity checkpoint guards acceptance. Separate local outcome and irrevocable revocation preserve a delivered proposal after transport failure without allowing provider reconciliation to revive cancelled output.

A reservation is not provider authority. Trusted configuration and activation or local run evidence are bound only at the Worker claim, with original context checked again at dispatch. The narrow deadline and immutable dispatch identity prevent renewal or replay. They do not claim atomic rollback across the provider boundary. The conservative hold requires a proven complete dispatch/issuance and redemption bound, or positive reconciliation; a client timeout does not prove when a remote effect ended (basis: 0006's external effect boundary and the independent critique you authorised).

The first compatibility probe has a narrow trusted local bootstrap because the evidence it collects cannot already be a prerequisite for that probe. A maintainer requested, cost acknowledged runner issues a private record and retains uncertain dispatch checkpoints. Normal synthetic application sessions require compatibility and replace only production activation authority with their installed local record. Preview and production receive no such bypass (basis: 0003's trusted target and paid execution contract, and your approved critique fixes).

Native burst limiters follow the already approved Worker pattern, with voice specific counters. Database reservations remain the exact daily control. The workspace keeps 0007's selected player and navigation contracts (basis: 0006's request limits, 0007 and scope feature 9).

Provider text evidence may use actual SDK sessions with typed synthetic turns. Native Agent Testing simulations and tool tests can complement it when their execution identity is verifiable. Use the current testing interface rather than the deprecated simulation API (basis: verified Agent Testing documentation and 0003's evidence identity rules). Speech and actual devices remain separate evidence.

## Confirmed decision inventory

| Dimension | Confirmed outcome |
|---|---|
| Workflow | Preparation first; free speech, concrete follow ups, supported partial sections |
| Review | Separate proposal, selected fields only, no date change, explicit filing |
| Session data | Minimal identifiers, binding, configuration, timing, status and safe failures; thirty days after termination |
| Concurrency and usage | One outstanding session per coach; 20 coach and 100 SFDA starts per Singapore day; five minute cap |
| Integration | Official React SDK, private WebRTC, live client tool handoff and Worker validation |
| Supplied defaults | Standard English voice and managed default model, exact setup values pinned before evaluation |
| Context | Neutral player label and phase; no stored names, email, history or form text |
| Failure handling | Keep a complete validated proposal after transport failure if its binding remains valid; no reconstructed missing text |
| Finish and background | Twenty seconds within the cap; cancel capture when hidden or locked; explicit new Start |
| Pilot policy | Adults only, approved standard global processing, disclosure beside Start on every call |
| Provider privacy | Audio saving off, zero day scheduled text deletion, verified settings and actual deletion evidence |
| Evaluation | Existing ten text cases plus twenty clean/noisy speech cases and existing actual device requirements |
| Optional tools | Discover candidates, record for later, no installation or connection now |

## Research and uncertainty record

The read only provider research ran on 8 October 2026, within five searches and eight opened pages, with primary official documentation. Some API and ancillary references were confirmed through official search results rather than an additional page fetch. The writing pass reused those sources without another fetch.

Verified capabilities include private WebRTC token issuance with a pinned version and conversation ID, structured browser client tools, an explicit session end method, a configurable maximum duration, separate audio and retention controls, immutable agent versions and current testing facilities. These capabilities do not establish microphone release, full dispatch/issuance or token validity/replay bounds, availability of actual execution identity while connected, a general browser silence timeout, a server cancellation operation or a maximum scheduled deletion delay. Those unknowns remain explicit compatibility or activation evidence rather than assumed features. Finite timing bounds need a provider contract or verifiable credential rule; successful trials alone cannot prove an upper bound.

Runtime configuration reads and status probes must project only the required metadata. API shape, Worker compatibility and exact SDK method types are checked against pinned dependencies and the real provider during the authorised build. No supplied source proves today's production account settings or actual prices. Owner supplied setup and pricing records remain named inputs before live execution.

No regulatory conclusion was requested or established. Adults only eligibility and standard global processing are your pilot boundaries, subject to SFDA's actual approval and feature 12's deletion procedure. Tests cannot establish that approval.

## Independent critique and approved resolutions

On 8 October 2026 you requested another capable model's read only critique. It read this specification and related local contracts, fetched no references and wrote nothing. You then chose Apply the recommended fixes for all six findings. The main thread made the following targeted revisions, and you confirmed the revised assembled specification on the same date. This confirms design content; implementation remains unstarted.

| Finding | Approved resolution |
|---|---|
| C1, issuance authority | Reservation takes no configuration authority. Trusted claim and final arm bind current evidence/configuration, original context, one dispatch identity and a bounded authorisation window |
| C2, uncertain issuance origin | Absolute expiry includes the full dispatch/issuance and last redemption bounds. Unknowns outside that contract retain the outstanding restriction until positive reconciliation |
| C3, proposal eligibility during uncertain closure | Durable local outcome, accepted proposal identity and monotonic revocation are separate from provider state. Cancellation, acceptance and filing share the session lock; committed receipts remain committed |
| C4, abandoned outstanding states | Scheduled recovery covers every outstanding status, including no provider ID and no subsequent browser request. Only safe closure sets terminal retention time |
| C5, first live verification bootstrap | Trusted local runner issues private bounded records. Initial compatibility probes have a separate retained checkpoint; ordinary synthetic application sessions require compatibility and an installed server checked record |
| C6, actual execution identity checkpoint | Authenticated provider observation is mandatory at connection. Missing or mismatched identity revokes proposal eligibility; acceptance and filing require the recorded successful check |

## Optional tool discovery

Discovery reused the recent 0001 source record and refreshed official candidate evidence on 8 October 2026. Only workflow skills are installed. A registry CLI stalled without output and was interrupted; the discovery used the documented official repository search fallback. No skill, account, connection or file was changed by the helpers.

Relevant candidates are ElevenLabs `agents`, Supabase `supabase-postgres-best-practices`, Cloudflare `workers-best-practices` and `wrangler`, and React Router `react-router` (basis: verified official repositories). Router's official archived skill repository points to its current main repository and selector, but the new file path was not confirmed. The broader Supabase label was not a verified skill name. ElevenLabs `speech-engine` describes another product and does not fit the selected hosted Agents integration, so it was excluded.

Optional connections are Supabase local MCP, the relevant Cloudflare managed MCP server and ElevenLabs hosted MCP (basis: their verified official documentation). You deferred all installation and connections, with local Supabase first during later setup. Availability does not grant account or conversation access.

## References

**Project sources**

* [Scope feature 9](../../scope/scope.md), confirmed intent, pilot rules, Tracer Bullet and GA workflow.
* [0001](../0001-architecture-environments/index.md), browser, Worker, provider and environment boundaries.
* [0002](../0002-fresh-data-model-access-rules/index.md), private feedback, revisions, atomic writes and retention.
* [0003](../0003-verification-harness-eval-contract/index.md), corpus, scoring, freshness, paid execution and evidence identity.
* [0004](../0004-coach-interface-foundation/index.md), visual source, field provenance, capture and pending actions.
* [0006](../0006-account-roster-operations/index.md), native Worker limiter and current access patterns.
* [0007](../0007-campaign-player-workspace/index.md), current authorised workspace and navigation.
* Your staged design answers recorded in the inventory above.

**Practices**

* Atomic authorisation and ordered locks, so a context check and a write share one transaction.
* Idempotent side effect reservation, so a lost response cannot silently create another provider call.
* Least privilege and data minimisation, so metadata and proposal preparation grant no feedback authority.

**Verified official links**

* [ElevenLabs React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react), session controls and transport.
* [WebRTC token API](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-webrtc-token), private credential, version and conversation reference.
* [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools), structured browser handoff.
* [Conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow), maximum duration.
* [Audio saving](https://elevenlabs.io/docs/eleven-agents/customization/privacy/audio-saving) and [retention](https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention), separate privacy controls.
* [Zero Retention Mode](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode), the distinct Enterprise capability.
* [Data residency](https://elevenlabs.io/docs/overview/administration/data-residency), regional and downstream processing boundaries.
* [Versioning](https://elevenlabs.io/docs/eleven-agents/operate/versioning), immutable versions and shared settings.
* [Conversation retrieval](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get), status, version and content exposure.
* [Agent Testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing), current provider tests.
* [ElevenLabs skills](https://github.com/elevenlabs/skills), [Supabase skills](https://github.com/supabase/agent-skills), [Cloudflare skills](https://github.com/cloudflare/skills) and [React Router skill migration](https://github.com/remix-run/agent-skills), optional guidance candidates.
* [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp), [Cloudflare MCP catalog](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) and [ElevenLabs hosted MCP](https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp), optional later connections.
