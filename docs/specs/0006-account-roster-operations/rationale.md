# Account and roster operations reasoning

## Context

You have approved a coach focused SFDA pilot with individual admin provisioned accounts, private player feedback and no player portal. The first real path in 0005 proves local provisioning and one saved feedback journey. Scope feature 7 expands the account and membership lifecycle while preserving the campaign and historical access rules.

Email delivery, password changes and database commits can fail independently. The new public recovery surface must not reveal whether someone has an account, falsely identify its requester, create another identity or resurrect an old application link. Account removal must block current access while retaining memberships and frozen obligations.

This repository has planning documents and no application code. Local Docker Supabase and production are the only planned environments. Preview fixtures contain synthetic data. Real player data, minors, consent, data location and deletion procedure remain release decisions, not conclusions established by this specification.

## Options considered

### Option 1: Keep only the thin setup wizard

Retain 0005 and let admins handle all recovery and maintenance manually (basis: 0005).

* Pro: Least application code and no new public recovery endpoint.
* Con: Does not provide the chosen self service recovery or maintainable account directory and membership lifecycle.

### Option 2: Extend existing Auth and SQL orchestration

Add a separate private recovery record and one shared current password link per account. Use existing Worker privileged endpoints and caller authorised database functions (basis: 0001, 0002, 0005 and durable dispatch intent).

* Pro: Keeps one identity and permission model, supports current pilot needs and makes cross flow link invalidation explicit.
* Con: Requires careful provider outcome handling, a managed SMTP setup and real race evidence. The provider and database still do not form one transaction.

### Option 3: Proxy all Auth and coordinate requests through Durable Objects

Move more authentication traffic behind the Worker and add a globally coordinated object for request budgets (basis: Cloudflare Durable Objects concepts and limits).

* Pro: A stronger application request budget can share one authoritative coordination point.
* Con: Adds another stateful component and latency for a small pilot. It does not by itself remove the public Supabase Auth endpoint or make provider changes atomic with SQL.

## Rationale

Option 2 fits your selected stack and the existing account contract. Recovery is distinct from provisioning: it must not create a profile or imply that a public requester has authenticated. A shared head is necessary because separate setup and recovery generations cannot invalidate each other's links. Membership and account removal remain separate actions because disabling a login must not silently change the campaign roster or final obligations (basis: 0002 and your choices 13 through 16, 23 and 25).

Keep the current browser session in memory and let Supabase own credential verification. Global signout revokes refresh tokens, but access JWTs can remain valid until expiry. Current database rows enforce account disabling even during that interval. The chosen 900 second lifetime reduces future token expiry windows without claiming retroactive invalidation (basis: 0001 and Supabase signing out guidance).

Cloudflare native throttling is useful abuse protection, not exact global accounting. A locked database target cooldown provides the precise per account mail invariant, while Supabase controls its own public endpoints and managed email quota. Custom SMTP is a release prerequisite because the built in sender is restricted and not intended for production users (basis: Cloudflare Rate Limiting, Supabase SMTP, rate limits and public API key model).

### Internal recommendations and alternatives

| Detail | Chosen recommendation and reason | Runner up |
|---|---|---|
| Data access | Existing SQL RPCs for ordinary writes, Worker only for provider secrets and privileged email detail | Proxy all data through Worker, adds duplicated authorization |
| Recovery attribution | Null authenticated requester for public initiation, verified target actor only after proof completion | Attribute the target during email request, falsely asserts authentication |
| Mail retries | Persist started before send, never redispatch, allow explicit fresh request after cooldown | Automatically retry, risks duplicate or superseding emails after unknown success |
| Link invalidation | Locked shared head checked alongside generation and secret capability | Independent journal generations, cannot enforce one current link across flows |
| Recovery readiness | Require known initialization rather than infer it from invitation acceptance | Allow any verified ready account, loses your selected completion boundary |
| Directory email | Auth fetched only for current admin detail or exact lookup, no email in list projection | Email in every row, increases personal data exposure |
| Concurrency | Existing versions, actor scoped receipts and current row checks | Last writer wins, hides stale changes and can restore removed access |
| Failure reporting | Separate password success, refresh revocation and bookkeeping uncertainty | One generic failure, invites unsafe repeated proof consumption |
| UI | Reuse 0004 components, explicit actions and in memory pending state | Add a new admin design system or persisted action queue |
| Production limits | Native Cloudflare limiter plus SQL cooldown and provider limits | Durable Objects for exact global budgets, unnecessary pilot coordination |
| Administrator establishment | Trusted command, checked target, owner supplied password and operator verified identity | Public bootstrap or ordinary admin role grant, expands privilege surface |

