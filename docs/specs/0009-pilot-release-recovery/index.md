# 0009. Pilot release and recovery

**Date**: 2026-10-21
**Status**: In Progress

## Summary

This specification defines how you host the SFDA coach pilot on Cloudflare and Supabase, how you turn on account email and optional conversational voice in controlled layers, and how you roll back safely without a staging environment. It introduces a **demo voice activation** tier so provisioned coaches can try voice on the public URL under tight limits and expiry, separate from full pilot approval for real player data. Recovery means redeploying, disabling flags, and preserving data rather than automatic schema rollback.

## Requirements

**User stories**

* As a maintainer, you can record the production target, deploy a checked commit manually, and prove health, config, and migration prerequisites before users touch the URL.
* As a maintainer, you can enable hosted account provisioning and password mail on production using Supabase SMTP and Cloudflare limiters, using synthetic mailboxes first.
* As a pilot owner, you can activate **demo voice** on the same public origin for synthetic coach accounts for a limited time without claiming full GA voice readiness or real player eligibility.
* As a pilot owner, you can promote to **full pilot enablement** only when 0003 enable phase evidence, privacy decisions, and feature 12 deletion readiness are recorded.
* As an operator, you can recover from a bad deployment or runaway cost by disabling voice or account routes and redeploying the last known good Worker, without dropping feedback data.
* As an operator, you can follow a **manual hosting setup guide** that lists every Supabase, Cloudflare, ElevenLabs, and SMTP dashboard step, every secret and Wrangler var, and which steps apply to each activation layer, without reading application source code.

**Acceptance criteria**

* **AC-1**: A version controlled **production target manifest** names the approved Worker name, exact `APP_ORIGIN`, Supabase project reference, required Wrangler vars and secrets, rate limit binding roles, and SMTP provider identity. Missing or mismatched manifest values block promotion steps that depend on them.
* **AC-2**: **Manual promotion** follows a documented sequence: local or CI check on the candidate SHA, apply pending SQL migrations to the linked Supabase project, set `RELEASE_ID` to that SHA, build with `APP_ENV=production`, deploy the Worker, then run production smoke checks. The sequence refuses preview targets and refuses `RELEASE_ID=local` in production.
* **AC-3**: **Hosted live** layer allows production login, admin provisioning (when account operations are enabled), preparation manual feedback, and keeps `VOICE_ENABLED=false`. `/api/config` returns live Supabase public values and `voiceEnabled: false`.
* **AC-4**: **Demo voice activation** layer allows `VOICE_ENABLED=true` on production only when a reviewed **demo activation record** is present, unexpired, bound to the current voice configuration fingerprint and deployed SHA, and the Worker implements `production_activation` authorization without local fixture metadata. Demo activation never substitutes for full 0003 voice quality, device, or privacy gates.
* **AC-5**: Demo voice uses existing session quotas and Cloudflare voice limiters from 0008. Demo coaches must be provisioned accounts flagged as synthetic demo subjects in operational records (not real player names). The UI states that the session uses demo activation, not pilot approval for real data.
* **AC-6**: **Pilot enable** layer requires `pnpm verify --mode readiness --profile pilot --phase enable` inputs (evidence file, production smoke adapter when registered, real data policy approval reference, device evidence when voice is requested). No manifest flag alone enables real player roster use.
* **AC-7**: **Recovery**: documented steps disable `ACCOUNT_OPERATIONS_ENABLED` and/or `VOICE_ENABLED`, redeploy the previous Worker version with matching secrets, and leave Supabase schema and feedback rows intact. Account and recovery journals remain auditable. Schema downgrade is a separate reviewed procedure, not an automatic rollback step.
* **AC-8**: **Cost and abuse controls** for demo voice: maintain ElevenLabs billing alerts, keep demo activation expiry at most thirty calendar days unless explicitly renewed in writing, and cap demo roster size in the activation record (default ten coach accounts). Exceeding caps or expiry fails closed for new voice starts.
* **AC-9**: **Observability**: production checks use `/api/health` and safe Worker logs only. Smoke and operator notes never store passwords, mail bodies, or feedback text.
* **AC-10**: **Harness integration**: `verification/production-target.json` and demo activation references integrate with 0003 readiness without duplicating the runner. `productionTargetAdapter` may remain manual until implemented, but the spec names the adapter contract and smoke outcomes either way.
* **AC-11**: Follow up specs 0006 and 0008 reference this spec for SMTP selection timing, demo versus full voice activation, and pilot gates. Feature 12 deletion approval remains blocking for real player data even if demo voice is active.
* **AC-12**: [`manual-hosting-setup.md`](./manual-hosting-setup.md) is the canonical operator runbook for manual infrastructure setup. It stays aligned with `wrangler.jsonc`, `.dev.vars.example`, and the production target manifest fields. Each `/develop` change to hosting bindings or env names updates the guide in the same change set. The guide marks steps as **hosted live**, **demo voice**, or **pilot enable** so you skip work you do not need yet.

