# Rationale: Fresh data model and access rules

## Context

You are starting fresh for one SFDA coach pilot. The reference application is context, not a schema to retain. Your confirmed scope requires unlimited preparation feedback, a singular final assessment per coach, player and competition, author and admin privacy, conversational text proposals and admin controlled stages.

Architecture 0001 fixes Supabase Auth and PostgreSQL, SQL migrations without an ORM, browser reads under database policies, atomic database writes, local Docker and production only. The workspace has no application code, package manifest, Git repository or project instructions. This is scope feature 3 and depends on a future authorised scaffold.

Your design answers settled the remaining business rules. Each coach assesses the whole campaign roster. Competition start freezes the required pairings. All frozen players need a final assessment, including nonparticipants, unless individually waived. Stages only advance. Removed coaches retain historical reads; disabled accounts do not. Drafts expire by deletion at stage end. Waivers are permanent. Corrections preserve originals and may follow closure.

The model shape was confirmed in the conversation. You chose one fixed role per account, a required existing Auth link, display name and login email as the personal fields, campaign local team names and a distinct competition per event division. Minors, consent, location and live provider retention remain unresolved before real rollout.

## Options considered

### Option 1: Relational tables, read policies and atomic database functions

Use the selected database for identity links, explicit obligations, uniqueness and transactions, with one feedback relation for drafts and submissions (basis: architecture 0001, relational invariants, Supabase functions and grants guidance).

* Benefit: direct requests and concurrent submissions follow the same rules as the interface.
* Cost: functions with elevated database permission need careful authorisation, grants and real database tests.

### Option 2: Separate draft and submission tables

Keep editable drafts physically separate from immutable submissions, with a transaction copying fields on submission (basis: separating mutable and immutable data lifecycles).

* Benefit: permissions map visibly to separate relations.
* Cost: field definitions and validation are duplicated, while stage deletion, copying and retry receipts still need transactions.

### Option 3: Worker mediated ordinary data writes

Put normal feedback and admin data actions behind the Worker, while retaining database constraints (basis: a central application service boundary).

* Benefit: one server can shape errors and mediate requests.
* Cost: it adds an ordinary data adapter and duplicated permission responsibilities beyond the boundary you already selected in architecture 0001.

## Rationale

Option 1 keeps the hard rules where simultaneous requests can be ordered. A single feedback relation supports the same content contract for manual and approved voice text. Private drafts, immutable submitted rows and separate correction snapshots still have explicit permissions and guards. Foreign keys and unique indexes preserve identity and singular finals beyond a browser check (basis: scope, database transactions and PostgreSQL partial unique indexes).

An explicit obligation snapshot separates roster changes from completion. Otherwise removing a coach or player could silently make an incomplete campaign appear complete. Permanent waivers make an exception explicit. Your choice to delete stage ending drafts is faithfully retained, with atomic transition deletion and no content copy in receipts (basis: your freeze, waiver and draft answers).

Permanent competition pairings record each coach and player pair's first campaign when both memberships become active. Preserved membership rows alone cannot reconstruct which pairs were active together in the past. This supporting relation therefore protects your cross campaign uniqueness rule before the obligation freeze and even before feedback exists. Membership audit and retry references use a campaign UUID plus a required person UUID, avoiding an ambiguous scalar reference to a composite key (basis: your pairing rule and the separate critique findings).

Read policies and explicit grants work together. Ordinary clients receive no table mutation permission. Narrow functions check their caller before using owner permission. Restrictive Auth foreign keys deliberately differ from the common cascade profile example because a routine account removal must not erase submitted history or reset a singular assessment rule (basis: Supabase API grants, function security and user data guidance).

Optimistic versions preserve competing edits, while a competition parent lock orders pair admission across campaigns. Unique indexes protect absent row races. A database receipt binds a request ID to the actor and normalized action. Built in hashing avoids adding an extension for this one task. Existing Vitest can exercise real Auth and RPC calls without another test framework (basis: PostgreSQL locking and hashing guidance, architecture test choices).

