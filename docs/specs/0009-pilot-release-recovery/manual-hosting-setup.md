# Manual hosting setup (operator runbook)

This guide is the canonical manual setup for the SFDA coach pilot on **Supabase**, **Cloudflare**, **ElevenLabs**, and **custom SMTP**. It implements [spec 0009](./index.md). Tags on each section show which **activation layer** needs that work:

| Tag | Layer | Goal |
| --- | --- | --- |
| **BASE** | All hosted layers | Accounts, project, migrations, first deploy |
| **LIVE** | Hosted live | Public URL, login, manual preparation feedback |
| **ACCOUNTS** | Hosted live + demo + pilot | Admin provisioning and password email |
| **DEMO_VOICE** | Demo voice | Conversational preparation on the public URL |
| **PILOT** | Pilot enable | Full readiness evidence, real roster (policy gated) |

Preview (`pnpm dev:preview`) is not production hosting. Do not point production secrets at preview.

---

## 0. Prerequisites on your machine

**BASE**

1. Install **Node 24** (see `.node-version`) and **pnpm 11.5.2**.
2. Clone the repo and run:

```sh
pnpm install --frozen-lockfile
pnpm prepare
pnpm typegen
pnpm exec wrangler login
pnpm exec supabase login
```

3. Prove the app locally (recommended before any hosted work):

```sh
pnpm db:start
pnpm db:apply
APP_ENV=local pnpm db:bootstrap
pnpm dev:local
```

4. Collect accounts: **Supabase** org, **Cloudflare** account, **SMTP** provider (Resend, SendGrid, SES, etc.). **DEMO_VOICE** also needs **ElevenLabs** with billing alerts enabled.

---

## 1. Supabase (hosted database and Auth)

**BASE · LIVE · ACCOUNTS · DEMO_VOICE · PILOT**

### 1.1 Create the project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → **New project**.
2. Choose a **region** deliberately (data location is a product decision, not decided in code).
3. Prefer **PostgreSQL 17** if offered (local dev uses 17).
4. Record:
   - **Project reference** (20 characters, e.g. `abcdefghijklmnopqrst`)
   - **Project URL**: `https://<ref>.supabase.co`
   - **API keys** (Project Settings → API):
     - **Publishable / anon key** → Worker secret `SUPABASE_PUBLIC_KEY`
     - **service_role key** → Worker secret `SUPABASE_ADMIN_KEY` (never expose to browsers or git)

Use a **new** project for this app. Do not reuse the old CRM demo project or Auth users.

### 1.2 Apply schema (migrations)

From the repo root:

```sh
pnpm exec supabase link --project-ref <YOUR_PROJECT_REF>
pnpm exec supabase db push
```

This applies all files under `supabase/migrations/`. Apply migrations **before** deploying Worker code that depends on new SQL.

Optional local sanity check (Docker only): `pnpm test:db`.

### 1.3 Auth URL configuration

**BASE · LIVE · ACCOUNTS**

You will set **Site URL** and **Redirect URLs** to your **exact** Cloudflare app origin (see section 2). Until the first deploy, you can use a placeholder and update after you know `https://<worker>.<subdomain>.workers.dev`.

In **Authentication → URL configuration**:

| Setting | Value |
| --- | --- |
| **Site URL** | Exact app origin, e.g. `https://sfda-arm-dev-production.<account>.workers.dev` (no path) |
| **Redirect URLs** | Same origin plus password flows (wildcards allowed), e.g. `https://<origin>/auth/setup?*` and `https://<origin>/auth/recovery?*` |

Mirror the intent in local `supabase/config.toml` `additional_redirect_urls`.

Other Auth settings to align with specs 0005 and 0006:

| Setting | Production value |
| --- | --- |
| Public signup | **Disabled** (admins provision users) |
| Minimum password length | **12** |
| JWT expiry | **900** seconds (15 minutes) |
| Email rate limit | Plan for ~**60/hour** on the pilot (SMTP provider may be lower) |

### 1.4 Custom SMTP (required for ACCOUNTS)

**ACCOUNTS · DEMO_VOICE · PILOT**

Dashboard → **Authentication → SMTP**:

