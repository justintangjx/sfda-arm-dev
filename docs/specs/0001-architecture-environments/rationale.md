# Rationale: Architecture and environments

## Context

You are starting a fresh SFDA coach feedback web app. The confirmed scope includes a small coach pilot, minimal admin provisioning, player accounts without a player portal, private text observations, conversational drafts for approval and a singular final assessment per coach, player and competition.

Supabase, Cloudflare and ElevenLabs are fixed constraints. There is no fixed launch date or stated budget. You chose local Supabase with Docker and production only, synthetic previews and checks, a public GitHub repository, memory only sessions, manual reviewed migrations and automatic app deployment from a checked main branch.

The workspace has no application source, package manifest, existing specifications or root agent instructions. It is not yet a Git repository, so remote freshness checks do not apply. This specification is a new architecture decision linked to scope feature 1.

## Options considered

### Option 1: Vite React app, Cloudflare Worker and Supabase

A static browser app and a small Worker API share one deployment, while Supabase handles identity and database access (basis: your provider constraints, Cloudflare SPA routing guidance).

Its strengths are a small deployment surface, a shared local Worker runtime and straightforward authenticated forms. Its costs are deliberate separation of browser and server imports and explicit handling of Worker package compatibility.

### Option 2: Cloudflare Pages and Supabase Edge Functions

A static React app runs on Pages, with privileged endpoints in Supabase's function environment (basis: the reference project's hosting pattern, Cloudflare Pages guidance).

This keeps server functions beside the selected data platform. It also introduces a separate server runtime and deployment path, which works but adds coordination for this small pilot.

### Option 3: Cloudflare Pages and Pages Functions

Static hosting and API functions share the Pages model (basis: the reference app and Cloudflare hosting patterns).

This is a viable continuation of the familiar hosting pattern. The new project has no Pages implementation to preserve, and the selected Worker shape gives the local application one explicit runtime boundary.

### Option 4: A React framework with server rendering

The server owns page rendering as well as authenticated request handling (basis: framework rendering patterns).

It can centralise server page logic and help public indexed pages. This product's main journeys require authentication, so that benefit does not justify an additional rendering and session integration layer for the first pilot.

## Rationale

Option 1 matches the small authenticated workspace and your choice to keep ordinary data requests under Supabase policies. It introduces one trusted server surface for privileged account and voice work while leaving atomic feedback constraints in the database (basis: your confirmed scope and Supabase access policy guidance).

A single package is simpler to operate than a service split. Separate browser, domain and server modules provide an understandable ownership boundary. SQL migrations remain authoritative because the hard rules involve database permissions, uniqueness and transactional writes, and you explicitly declined an ORM (basis: your SQL migration choice and relational data constraints).

The selected memory only session behaviour is intentional. Reloading loses the session, which you confirmed. Local storage or tab storage would improve convenience but would not meet that exact persistence choice.

You preferred two data environments over a hosted staging environment. The design respects that tradeoff: credential free previews are honest UI evidence, local database checks are introduced before pilot use, and production readiness remains separately recorded. The design does not relabel a fixture preview as staging (basis: your environment choice, Cloudflare preview configuration and Supabase testing guidance).

## Scope review

| Finding | Outcome |
|---|---|
| Feature 1 originally named development, staging and production | Its confirmed linked wording now reflects local plus production and fixture previews |
| Feature 11 mentions verification in staging or by a human | Future release evidence uses local tests and designated synthetic production smoke checks, since you declined hosted staging |
| Data model and feedback lifecycle decisions remain separate rows | Keep them separate, this decision does not invent tables or detailed final feedback exceptions |
| Initial harness scope includes real database checks | Your current choice defers those from the initial scaffold, while retaining them as a mandatory first pilot gate |
| Voice remains before campaign completion in the scope sequence | The final rules still belong in the data and completion specifications; no pilot is ready until both are verified |
| Project instructions do not exist yet | The context workflow captures the real scaffold after implementation is separately authorised |

No feature is claimed built. The application scaffold is future execution work derived from the stack decision, so this architecture spec has no duplicate scaffold build plan.

## Decision completeness and sourcing

