import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  checked,
  createCampaign,
  createCompetition,
  createFixture,
  object,
  read,
  rejected,
  rpc,
  type Fixture,
  type Identity,
} from './fixture.ts'
import {
  expireEmailCooldown,
  expireRecoveryClaim,
  localSql,
  markPasswordInitialized,
  ownerQuery,
  ownerRejection,
} from './sql.ts'

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
type Person = Identity & Readonly<{ email: string }>
const fingerprint = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
const newDigest = () =>
  createHash('sha256').update(randomBytes(32)).digest('hex')

const person = async (
  fixture: Fixture,
  {
    role = 'coach',
    initialized = true,
    displayName = `Synthetic person ${randomUUID()}`,
  }: Readonly<{
    role?: 'coach' | 'player'
    initialized?: boolean
    displayName?: string
  }> = {},
): Promise<Person> => {
  const email = `synthetic-${randomUUID()}@example.invalid`
  const password = `Synthetic!${randomUUID()}`
  const created = await fixture.operator.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  checked(created.error)
  if (!created.data.user) throw new Error('Synthetic Auth identity missing.')
  const id = created.data.user.id
  await rpc(fixture.admin, 'create_profile', {
    profile_id: id,
    display_name: displayName,
    role,
  })
  await rpc(fixture.admin, 'set_profile_access', {
    profile_id: id,
    enabled: true,
    expected_version: 1,
    reason: 'Synthetic test activation',
  })
  if (initialized) await markPasswordInitialized(id)
  const client = createClient(fixture.url, fixture.publicKey, options)
  checked((await client.auth.signInWithPassword({ email, password })).error)
  return { id, email, client }
}
const service = async (
  fixture: Fixture,
  name: string,
  inputs: Record<string, unknown>,
) => {
  const { data, error } = await fixture.operator.rpc(name, inputs)
  checked(error)
  return object(data)
}
const serviceRejected = async (
  fixture: Fixture,
  name: string,
  inputs: Record<string, unknown>,
  code: string,
) => {
  const { error } = await fixture.operator.rpc(name, inputs)
  expect(error?.message).toBe(code)
}
const readRejected = async (
  identity: Identity,
  name: string,
  inputs: Record<string, unknown>,
  code: string,
) => {
  const { error } = await identity.client.rpc(name, inputs)
  expect(error?.message).toBe(code)
}
const reservePublic = async (fixture: Fixture, target: Person) => {
  const begun = await service(fixture, 'begin_public_recovery', {
    request_id: randomUUID(),
    email_fingerprint: fingerprint(target.email),
    target_id: target.id,
  })
  expect(begun.outcome).toBe('reserved')
  return object(begun.driver)
}
const send = async (
  fixture: Fixture,
  driver: Record<string, unknown>,
  actorId: string | null = null,
  outcome = 'accepted',
) => {
  const capability = newDigest()
  const started = await service(fixture, 'start_recovery_attempt', {
    operation_id: driver.operationId,
    claim_id: driver.claimId,
    expected_version: driver.version,
    capability_digest: capability,
    actor_id: actorId,
  })
  expect(started.started).toBe(true)
  await service(fixture, 'record_recovery_outcome', {
    operation_id: driver.operationId,
    claim_id: driver.claimId,
    attempt_id: started.attemptId,
    outcome,
  })
  return {
    operation_id: driver.operationId,
    revision: driver.revision,
    capability_digest: capability,
  }
}
const audits = async (fixture: Fixture, targetId: string) => {
  const { data, error } = await fixture.operator
    .from('audit_events')
    .select('action,actor_id,reason,metadata')
    .eq('target_id', targetId)
  checked(error)
  return data ?? []
}
const progressOf = (fixture: Fixture, operationId: unknown) =>
  read(fixture.admin, 'admin_get_recovery_operation', {
    operation_id: operationId,
  })