1. Enable custom SMTP.
2. Enter host, port, username, password, sender email, sender name.
3. Verify domain/sender with your provider.
4. Send a test message to a mailbox you control.

Record provider name and quota in `verification/production-target.json` when you create it (spec 0009).

Without SMTP, coaches cannot receive **Set your SFDA password** or recovery links.

### 1.5 First administrator (production)

**BASE · LIVE · ACCOUNTS**

Local `pnpm db:bootstrap` only works on loopback. For production use the **operator command** (spec 0006):

```sh
export APP_ENV=production
export SFDA_OPERATOR_PROJECT_REF=<ref>
export SFDA_OPERATOR_AUTH_URL=https://<ref>.supabase.co
export SFDA_OPERATOR_DATABASE_URL='postgresql://...'   # Dashboard → Database → connection string
export SFDA_OPERATOR_PUBLIC_KEY='<anon/publishable key>'
export SFDA_OPERATOR_SERVICE_KEY='<service role key>'
export SFDA_OPERATOR_EMAIL='you@yourdomain.com'
export SFDA_OPERATOR_NAME='Your Name'
export SFDA_OPERATOR_REASON='Verified ownership for pilot bootstrap'

pnpm operator:admin establish
```

Follow prompts (project ref confirmation, admin password). Checkpoints live under `.local/operator-operations/` (gitignored).

Verify later:

```sh
export SFDA_OPERATOR_PROFILE_ID=<admin-user-uuid>
pnpm operator:admin verify
```

---

## 2. Cloudflare (Worker + static app)

**BASE · LIVE · ACCOUNTS · DEMO_VOICE · PILOT**

### 2.1 Account and Wrangler production environment

The repo ships `wrangler.jsonc` with `local`, `preview`, and a **`production`** env template. Replace the placeholder **`APP_ORIGIN`** and **`RELEASE_ID`** before users touch the URL. Add rate limit bindings (section 2.2) when you enable **ACCOUNTS** or **DEMO_VOICE**.

Production vars in `wrangler.jsonc` (adjust origin and SHA on each deploy):

| Var | Initial value |
| --- | --- |
| `APP_ENV` | `production` |
| `APP_ORIGIN` | Your exact https workers.dev or custom domain |
| `RELEASE_ID` | 40 character git SHA (never `local`) |
| `VOICE_ENABLED` | `false` until **DEMO_VOICE** is approved |
| `ACCOUNT_OPERATIONS_ENABLED` | `false` until SMTP and account limiters are verified |

Rules:

- **`APP_ORIGIN`**: exact https URL users open (must match Supabase Site URL and redirect URLs).
- **`RELEASE_ID`**: 40 character git SHA on every production deploy (never `local`).
- **`VOICE_ENABLED`**: `false` for **LIVE**; `true` only for **DEMO_VOICE** when demo activation is approved.
- **`ACCOUNT_OPERATIONS_ENABLED`**: `false` until SMTP and account limiters are verified; then `true` for **ACCOUNTS** and above.

Hourly cron (`0 * * * *`) is already in `wrangler.jsonc` for voice metadata maintenance.

### 2.2 Rate limit bindings

**ACCOUNTS** (account limiters):

| Binding | Period | Limit | Spec |
| --- | --- | --- | --- |
| `ACCOUNT_REQUEST_LIMITER` | 60 s | 10 | 0006 |
| `ACCOUNT_PROJECT_LIMITER` | 60 s | 60 | 0006 |

**DEMO_VOICE** (add voice limiters):

| Binding | Period | Limit | Spec |
| --- | --- | --- | --- |
| `VOICE_REQUEST_LIMITER` | 60 s | 30 | 0008 |
| `VOICE_PROJECT_LIMITER` | 60 s | 120 | 0008 |