## Decision

**Chosen option**: Layered activation on one production target (Option 3 from rationale).

One hosted Supabase project and one production Worker carry three activation layers (hosted live, demo voice, pilot enable). Demo voice is an explicit, expiring activation tier with its own evidence record and Worker authorization path. Full pilot enablement stays aligned with 0003 `activationReady`.

**Implementation skills**: None newly installed. Optional deferred skills remain as recorded in AGENTS.md (Cloudflare wrangler, Supabase, ElevenLabs agents).

## Rationale

See [rationale.md](./rationale.md).

## Feature design

### Activation layers

| Layer | `VOICE_ENABLED` | `ACCOUNT_OPERATIONS_ENABLED` | Intended users | Evidence bar |
| --- | --- | --- | --- | --- |
| Hosted live | false | false initially, true after SMTP and limiter proof | Maintainers, synthetic admins | Predeploy smoke, migration read |
| Demo voice | true | true | Synthetic demo coaches only | Demo activation record plus configured manifest and limiters |
| Pilot enable | per manifest | true | Approved real pilot roster | Full 0003 enable phase plus policy approvals |

Preview profile stays fixture only and is never used for these layers.

### Operational artifacts (no new application tables)

**Production target manifest** (`verification/production-target.json`, schema version 1):

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion` | yes | `1` |
| `workerName` | yes | Matches Wrangler production env name |
| `appOrigin` | yes | Exact https origin, matches Wrangler and Supabase Auth URLs |
| `supabaseProjectRef` | yes | Twenty character ref, matches secrets |
| `accountRequestLimiterNamespace` | yes | Documented Cloudflare namespace id for `ACCOUNT_REQUEST_LIMITER` |
| `accountProjectLimiterNamespace` | yes | Documented namespace for `ACCOUNT_PROJECT_LIMITER` |
| `voiceRequestLimiterNamespace` | when demo voice | Namespace for `VOICE_REQUEST_LIMITER` |
| `voiceProjectLimiterNamespace` | when demo voice | Namespace for `VOICE_PROJECT_LIMITER` |
| `smtpProvider` | when account ops | Provider name, verified sender domain, recorded hourly quota |
| `migrationReaderRole` | optional | Reference to read only migration history role for harness |
| `recordedAt` | yes | ISO instant maintainer recorded the manifest |
| `recordedBy` | yes | Maintainer identifier (email or handle, not a secret) |

**Demo voice activation record** (`verification/demo-voice-activation.json`, schema version 1, committed when approved):

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion` | yes | `1` |
| `activationId` | yes | UUID |
| `approvedOrigin` | yes | Must equal production target `appOrigin` |
| `approvedReleaseId` | yes | Forty character git SHA deployed when activated |
| `voiceConfigFingerprint` | yes | Matches `VOICE_CONFIG_FINGERPRINT` and reviewed `verification/voice-config.json` |
| `expiresAt` | yes | ISO instant, at most thirty days after `approvedAt` unless scope owner renews |
| `approvedAt` | yes | ISO instant |
| `approverReference` | yes | Private approval ticket or signoff id (no personal data of players) |
| `maxDemoCoaches` | yes | Positive integer, default `10` |
| `syntheticRosterNote` | yes | States adults only synthetic demo, no real player data |
| `elevenLabsPlanReference` | yes | Pointer to pricing acknowledgement under 0003 |