describe('password recovery journal (spec 0006, AC-3, AC-4, AC-6, AC-7, AC-8)', () => {
  it('resolves only eligible identities and keeps public reservations idempotent and cooled down', async () => {
    const fixture = await createFixture()
    const ready = await person(fixture)
    const unready = await person(fixture, { initialized: false })
    const lookup = (email: string) =>
      service(fixture, 'lookup_recovery_identity', {
        email_fingerprint: fingerprint(email),
      })
    expect((await lookup(` ${ready.email.toUpperCase()} `)).targetId).toBe(
      ready.id,
    )
    expect((await lookup(unready.email)).targetId).toBeNull()
    expect(
      (await lookup(`synthetic-${randomUUID()}@example.invalid`)).targetId,
    ).toBeNull()
    const requestId = randomUUID()
    const begin = (targetId: string, request = requestId) =>
      service(fixture, 'begin_public_recovery', {
        request_id: request,
        email_fingerprint: fingerprint(ready.email),
        target_id: targetId,
      })
    const first = await begin(ready.id)
    expect(first.outcome).toBe('reserved')
    expect((await begin(ready.id)).outcome).toBe('replayed')
    expect((await begin(unready.id)).outcome).toBe('ignored')
    expect((await begin(ready.id, randomUUID())).outcome).toBe('cooldown')
    expect(
      (
        await service(fixture, 'begin_public_recovery', {
          request_id: randomUUID(),
          email_fingerprint: fingerprint(ready.email),
          target_id: unready.id,
        })
      ).outcome,
    ).toBe('ignored')
    await serviceRejected(
      fixture,
      'lookup_recovery_identity',
      { email_fingerprint: 'not-a-digest' },
      'INVALID_INPUT',
    )
    expect(
      await audits(fixture, String(object(first.driver).operationId)),
    ).toEqual([])
  })

  it('completes through the current revision once, consumes the link and records revocation separately', async () => {
    const fixture = await createFixture()
    const target = await person(fixture)
    const link = await send(fixture, await reservePublic(fixture, target))
    const context = await service(
      fixture,
      'get_recovery_password_context',
      link,
    )
    expect(context.targetId).toBe(target.id)
    await serviceRejected(
      fixture,
      'get_recovery_password_context',
      { ...link, capability_digest: newDigest() },
      'LINK_INVALID',
    )
    await serviceRejected(
      fixture,
      'get_recovery_password_context',
      { ...link, revision: Number(link.revision) + 1 },
      'LINK_INVALID',
    )
    const changed = await service(fixture, 'record_recovery_password_result', {
      ...link,
      target_id: target.id,
      result: 'password_changed',
    })
    expect(changed).toEqual({ status: 'password_changed', sessions: 'unknown' })
    await serviceRejected(
      fixture,
      'get_recovery_password_context',
      link,
      'LINK_INVALID',
    )
    const revoked = { ...link, target_id: target.id, result: 'refresh_revoked' }
    expect(
      (await service(fixture, 'record_recovery_password_result', revoked))
        .sessions,
    ).toBe('refresh_revoked')
    await service(fixture, 'record_recovery_password_result', revoked)
    const events = await audits(fixture, String(link.operation_id))
    expect(events.map((event) => event.action).sort()).toEqual([
      'password_recovery_completed',
      'password_refresh_sessions_revoked',
    ])
    expect(events.every((event) => event.actor_id === target.id)).toBe(true)
    const progress = await progressOf(fixture, link.operation_id)
    expect(progress.status).toBe('password_changed')
    expect(progress.current).toBe(false)
    expect(JSON.stringify(progress)).not.toContain(link.capability_digest)
    expect(JSON.stringify(progress)).not.toContain('@')
  })

  it('lets a newer link supersede an older one and never restores a link cleared by disablement', async () => {
    const fixture = await createFixture()
    const target = await person(fixture)
    const older = await send(fixture, await reservePublic(fixture, target))
    await expireEmailCooldown(target.id)
    const admin = await rpc(fixture.admin, 'begin_admin_recovery', {
      profile_id: target.id,
      expected_profile_version: 2,
      reason: 'link_missing_or_expired',
    })
    const operation = object(admin.operation)
    await serviceRejected(
      fixture,
      'get_recovery_password_context',
      older,
      'LINK_INVALID',
    )
    const driver = await service(fixture, 'get_worker_recovery_context', {
      operation_id: operation.id,
      actor_id: fixture.admin.id,
    })
    const newer = await send(fixture, driver, fixture.admin.id)
    await service(fixture, 'get_recovery_password_context', newer)
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: target.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic disablement',
    })
    await serviceRejected(
      fixture,
      'get_recovery_password_context',
      newer,
      'LINK_INVALID',
    )
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: target.id,
      enabled: true,
      expected_version: 3,
      reason: 'Synthetic restoration',
    })
    await serviceRejected(
      fixture,
      'get_recovery_password_context',
      newer,
      'LINK_INVALID',
    )
    expect(
      (
        await read(fixture.admin, 'admin_get_account', {
          profile_id: target.id,
        })
      ).currentLinkKind,
    ).toBeNull()
  })

  it('records an expired send claim as an unknown outcome that still honours the issued link', async () => {
    const fixture = await createFixture()
    const target = await person(fixture)
    const driver = await reservePublic(fixture, target)
    const capability = newDigest()
    const started = await service(fixture, 'start_recovery_attempt', {
      operation_id: driver.operationId,
      claim_id: driver.claimId,
      expected_version: driver.version,
      capability_digest: capability,
      actor_id: null,
    })
    await expireRecoveryClaim(String(driver.operationId))
    expect((await progressOf(fixture, driver.operationId)).safeError).toBe(
      'OUTCOME_UNKNOWN',
    )
    const recorded = await service(fixture, 'record_recovery_outcome', {
      operation_id: driver.operationId,
      claim_id: driver.claimId,
      attempt_id: started.attemptId,
      outcome: 'accepted',
    })
    expect(recorded.status).toBe('unknown')
    await serviceRejected(
      fixture,
      'start_recovery_attempt',
      {
        operation_id: driver.operationId,
        claim_id: driver.claimId,
        expected_version: Number(started.version) + 1,
        capability_digest: newDigest(),
        actor_id: null,
      },
      'OPERATION_BUSY',
    )
    await service(fixture, 'get_recovery_password_context', {
      operation_id: driver.operationId,
      revision: driver.revision,
      capability_digest: capability,
    })
  })
})