In the Cloudflare dashboard, create **separate Rate Limit namespaces**, then attach them in `wrangler.jsonc` under the production env per [Cloudflare rate limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Record namespace ids in `verification/production-target.json`.

Without account limiters, production account routes return **`CONFIG_INVALID`** when `ACCOUNT_OPERATIONS_ENABLED` is true.

### 2.3 Secrets and vars (inventory)

Set **vars** in Wrangler (or dashboard). Set **secrets** via:

```sh
pnpm exec wrangler secret put SUPABASE_URL --env production
pnpm exec wrangler secret put SUPABASE_PUBLIC_KEY --env production
pnpm exec wrangler secret put SUPABASE_ADMIN_KEY --env production
# DEMO_VOICE only:
pnpm exec wrangler secret put ELEVENLABS_API_KEY --env production
pnpm exec wrangler secret put ELEVENLABS_AGENT_ID --env production
pnpm exec wrangler secret put ELEVENLABS_AGENT_VERSION_ID --env production
pnpm exec wrangler secret put VOICE_CONFIG_FINGERPRINT --env production
pnpm exec wrangler secret put VOICE_ACTIVATION_EVIDENCE_ID --env production
```

| Name | Layer | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | BASE | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLIC_KEY` | BASE | Anon/publishable |
| `SUPABASE_ADMIN_KEY` | BASE | Service role, Worker only |
| `ELEVENLABS_API_KEY` | DEMO_VOICE | Worker only |
| `ELEVENLABS_AGENT_ID` | DEMO_VOICE | Pinned agent |
| `ELEVENLABS_AGENT_VERSION_ID` | DEMO_VOICE | Pinned version |
| `VOICE_CONFIG_FINGERPRINT` | DEMO_VOICE | SHA-256 of reviewed `verification/voice-config.json` |
| `VOICE_ACTIVATION_EVIDENCE_ID` | DEMO_VOICE | UUID from `verification/demo-voice-activation.json` |

Never commit secrets. Local equivalents go in gitignored `.dev.vars` (see `.dev.vars.example`).

### 2.4 Build and deploy

**BASE · LIVE**

Profile is fixed at **build** time (`CLOUDFLARE_ENV` during `pnpm build`).

```sh
git checkout <release-branch-or-tag>
export RELEASE_ID="$(git rev-parse HEAD)"

CLOUDFLARE_ENV=production RELEASE_ID="$RELEASE_ID" pnpm build
pnpm exec wrangler deploy --env production
```

After the first deploy, note the real **workers.dev** URL. Update **`APP_ORIGIN`** in Wrangler and **Supabase Auth URLs** to match, then redeploy.

Optional later: custom domain in Cloudflare; keep `APP_ORIGIN` and Supabase in sync.

### 2.5 Post deploy smoke (BASE)

```sh
curl -s "https://<APP_ORIGIN>/api/health" | jq .
curl -s "https://<APP_ORIGIN>/api/config" | jq .
```

Expect `appEnv: "production"`, valid `releaseId`, and for LIVE `voiceEnabled: false` with Supabase public fields populated.

---

## 3. ElevenLabs (demo voice only)

**DEMO_VOICE**

Full GA voice evidence (spec 0008) is separate. Demo voice on production still needs a configured agent and Worker implementation of `production_activation` (spec 0009 build plan).

### 3.1 Account and agent

1. [ElevenLabs](https://elevenlabs.io/) → create an **Agents** agent for English preparation feedback.
2. **Pin an agent version**; record **Agent ID** and **Version ID**.
3. Create an **API key** with Agents access (Worker secret only).
4. Enable **billing alerts** and understand per minute pricing.

### 3.2 Reviewed voice manifest

1. Fill `verification/voice-config.json` per spec 0008 (agent ids, timing bounds, provider snapshots, compatibility dates, etc.). Status must not stay `unconfigured`.
2. Compute **`VOICE_CONFIG_FINGERPRINT`** (canonical JSON hash; see `voiceManifestFingerprint` in `src/worker/voice-configuration.ts` or harness tooling once built).
3. Set Worker secrets to match the manifest.

### 3.3 Demo activation record

Commit `verification/demo-voice-activation.json` (schema in [spec index](./index.md)) with:

- Matching `approvedOrigin`, `approvedReleaseId`, `voiceConfigFingerprint`
- `expiresAt` within thirty days unless renewed
- `activationId` copied to secret `VOICE_ACTIVATION_EVIDENCE_ID`

Set `VOICE_ENABLED=true` and redeploy after the committed demo activation record and secrets match the deployed SHA and voice fingerprint.

---

## 4. Enable layers (order of operations)

### 4.1 Hosted live (LIVE)

1. Complete **BASE** (Supabase, deploy, smoke).
2. Keep `VOICE_ENABLED=false`, `ACCOUNT_OPERATIONS_ENABLED=false`.
3. Sign in as operator established admin (sessions are memory only; reload requires login).
4. Use manual preparation forms if campaigns exist (may require local seeding or future admin flows).

### 4.2 Account email and provisioning (ACCOUNTS)

1. Complete **SMTP** (section 1.4) and **account rate limiters** (section 2.2).
2. Set `ACCOUNT_OPERATIONS_ENABLED=true`, redeploy.
3. Smoke: provision a **synthetic** coach, receive password email, set password, sign in, create campaign assignment, submit manual preparation feedback.
4. Record proof in `docs/releases/` (no secrets or mail bodies).

### 4.3 Demo voice (DEMO_VOICE)

1. Complete **ACCOUNTS** (demo coaches are provisioned accounts).
2. Complete **ElevenLabs** and demo activation record (sections 3.2, 3.3).
3. Add **voice limiters**, voice secrets, `VOICE_ENABLED=true`, redeploy after Worker supports production demo activation.
4. Smoke: one short voice session, apply proposal, save draft. Stay within demo roster cap in activation record.

### 4.4 Full pilot enable (PILOT)

1. Do not onboard **real player identifiable data** until feature 12 deletion procedure is approved and 0003 **enable** phase evidence is recorded.
2. Run `pnpm verify --mode readiness --profile pilot --phase enable --evidence verification/evidence.json` when the harness and evidence file exist.
3. Collect device, privacy, and policy signoffs per specs 0003 and 0008.

---

## 5. Production target manifest

**BASE**

Copy [verification/production-target.example.json](../../../verification/production-target.example.json) to `verification/production-target.json` and replace placeholders with your Worker name, origin, Supabase ref, limiter namespace ids, SMTP provider metadata, `recordedAt`, and `recordedBy`. The harness validates the file when it exists; keep it aligned with Wrangler after each infra change.

---

## 6. Recovery (quick reference)

| Problem | Action |
| --- | --- |
| Bad deploy | Redeploy previous `RELEASE_ID` with same secrets |
| Voice cost spike | `VOICE_ENABLED=false`, redeploy |
| Mail abuse | `ACCOUNT_OPERATIONS_ENABLED=false`, redeploy |
| Wrong Auth links | Fix Supabase Site URL + redirects and Wrangler `APP_ORIGIN`, redeploy |
| Leaked service role | Rotate key in Supabase, update `SUPABASE_ADMIN_KEY`, redeploy |

Do not run destructive SQL rollback without a reviewed procedure. Feedback and journals should remain intact.

---

## 7. What local tests do not prove

| Check | Proves hosted? |
| --- | --- |
| `pnpm check`, `pnpm e2e` (preview) | No (fixture profile) |
| `pnpm test:db`, `pnpm e2e:live` | No (loopback Supabase only) |
| `pnpm dev:voice` | No (local activation record only) |
| Manual smoke on production URL | Yes (for the steps you ran) |

---

## 8. Maintainer checklist (printable)

**BASE**

- [ ] Supabase project created, migrations pushed
- [ ] Production Wrangler env added, first deploy done
- [ ] `APP_ORIGIN` equals Supabase Site URL
- [ ] `/api/health` and `/api/config` OK
- [ ] Operator admin established

**ACCOUNTS**

- [ ] SMTP verified, test mail received
- [ ] Account limiters bound, ids in production target manifest
- [ ] `ACCOUNT_OPERATIONS_ENABLED=true`, synthetic coach mail flow OK

**DEMO_VOICE**

- [ ] ElevenLabs agent pinned, manifest + fingerprint set
- [ ] Demo activation JSON committed, secret `VOICE_ACTIVATION_EVIDENCE_ID` set
- [ ] Voice limiters bound
- [ ] Worker production demo activation verified on production URL
- [ ] `VOICE_ENABLED=true`, voice smoke OK

**PILOT**

- [ ] Enable phase readiness run and policy approvals recorded
- [ ] Feature 12 deletion procedure accepted before real player data

---

When Wrangler binding names, env vars, or manifest fields change in code, the `/develop` task for spec 0009 must update this file in the same change set (AC-12).