| Value or action | Source or governing decision |
|---|---|
| Organisation, roles and feedback rules | Confirmed scope, with exact schema in the later fresh data model specification |
| App environment | Explicit local, preview or production deployment profile |
| Local browser origin | This decision, `http://127.0.0.1:5173` |
| Production origin | URL returned when the new production Worker is provisioned |
| Public Supabase settings | Local CLI output or the new production project's settings |
| Privileged provider credentials | Local ignored files or approved Worker secrets, never client input |
| Current user identity | Supabase Auth verified token, authoritative role and assignment checks in the later schema |
| Release identifier | Checked Git commit SHA, or `local` for uncommitted local work |
| Required migration versions | Committed migrations and the later harness release manifest |
| Actual applied migration versions | Target database migration history, inspected before app deployment |
| Production promotion order | One production Worker lock, with superseded commit rejection and prerequisite checks before publication |
| Logged route label | Registered constant labels, with the fixed `unmatched` label for unknown routes |
| Account activation and first admin | Later account operations specification, blocked until it is approved |
| Voice bootstrap and draft return | Later conversational voice specification, voice defaults off |
| Provider quality thresholds and data handling | Later harness and voice specifications, unresolved before real rollout |

These deferred feature values are explicit dependencies, not builder discretion. The foundation can be scaffolded after separate authorisation without implementing those features.

## Separate critique

You requested a separate critique using the same model. The read only review found no high severity gap and confirmed that detailed schema, account, voice and harness decisions are appropriately deferred. It identified production promotion ordering and the source of log route labels as gaps to close.

You approved both recommended fixes on 6 October 2026. Promotions now share a production lock, running promotions finish without cancellation, superseded queued commits are rejected and migration prerequisites are rechecked before publication. Logs use registered constant route labels and never raw paths or queries. You then accepted the assembled specification separately on the same date.

## Research and optional tool discovery

The landscape check used primary official documentation and official search results. Opened sources support SPA routing, preview isolation, Worker runtime limits, Supabase database checks and Vitest. The current scaffold must resolve compatible package versions; an older Vite version's documented minimum was not used to fix the new project's versions.

Optional skill discovery verified official Cloudflare, Supabase and ElevenLabs repositories, and found additional React, Vite, Vitest and React Router guidance. You chose to record the relevant official skills for later, with no installation. You chose local Supabase as the first optional MCP connection, with Cloudflare and ElevenLabs later. No connection was authorised or made. Community candidates remain optional, with no adoption implied.

## References

**Project sources**

* [SFDA scope](../../scope/scope.md), especially the provider constraints, confirmed feedback rules, foundation order and GA workflow.
* Your architecture answers on 6 October 2026, recorded in the chosen stack and environment policy.
* `skills-lock.json` and `.agents/skills/`, which currently contain workflow skills rather than installed technology conventions.

**Practices**

* A small modular application before several services.
* Database access policies and atomic constraints as authoritative checks.
* Credential free previews and separation of synthetic tests from live evidence.
* Manual compatible migrations before dependent automatic app deployment.

**Verified official links**

* [Cloudflare SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), supports the browser fallback and API routing boundary.
* [Cloudflare preview configuration](https://developers.cloudflare.com/workers/previews/configuration/), supports separate bindings and explains why production bindings cannot be inherited safely.
* [Cloudflare Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), describes supported and partial runtime APIs.
* [Cloudflare Pages](https://developers.cloudflare.com/pages/get-started/), the viable alternative hosting pattern.
* [Supabase database testing](https://supabase.com/docs/guides/local-development/cli/testing-and-linting), supports later real local policy and constraint checks.
* [Vitest guide](https://vitest.dev/guide/), supports the initial unit test baseline.
* [Cloudflare skills](https://github.com/cloudflare/skills), verified official hosting and Wrangler guidance.
* [Supabase skills](https://github.com/supabase/agent-skills), verified official platform and PostgreSQL guidance.
* [ElevenLabs skills](https://github.com/elevenlabs/skills), verified official conversational agent guidance.
* [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp) and [ElevenLabs hosted MCP](https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp), verified optional agent service connections.

Previously verified Supabase password, admin creation and access policy documentation is linked from the scope. Those references are reused without another fetch.
