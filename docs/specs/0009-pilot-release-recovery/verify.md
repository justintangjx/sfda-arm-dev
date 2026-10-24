# 0009. Pilot release and recovery — verification

These steps support acceptance criteria in [index.md](./index.md). They extend the harness; they do not replace operator judgment on a live target.

## Documentation

| Step | Action | Pass signal | AC |
| --- | --- | --- | --- |
| 0 | Read [manual-hosting-setup.md](./manual-hosting-setup.md) for your target layer | Steps match current `wrangler.jsonc` and secrets list | AC-12 |

## Predeploy (hosted live)

| Step | Action | Pass signal | AC |
| --- | --- | --- | --- |
| 1 | Validate `verification/production-target.json` against schema version 1 | Validator accepts; origin is https | AC-1 |
| 2 | Compare manifest project ref to Supabase dashboard | Match | AC-1 |
| 3 | Run foundation check on candidate SHA | Advisory report, no observed failure | AC-2 |
| 4 | Apply migrations to production project | All repo migrations present in history | AC-2 |
| 5 | Deploy Worker with `VOICE_ENABLED=false` | `/api/health` ok, `appEnv=production` | AC-2, AC-3 |
| 6 | Enable account ops only after SMTP and limiter proof | Provision synthetic coach, mail received | AC-3 |
| 7 | Coach submits manual preparation feedback | Draft and submit succeed | AC-3 |

## Demo voice activation

| Step | Action | Pass signal | AC |
| --- | --- | --- | --- |
| 8 | Complete 0008 provider manifest and fingerprint | `verification/voice-config.json` configured | AC-4 |
| 9 | Commit approved `verification/demo-voice-activation.json` | Unexpired, SHA and fingerprint match deploy | AC-4, AC-8 |
| 10 | Deploy with voice limiters, secrets, `VOICE_ENABLED=true` | `/api/config` shows `voiceEnabled: true` | AC-4 |
| 11 | Demo coach starts voice, finishes, applies proposal, saves draft | End to end without fixture metadata | AC-4, AC-5 |
| 12 | Attempt start after `expiresAt` | New start unavailable, manual form works | AC-4, AC-8 |

## Recovery drills

| Step | Action | Pass signal | AC |
| --- | --- | --- | --- |
| 13 | Set `VOICE_ENABLED=false`, redeploy | New voice starts fail closed | AC-7 |
| 14 | Redeploy prior SHA | Health ok, prior behavior restored | AC-7 |
| 15 | Confirm feedback rows unchanged after rollbacks | Counts or spot check | AC-7 |

## Pilot enable (full)

| Step | Action | Pass signal | AC |
| --- | --- | --- | --- |
| 16 | Run `pnpm verify --mode readiness --profile pilot --phase enable` with evidence file | Missing gates listed honestly; no false pass | AC-6, AC-10 |
| 17 | Record real data policy and device evidence per 0003 | Operator signoff referenced in evidence | AC-6 |
| 18 | Block real player onboarding until feature 12 deletion procedure accepted | Documented operator refusal | AC-11 |

## Harness

| Step | Action | Pass signal | AC |
| --- | --- | --- | --- |
| 19 | Production target validator in harness | Invalid manifest fails validation mode | AC-10 |
| 20 | Readiness with demo voice requested | Demo activation treated separately from full voice quality gates | AC-6, AC-10 |

Local database and preview profiles cannot satisfy steps 4 through 12 for production claims. Record dates and SHA in release notes without secrets.