describe('admin recovery requests (spec 0006, AC-3, AC-6, AC-10)', () => {
  it('commits one receipt and audit, replays exactly, and rejects ineligible or conflicting requests', async () => {
    const fixture = await createFixture()
    const target = await person(fixture)
    const mutationId = randomUUID()
    const inputs = {
      profile_id: target.id,
      expected_profile_version: 2,
      reason: 'requested_by_account_owner',
    }
    const first = await rpc(
      fixture.admin,
      'begin_admin_recovery',
      inputs,
      mutationId,
    )
    expect(first.outcome).toBe('committed')
    const operation = object(first.operation)
    expect(operation.status).toBe('reserved')
    expect(operation.reasonLabel).toBe('Requested by the account owner')
    const replay = await rpc(
      fixture.admin,
      'begin_admin_recovery',
      inputs,
      mutationId,
    )
    expect(replay.outcome).toBe('already_committed')
    expect(object(replay.operation).id).toBe(operation.id)
    await rejected(
      fixture.admin,
      'begin_admin_recovery',
      { ...inputs, reason: 'after_access_restoration' },
      'IDEMPOTENCY_CONFLICT',
      mutationId,
    )
    await rejected(
      fixture.admin,
      'begin_admin_recovery',
      inputs,
      'EMAIL_COOLDOWN',
    )
    await expireEmailCooldown(target.id)
    await rejected(
      fixture.admin,
      'begin_admin_recovery',
      { ...inputs, expected_profile_version: 1 },
      'VERSION_CONFLICT',
    )
    await rejected(
      fixture.admin,
      'begin_admin_recovery',
      { ...inputs, reason: 'free text' },
      'INVALID_INPUT',
    )
    await rejected(fixture.coach, 'begin_admin_recovery', inputs, 'FORBIDDEN')
    const unready = await person(fixture, { initialized: false })
    await rejected(
      fixture.admin,
      'begin_admin_recovery',
      { ...inputs, profile_id: unready.id },
      'ACCOUNT_NOT_READY',
    )
    const disabled = await person(fixture)
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: disabled.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic disablement',
    })
    await rejected(
      fixture.admin,
      'begin_admin_recovery',
      { ...inputs, profile_id: disabled.id, expected_profile_version: 3 },
      'ACCOUNT_DISABLED',
    )
    await serviceRejected(
      fixture,
      'get_worker_recovery_context',
      { operation_id: operation.id, actor_id: fixture.secondAdmin.id },
      'FORBIDDEN',
    )
    const driver = await service(fixture, 'get_worker_recovery_context', {
      operation_id: operation.id,
      actor_id: fixture.admin.id,
    })
    await send(fixture, driver, fixture.admin.id)
    const events = await audits(fixture, String(operation.id))
    expect(events.map((event) => event.action).sort()).toEqual([
      'admin_recovery_requested',
      'recovery_link_requested',
    ])
    expect(
      events.find((event) => event.action === 'admin_recovery_requested')
        ?.reason,
    ).toBe('Requested by the account owner')
    const listed = await read(fixture.admin, 'admin_list_recovery_operations', {
      target_profile_id: target.id,
      page_cursor: null,
      page_size: 20,
    })
    expect(
      (listed.operations as readonly Record<string, unknown>[]).map(
        (item) => item.id,
      ),
    ).toEqual([operation.id])
    await readRejected(
      fixture.coach,
      'admin_get_recovery_operation',
      { operation_id: operation.id },
      'FORBIDDEN',
    )
  })

  it('keeps every journal service function away from signed in callers', async () => {
    const fixture = await createFixture()
    const { error } = await fixture.coach.client.rpc(
      'lookup_recovery_identity',
      {
        email_fingerprint: newDigest(),
      },
    )
    expect(error?.code).toBe('42501')
    expect(
      localSql(`select coalesce(json_agg(p.proname order by p.proname), '[]') from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('lookup_recovery_identity','begin_public_recovery',
          'get_worker_recovery_context','start_recovery_attempt','record_recovery_outcome',
          'get_recovery_password_context','record_recovery_password_result','record_setup_sessions_revoked')
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`),
    ).toEqual([])
  })
})