Worker secret **`VOICE_ACTIVATION_EVIDENCE_ID`** holds the `activationId`. The Worker validates the committed record digest and expiry before issuing `authorisation.kind = production_activation`.

### Worker behavior changes (demo voice)

Extend `voiceAuthorisation` in specification 0008 implementation:

* For `APP_ENV=production`, when demo activation validates, return authorization with `kind: production_activation` and `evidenceId: activationId`.
* Do not require `VOICE_LOCAL_RUN_RECORD` or `sfda_voice_fixture_instance_id` on production demo starts.
* For production without valid demo activation, fail closed (`VOICE_UNAVAILABLE`).
* Full pilot enable may later reuse the same kind with a different evidence source; demo record type must be distinguishable in readiness reporting (`demo` versus `pilot` in manifest metadata only, not in player facing UI).

### Manual infrastructure documentation

All dashboard and CLI setup for Supabase, Cloudflare, ElevenLabs, and custom SMTP lives in **[manual-hosting-setup.md](./manual-hosting-setup.md)**. The promotion checklist below assumes that guide is complete for your target layer.

### Manual promotion procedure (operator runbook)

1. Confirm candidate commit passed `pnpm verify --mode check --profile foundation` (or broader profile agreed for the release).
2. `supabase link` and `supabase db push` against the production project; resolve any migration drift before deploy.
3. Update `verification/production-target.json` if origin, bindings, or SMTP changed.
4. Set Wrangler production vars: `APP_ENV=production`, `APP_ORIGIN`, `RELEASE_ID=<sha>`, flags per target layer.
5. Set secrets: Supabase trio, ElevenLabs trio when demo voice, `VOICE_CONFIG_FINGERPRINT`, `VOICE_ACTIVATION_EVIDENCE_ID` when demo voice.
6. `CLOUDFLARE_ENV=production RELEASE_ID=<sha> pnpm build` then `wrangler deploy --env production`.
7. Run smoke: `GET /api/health`, `GET /api/config`, synthetic admin login, one account provision and mail receipt (when account ops on), one voice start and finish on demo coach (when demo voice on).
8. Archive smoke notes under `docs/releases/` (future `/document` output), no secrets.

### Recovery procedures

| Situation | First action | Data impact |
| --- | --- | --- |
| Bad UI deploy | Redeploy previous SHA with same secrets | None |
| Runaway voice cost | Set `VOICE_ENABLED=false`, redeploy | Sessions fail closed for new starts |
| SMTP abuse or mail bug | Set `ACCOUNT_OPERATIONS_ENABLED=false`, redeploy | Provisioning and recovery routes forbidden |
| Bad migration already applied | Stop promotion, forward fix migration, do not auto revert | Requires DBA review |
| Compromised service role | Rotate Supabase service key, redeploy secret, audit admin accounts | No automatic password resets |

### Security and authorization

* Only maintainers edit production target and demo activation files through reviewed commits.
* Demo activation record must not authorize origins or SHAs other than those recorded.
* Production Worker continues to reject cross origin account and voice mutations (0006, 0008).
* Real player identifiable data remains blocked until pilot enable evidence and feature 12 procedure are satisfied, even if demo voice is on.

### Value sourcing

| Action | Values | Named source |
| --- | --- | --- |
| Deploy | SHA, origin, flags | Git HEAD, production target manifest, Wrangler env |
| Voice start on demo | Fingerprint, activation id, quotas | Demo activation file, voice manifest, database quota functions |
| Readiness report | `predeployReady`, `activationReady` | 0003 harness, evidence file, production target manifest |
| Smoke login | Synthetic admin credentials | Operator established admin, secure operator store, not repo |
| Mail proof | Inbox receipt | SMTP provider, synthetic mailbox named in smoke notes |

