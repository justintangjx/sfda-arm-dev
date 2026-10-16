# Spec 0008 synthesis (arena)

**Date**: 2026-10-14

## Cross-judge

First attempt [Cross-judge voice design candidates](a58285cd-8a00-4aac-aee8-024f1482718b) failed (model usage limit).

Completed retry: [Cross-judge voice arena (retry)](0f0b4390-a83c-4dfb-9fc9-1f53ca105b86) (readonly, rubric in `/tmp/arena-voice/rubric.md`).

| Criterion | A | B |
| --- | ---: | ---: |
| 1. Invariant ownership | 4 | 2 |
| 2. Interface depth | 4 | 3 |
| 3. Fit with existing codebase | 4 | 3 |
| 4. Failure and idempotency | 4 | 3 |
| 5. Implementability and testability now | 4 | 3 |
| 6. Minimal footprint | 3 | 4 |

**Judge recommendation:** Base **A**. Do not port B’s `plan()`, Worker-computed `holdUntil`, or “unmount does not cancel.”

**Grafts from B (judge):**

1. Fail closed before reserve unless microphone release is proved (B’s `assessVoiceConfig` / activation gate pattern).
2. Store `credential_replay` (or equivalent) at claim; closure reads frozen row state, not live manifest `credentialRule` alone.
3. Filing errors: missing or foreign session id → `NOT_FOUND`; ineligibility → `VOICE_CONTEXT_CHANGED`.
4. Allowlisted coach-visible projection (B’s `publicMetadata` idea); never expose dispatch/conversation ids on caller-JWT RPCs.

**Fix on A before / during implementation (judge):**

- Caller-JWT `reserve_voice_session` / `validate_voice_binding` must not return `worker.*` fields.
- `CONFIG_CHANGED` (and similar early returns) must commit pre-step revocation/expiry, not roll back.
- Uncertain issuance → uncertain lifecycle, not local `failed`, unless definite no side effect.
- Cancel during `reserving` must still end the reserved row (`post_end`).
- Emergency disable must still allow read/end/reconcile for outstanding rows (not blanket route block).
- Block manual save/submit while coach has outstanding session (not only UI disable).

**Already addressed in-repo (since sketches):**

- Claim authorisation validation (sketch TODO).
- `list_voice_reconciliation` implementation (sketch `NOT_IMPLEMENTED`).

**Gaps both sketches miss:** admin/coach lock ordering proof; 30-day log field allowlist; filing while outstanding without voice ids.

## Decision

**Base**: [Voice design candidate A (SQL-owned)](24480371-37bb-48f0-b75e-db34f4abedd9).

**Grafts from** [Voice design candidate B (domain-owned)](92d87922-089c-4d60-a061-4d1fb1e73e10):

- Finish user message: call `prepare_feedback_proposal`; leave unsupported sections empty (`src/domain/voice.ts`).
- Judge grafts above (capture gate, projection allowlist, filing error split, frozen closure inputs).

**Rejected as base**: B’s TypeScript `plan()` loop and Worker-written `status` / `hold_until`.

## Implementation note

Migration `20261015000100_voice_sessions.sql` follows candidate A with claim authorisation and reconciliation listing completed locally; judge items above remain for Worker/browser/SQL hardening.