describe('account directory and maintenance guards (spec 0006, AC-1, AC-2, AC-9)', () => {
  it('searches names literally, filters, pages and finds by email without exposing login email', async () => {
    const fixture = await createFixture()
    const marker = randomUUID()
    const literal = await person(fixture, {
      displayName: `Synthetic 100% ${marker}`,
    })
    await person(fixture, { displayName: `Synthetic 1000 ${marker}` })
    const player = await person(fixture, {
      role: 'player',
      displayName: `Synthetic player ${marker}`,
    })
    const list = (inputs: Record<string, unknown>) =>
      read(fixture.admin, 'admin_list_accounts', {
        name_query: marker,
        role_filter: null,
        enabled_filter: null,
        page_cursor: null,
        page_size: 20,
        ...inputs,
      })
    const ids = (result: Record<string, unknown>) =>
      (result.items as readonly Record<string, unknown>[]).map(
        (item) => item.id,
      )
    expect(ids(await list({ name_query: `100% ${marker}` }))).toEqual([
      literal.id,
    ])
    expect(ids(await list({ role_filter: 'player' }))).toEqual([player.id])
    expect(ids(await list({}))).toHaveLength(3)
    const page = await list({ page_size: 2 })
    expect(ids(page)).toHaveLength(2)
    const next = await list({ page_size: 2, page_cursor: page.nextCursor })
    expect(ids(next)).toHaveLength(1)
    expect(next.nextCursor).toBeNull()
    expect(JSON.stringify([page, next])).not.toContain('@')
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: player.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic disablement',
    })
    expect(ids(await list({ enabled_filter: false }))).toEqual([player.id])
    const found = await read(fixture.admin, 'admin_find_account', {
      email_fingerprint: fingerprint(literal.email),
    })
    expect(object(found.profile).id).toBe(literal.id)
    expect(
      (
        await read(fixture.admin, 'admin_find_account', {
          email_fingerprint: newDigest(),
        })
      ).profile,
    ).toBeNull()
    const detail = await read(fixture.admin, 'admin_get_account', {
      profile_id: literal.id,
    })
    expect(detail.recoveryEligible).toBe(true)
    expect(detail.currentLinkKind).toBeNull()
    expect(object(detail.profile).setupStatus).toBe('not_tracked')
    expect(object(detail.profile).passwordInitialized).toBe(true)
    expect(JSON.stringify(detail)).not.toContain('@')
    await readRejected(
      fixture.coach,
      'admin_list_accounts',
      {
        name_query: null,
        role_filter: null,
        enabled_filter: null,
        page_cursor: null,
        page_size: 20,
      },
      'FORBIDDEN',
    )
    await readRejected(
      fixture.admin,
      'admin_list_accounts',
      { page_cursor: { createdAt: 'bad', id: 'bad' }, page_size: 20 },
      'INVALID_INPUT',
    )
  })

  it('rejects disabled admission while preserving existing membership history', async () => {
    const fixture = await createFixture()
    const coach = await person(fixture)
    const campaignId = await createCampaign(
      fixture,
      await createCompetition(fixture.admin),
      [coach],
      [],
    )
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: coach.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic disablement',
    })
    const outsider = await person(fixture, { role: 'player' })
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: outsider.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic disablement',
    })
    await rejected(
      fixture.admin,
      'set_campaign_player',
      {
        campaign_id: campaignId,
        player_id: outsider.id,
        active: true,
        expected_version: null,
        reason: 'Synthetic roster',
      },
      'ACCOUNT_DISABLED',
    )
    const { data, error } = await fixture.operator
      .from('campaign_coaches')
      .select('is_active')
      .eq('campaign_id', campaignId)
      .eq('coach_id', coach.id)
    checked(error)
    expect(data).toEqual([{ is_active: true }])
  })
})