### Failure handling

* Missing limiter bindings: account or voice routes return `CONFIG_INVALID` or `RATE_LIMITED` per existing gates, never partial provider calls.
* Expired demo activation: new voice starts unavailable; in flight sessions follow 0008 closure rules.
* Migration ahead of code: promotion step fails until code catches up.
* Code ahead of migration: deploy blocked by harness migration read when adapter is wired.

### Critical test scenarios

| Scenario | Expected outcome | AC |
| --- | --- | --- |
| Deploy hosted live only | Health ok, voice disabled, manual preparation works for synthetic coach | AC-2, AC-3 |
| Enable account ops without SMTP proof | Maintainers treat as incomplete; routes fail closed if limiters or flag missing | AC-1, AC-3 |
| Demo voice with valid record | Coach starts voice, receives proposal, saves draft, no fixture metadata | AC-4, AC-5 |
| Demo voice expired | Start returns unavailable, manual form still works | AC-4, AC-8 |
| Pilot enable without real data approval | Readiness reports missing, operators do not onboard real players | AC-6 |
| Rollback voice flag | Redeploy disables new sessions | AC-7 |
| Wrong origin in Supabase Auth | Login or mail links fail until URLs realigned | AC-1 |

## Build plan

1. [x] Add **production target manifest** schema, example template, and validation in the harness. Maintain **[manual-hosting-setup.md](./manual-hosting-setup.md)** as the full manual Supabase, Cloudflare, ElevenLabs, and SMTP instructions (layer tagged steps, secret inventory, smoke checks). Link it from `verification/README.md` and the spec index. Wire migration reader prerequisites as optional missing gate until credentials exist. Satisfies AC-1, AC-2, AC-10, AC-12.
2. [x] Add **GitHub Actions production deploy workflow** (optional but recommended): protected environment, production secrets, build and deploy on maintainer approval, no fork access. Until then, keep runbook only. Satisfies AC-2, AC-9.
3. [x] Implement **demo activation record** validation helper and Worker **production_activation** path; remove production dependency on local fixture metadata for demo tier. Coordinate with 0008 code areas. Satisfies AC-4, AC-5.
4. [x] Register **`productionTargetAdapter`** smoke stub or full adapter: health, config, synthetic login, optional voice probe. Store smoke result shape for readiness. Satisfies AC-2, AC-6, AC-10.
5. [x] Add **operator checklists** for recovery and layer transitions (`docs/releases/` template). Update `verification/release.json` pilot defaults (`shippedCapabilities`, `requestedActivations`). Satisfies AC-7, AC-8, AC-11.
6. [ ] Complete **hosted evidence collection**: SMTP delivery proof, limiter binding screenshots or ids in manifest, demo voice smoke notes, then run readiness in advisory mode. Satisfies AC-6, AC-9, AC-10.

Tracer bullet order: manifest and runbook first, then hosted live deploy proof, then demo voice code path, then adapter and readiness wiring, then pilot enable documentation.

## Consequences

* You can ship a public URL before full voice GA evidence, without faking readiness reports.
* Operators must manage three layers and expiry discipline; misconfiguration could expose voice spend (mitigated by quotas, expiry, and billing alerts).
* Demo voice requires engineering work on the Worker, not dashboard toggles alone.
* Manual promotion remains error prone until CI deploy exists; the runbook is mandatory interim evidence.

## Follow-up

* [ ] Update specification 0008 follow up to point demo implementation requirements here and split full pilot activation evidence from demo activation.
* [ ] Update specification 0006 follow up to mark SMTP selection satisfied when production target manifest records provider.
* [ ] Feature 12 approved deletion procedure remains required before real player data at pilot enable layer.
* [ ] Optional: GitHub environment `production` with OIDC to Cloudflare when org policy allows.