Calendar observation dates use Singapore today because you explicitly chose it. Submission and audit instants use database time. Metadata corrections cannot change feedback identities or final obligations. Indefinite submitted record retention is your policy choice; its approved deletion exception still needs a separate procedure (basis: your date, metadata and retention answers).

## Scope boundary and handoff

This specification owns the data target, access rules and atomic write contracts. Later account, campaign, final feedback and voice specifications own their interface and provider behaviour while reusing these rules. Data tests first prove preparation with real identities, then add final lifecycle rules. No screen, delivered invitation, deployed database or live agent is claimed built.

Account bootstrap and provisioning transactions require their own specification before production account setup. Synthetic test setup can use trusted local fixtures, with explicit bootstrap audit attribution. Provider sessions do not become a second feedback writer. The voice feature must implement context revision checks and discard stale proposals; its actual quality and provider configuration remain separate evidence.

The approved deletion procedure is a genuine follow up feature. It must resolve durable references, audit preservation or erasure, Auth identity, backups and provider records before any deletion action is offered. This design exposes no routine destructive shortcut. The no code and no infrastructure boundary continues after design acceptance.

No new stack tool was selected. Your earlier decisions to record official skills and defer connections remain in force, so discovery, installation and connection are not repeated.

## Design review record

You requested a separate critique using the same model. That review was interrupted before delivering its complete report. Two findings were preserved: the draft's active pairing exception conflicted with the permanent campaign ownership rule, and membership audit and receipt identifiers lacked an exact composite key mapping. After these recommendations were presented, you asked to continue and complete the process. Both recommended fixes were applied to the model, mutation contracts, value sources, verification scenarios and build plan. This records a partial independent critique; it does not claim that a complete independent review passed. You explicitly accepted the completed specification on 6 October 2026. Required document sections, all 16 acceptance criteria, verification and build coverage, and local links passed document checks. No application test, migration or provider check was executed.

## Source verification notes

A read only research pass checked new official Supabase pages for functions, grants and Auth data management. Existing scope and architecture references were reused without another fetch. Official PostgreSQL locking and partial index URLs opened successfully, but that pass received no rendered excerpts from those two pages; those recommendations also use established relational practice. The official PostgreSQL 18 binary string page verified the built in hashing functions. Compatible function availability and fingerprint test vectors must still be checked against the eventual pinned local database.

The fingerprint is a database normalization contract, not a promise that JSON text serialization is identical across every database release. Its version remains explicit and upgrades must preserve replay comparison. This source check did not install a package, run a migration or connect a service.

## References

**Project sources**

* [SFDA scope](../../scope/scope.md), product boundaries and GA verification.
* [Architecture 0001](../0001-architecture-environments/index.md), runtime, data access, migration and environment choices.
* Your design answers on 6 October 2026, including model confirmation, fixed roles, snapshot eligibility, draft deletion, corrections, waivers and retention.

**Practices**

* Relational identity, foreign keys and unique indexes.
* Atomic transactions and consistent lock ordering.
* Optimistic version checks and replay receipts.
* Separating private drafts, submitted originals and audited correction records.

**Official links checked during design**

* [Supabase database functions](https://supabase.com/docs/guides/database/functions), function ownership, fixed search path and execution grants.
* [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api), explicit object grants alongside row policies.
* [Supabase user data](https://supabase.com/docs/guides/auth/managing-user-data), Auth identity links, profile deletion and token lifetime considerations.
* [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), parent locks, transaction ordering and deadlock handling.
* [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html), predicate scoped uniqueness for drafts and submitted finals.
* [PostgreSQL binary string functions](https://www.postgresql.org/docs/18/functions-binarystring.html), built in SHA256, UTF8 conversion and hex encoding without a new extension.

These links are for human reference. Later agents reuse the recorded design instead of fetching them again.