describe('trusted operator admin procedure (spec 0006, AC-11)', () => {
  const establish =
    'select private.operator_establish_admin($1, $2, $3, $4) as result'
  it('establishes one admin per operation, replays it and refuses unverified identities', async () => {
    const fixture = await createFixture()
    const operationId = randomUUID()
    const created = await fixture.operator.auth.admin.createUser({
      email: `synthetic-${randomUUID()}@example.invalid`,
      password: `Synthetic!${randomUUID()}`,
      email_confirm: true,
      app_metadata: { sfda_admin_bootstrap_operation_id: operationId },
    })
    checked(created.error)
    const id = String(created.data.user?.id)
    const values = [
      operationId,
      id,
      'Synthetic operator admin',
      'Synthetic operator verification',
    ]
    const [first] = await ownerQuery([{ text: establish, values }])
    expect(object(object(first).result).outcome).toBe('committed')
    const [again] = await ownerQuery([{ text: establish, values }])
    expect(object(object(again).result).outcome).toBe('already_committed')
    expect(
      await ownerRejection(establish, [randomUUID(), ...values.slice(1)]),
    ).toBe('RECONCILIATION_REQUIRED')
    const unmarked = await fixture.operator.auth.admin.createUser({
      email: `synthetic-${randomUUID()}@example.invalid`,
      email_confirm: true,
    })
    checked(unmarked.error)
    expect(
      await ownerRejection(establish, [
        operationId,
        String(unmarked.data.user?.id),
        ...values.slice(2),
      ]),
    ).toBe('RECONCILIATION_REQUIRED')
    const { data, error } = await fixture.operator
      .from('audit_events')
      .select('action,mutation_id')
      .eq('target_id', id)
    checked(error)
    expect(data).toEqual([
      { action: 'admin_bootstrapped', mutation_id: operationId },
    ])
    const verify = 'select private.operator_verify_admin($1) as result'
    const [verified] = await ownerQuery([
      { text: verify, values: [fixture.admin.id] },
    ])
    expect(object(object(verified).result).outcome).toBe('verified')
    expect(await ownerRejection(verify, [fixture.coach.id])).toBe(
      'RECONCILIATION_REQUIRED',
    )
    expect(
      localSql(`select coalesce(json_agg(p.proname), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname like 'operator_%'
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('service_role', p.oid, 'execute'))`),
    ).toEqual([])
  })
})
