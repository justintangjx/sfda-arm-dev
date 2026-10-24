# Release and recovery notes

Store operator smoke and promotion notes here after each manual production deploy. Do not commit passwords, mail bodies, feedback text, or secrets.

## Template

Copy for each promotion:

```markdown
# Release note · YYYY-MM-DD

**Release ID (git SHA):**
**Activation layer:** hosted live | demo voice | pilot enable
**Operator:**
**Production target manifest recorded:** yes | no

## Checks run

- [ ] `pnpm verify --mode check --profile foundation` on candidate SHA
- [ ] Migrations applied (`supabase db push`)
- [ ] `GET /api/health`
- [ ] `GET /api/config`
- [ ] Synthetic admin sign in (when applicable)
- [ ] Account provision and mail receipt (when account ops enabled)
- [ ] Demo voice start and draft save (when demo voice enabled)

## Recovery exercised

- [ ] Not applicable this release
- [ ] Voice disabled and redeploy verified
- [ ] Account ops disabled and redeploy verified

## Open gates

List any readiness or policy gates still missing for the next layer.
```

See [manual hosting setup](../specs/0009-pilot-release-recovery/manual-hosting-setup.md) and [spec 0009](../specs/0009-pilot-release-recovery/index.md) for full procedures.