These are implementation recommendations settled by the architect, not unresolved business choices for a later agent (basis: 0001 through 0005, least privilege, optimistic concurrency and durable dispatch intent).

## Confirmed answers

You selected every recommendation in the conversation and confirmed the model shape. You chose to skip independent critique and confirmed the complete design content on 7 October 2026. Implementation remains unstarted and requires separate authorisation.

| Choices | Confirmed result |
|---|---|
| 1 to 4 | Separate 0006, public Forgot password without signup, individual forms, production capable design behind release gates |
| 5 to 8 | Display name edits after setup, email editing deferred, Accounts and Campaigns sections, individual membership actions, one email password change flow |
| 9 to 12 | Verified completed eligible accounts, all three roles may recover, admin may request recovery with reason, player restoration before freeze only |
| 13 to 16 | Separate private recovery journal, shared link invalidation, no raw credentials/email/link or network metadata, admins read safe public and admin recovery progress |
| Model confirmation | Existing profiles/setup/memberships plus recovery operations and one shared account password state |
| 17 to 20 | Custom SMTP selected during release, native Cloudflare plus database cooldown, global refresh revocation, separately trusted production admin procedure |
| 21 to 24 | Email only in admin detail, name/role/access and exact email search, assignments survive disable, known initial password setup required for public recovery |
| 25 and 26 | Disable permanently invalidates links; explicit self service replacement after cooldown, no automatic interrupted send retry |

## Source research and freshness

A read only source researcher checked only new unresolved production mail, session and request control facts on 7 October 2026. It used three searches and seven official pages. Previously verified 0005 invitation, OTP, password update and local Supabase sources were reused through that document, never fetched again. No tool, skill or provider connection was installed.

Supabase's built in SMTP currently sends only to organization team addresses and has a small quota, documented as two messages per hour. The precise default may change, so production does not rely on it. Its email quota, per user resend cooldown and Auth request IP buckets are different controls. Record deployed configuration rather than treating a default as production evidence.

Cloudflare's native counters are local to a location and eventually consistent. A global Durable Object limiter is a possible design inferred from its coordination properties, not an out of the box guarantee. The public Supabase key and endpoint model implies that Worker throttling alone cannot cover direct Auth calls. These limits are reflected in the build contract without claiming exhaustive prevention of abuse.

## References

**Project sources**:

* [Scope feature 7](../../scope/scope.md), account and roster operations.
* [0001](../0001-architecture-environments/index.md), Worker, Supabase, in memory sessions and production promotion.
* [0002](../0002-fresh-data-model-access-rules/index.md), fixed roles, history, memberships, obligations, SQL access and audit rules.
* [0003](../0003-verification-harness-eval-contract/index.md), real evidence and readiness gates.
* [0004](../0004-coach-interface-foundation/index.md), components and safe pending interface state.
* [0005](../0005-first-real-coach-feedback-path/index.md), provisioning, identity reconciliation, dispatch and password setup.

**Practices**:

* Least privilege and current row authorization.
* Durable dispatch intent with explicit recovery from uncertain external effects.
* Optimistic concurrency through expected versions and actor scoped receipts.

**Verified official links**:

* [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), production delivery prerequisite.
* [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), distinct mail and request controls.
* [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), public browser endpoint model and the direct Auth inference above.
* [Supabase signing out](https://supabase.com/docs/guides/auth/signout), refresh revocation and access token expiry.
* [Cloudflare Worker Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), native limiter semantics.
* [Cloudflare Durable Objects concepts](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), alternative coordination model.
* [Cloudflare Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), operational cost and capacity of that alternative.

These links are the recorded research evidence for a human reader. Later agents should not fetch them again as part of routine implementation or critique. Pinned runtime compatibility checks remain required and do not substitute for production delivery evidence.
