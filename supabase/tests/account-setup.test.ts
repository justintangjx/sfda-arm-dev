import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { checked, createFixture, object, rejected, rpc } from './fixture.ts'
import { expireEmailCooldown, ownerQuery } from './sql.ts'

const pendingSetup = async () => {
  const fixture = await createFixture()
  const email = `synthetic-${randomUUID()}@example.invalid`
  const begin = await fixture.admin.client.rpc('begin_account_setup', {
    mutation_id: randomUUID(),
    display_name: 'Synthetic pending coach',
    role: 'coach',
    email_fingerprint: createHash('sha256').update(email).digest('hex'),
  })
  checked(begin.error)
  const id = String(object(object(begin.data).operation).id)
  const current = async (actor = fixture.admin) => {
    const result = await fixture.operator.rpc('get_worker_account_setup', {
      operation_id: id,
      actor_id: actor.id,
    })
    checked(result.error)
    return object(result.data)
  }
  const step = async (
    name: string,
    fields: Record<string, unknown> = {},
    actor = fixture.admin,
  ) => {
    const state = await current(actor)
    const result = await fixture.operator.rpc('record_account_setup_step', {
      operation_id: id,
      actor_id: actor.id,
      claim_id: state.claim_id,
      expected_version: state.version,
      step: name,
      ...fields,
    })
    checked(result.error)
    return object(result.data)
  }
  const planned = await current()
  const created = await fixture.operator.auth.admin.createUser({
    id: String(planned.planned_auth_id),
    email,
    email_confirm: false,
    app_metadata: { sfda_setup_operation_id: id },
  })
  checked(created.error)
  const confirmed = await step('auth_confirmed')
  checked(
    (
      await fixture.admin.client.rpc('create_account_setup_profile', {
        operation_id: id,
        expected_version: confirmed.version,
      })
    ).error,
  )
  return { fixture, id, current, step }
}

const expireClaim = async (id: string) => {
  const database = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
  try {
    await database.connect()
    await database.query(
      "update private.account_setup_operations set claim_until = current_timestamp - interval '1 second', version = version + 1, updated_at = current_timestamp where id = $1",
      [id],
    )
  } catch {
    throw new Error('Synthetic lease expiry injection failed.')
  } finally {
    await database.end()
  }
}

describe('real private account setup transactions (spec 0005)', () => {
  it('preserves an interrupted dispatch as unknown across an expired claim and another admin resume', async () => {
    const setup = await pendingSetup()
    const { fixture, id } = setup
    const started = await setup.step('email_started', {
      capability_digest: createHash('sha256')
        .update(randomBytes(32))
        .digest('hex'),
    })
    await expireClaim(id)
    const args = {
      operation_id: id,
      mutation_id: randomUUID(),
      expected_version: (await setup.current()).version,
    }
    const resumed = await fixture.secondAdmin.client.rpc(
      'claim_account_setup',
      args,
    )
    checked(resumed.error)
    const state = await setup.current(fixture.secondAdmin)
    expect(state.email_attempt_state).toBe('unknown')
    expect(state.email_attempt_id === started.email_attempt_id).toBe(true)
    expect(state.last_resumed_by === fixture.secondAdmin.id).toBe(true)
    const replay = await fixture.secondAdmin.client.rpc(
      'claim_account_setup',
      args,
    )
    checked(replay.error)
    expect(object(replay.data).outcome).toBe('already_committed')
    const forbiddenRestart = await fixture.operator.rpc(
      'record_account_setup_step',
      {
        operation_id: id,
        actor_id: fixture.secondAdmin.id,
        claim_id: state.claim_id,
        expected_version: state.version,
        step: 'email_started',
        capability_digest: createHash('sha256')
          .update(randomBytes(32))
          .digest('hex'),
      },
    )
    expect(forbiddenRestart.error?.message).toBe('RECONCILIATION_REQUIRED')
    const profile = await fixture.operator
      .from('profiles')
      .select('access_enabled')
      .eq('id', String(state.auth_user_id))
      .single()
    checked(profile.error)
    expect(profile.data?.access_enabled).toBe(false)
    expect(object(state.step_references).profile).toBeDefined()
  })

  it('invalidates the old capability immediately on replacement and rejects stale observations and identity drift', async () => {
    const setup = await pendingSetup()
    const { fixture, id } = setup
    const oldDigest = createHash('sha256').update(randomBytes(32)).digest('hex')
    const started = await setup.step('email_started', {
      capability_digest: oldDigest,
    })
    const accepted = await setup.step('email_accepted', {
      attempt_id: started.email_attempt_id,
      attempt_generation: started.email_attempt_generation,
    })
    const completed = await fixture.admin.client.rpc('complete_account_setup', {
      operation_id: id,
      expected_version: accepted.version,
    })
    checked(completed.error)
    const ready = await setup.current()
    const oldContext = {
      operation_id: id,
      generation: started.setup_generation,
      capability_digest: oldDigest,
    }
    checked(
      (await fixture.operator.rpc('get_password_setup_context', oldContext))
        .error,
    )
    const replacementArgs = {
      parent_id: id,
      mutation_id: randomUUID(),
      expected_version: ready.version,
    }
    const cooling = await fixture.secondAdmin.client.rpc(
      'begin_setup_link_replacement',
      { ...replacementArgs, mutation_id: randomUUID() },
    )
    expect(cooling.error?.message).toBe('EMAIL_COOLDOWN')
    await expireEmailCooldown(String(ready.auth_user_id))
    const replacement = await fixture.secondAdmin.client.rpc(
      'begin_setup_link_replacement',
      replacementArgs,
    )
    checked(replacement.error)
    const childId = String(object(object(replacement.data).operation).id)
    expect(childId !== id).toBe(true)
    expect(
      (await fixture.operator.rpc('get_password_setup_context', oldContext))
        .error?.message,
    ).toBe('LINK_INVALID')
    expect(
      (
        await fixture.operator.rpc('get_password_setup_context', {
          ...oldContext,
          generation: Number(started.setup_generation) + 1,
        })
      ).error?.message,
    ).toBe('LINK_INVALID')
    const replay = await fixture.secondAdmin.client.rpc(
      'begin_setup_link_replacement',
      replacementArgs,
    )
    checked(replay.error)
    expect(object(replay.data).outcome).toBe('already_committed')
    const stale = await fixture.operator.rpc('record_account_setup_step', {
      operation_id: id,
      actor_id: fixture.admin.id,
      claim_id: accepted.claim_id,
      expected_version: accepted.version,
      step: 'email_accepted',
      attempt_id: started.email_attempt_id,
      attempt_generation: started.email_attempt_generation,
    })
    expect(Boolean(stale.error)).toBe(true)
    const child = await fixture.operator.rpc('get_worker_account_setup', {
      operation_id: childId,
      actor_id: fixture.secondAdmin.id,
    })
    checked(child.error)
    const state = object(child.data)
    const drift = await fixture.operator.auth.admin.updateUserById(
      String(state.auth_user_id),
      { app_metadata: { sfda_setup_operation_id: randomUUID() } },
    )
    checked(drift.error)
    const send = await fixture.operator.rpc('record_account_setup_step', {
      operation_id: childId,
      actor_id: fixture.secondAdmin.id,
      claim_id: state.claim_id,
      expected_version: state.version,
      step: 'email_started',
      capability_digest: createHash('sha256')
        .update(randomBytes(32))
        .digest('hex'),
    })
    expect(send.error?.message).toBe('RECONCILIATION_REQUIRED')
  })
  it('blocks an already disabled pending profile so its link dies and resume cannot enable it (spec 0006)', async () => {
    const setup = await pendingSetup()
    const { fixture, id } = setup
    const digest = createHash('sha256').update(randomBytes(32)).digest('hex')
    const started = await setup.step('email_started', {
      capability_digest: digest,
    })
    const accepted = await setup.step('email_accepted', {
      attempt_id: started.email_attempt_id,
      attempt_generation: started.email_attempt_generation,
    })
    const targetId = String(accepted.auth_user_id)
    const head = () =>
      ownerQuery([
        {
          text: 'select current_link_kind, setup_operation_id from private.account_password_state where profile_id = $1',
          values: [targetId],
        },
      ])
    expect(await head()).toEqual([
      { current_link_kind: 'setup', setup_operation_id: id },
    ])
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: targetId,
      enabled: false,
      expected_version: 1,
      reason: 'Synthetic pending block',
    })
    const profile = await fixture.operator
      .from('profiles')
      .select('access_enabled,version')
      .eq('id', targetId)
      .single()
    checked(profile.error)
    expect(profile.data).toEqual({ access_enabled: false, version: 2 })
    expect(await head()).toEqual([
      { current_link_kind: null, setup_operation_id: null },
    ])
    expect(
      (
        await fixture.operator.rpc('get_password_setup_context', {
          operation_id: id,
          generation: started.setup_generation,
          capability_digest: digest,
        })
      ).error?.message,
    ).toBe('LINK_INVALID')
    const resumed = await fixture.admin.client.rpc('complete_account_setup', {
      operation_id: id,
      expected_version: accepted.version,
    })
    expect(resumed.error?.message).toBe('RECONCILIATION_REQUIRED')
    const after = await fixture.operator
      .from('profiles')
      .select('access_enabled')
      .eq('id', targetId)
      .single()
    checked(after.error)
    expect(after.data?.access_enabled).toBe(false)
  })

  it('commits the disabled profile and activation atomically, blocks direct enablement, and preserves receipts on replay', async () => {
    const fixture = await createFixture()
    const email = `synthetic-${randomUUID()}@example.invalid`
    const fingerprint = createHash('sha256').update(email).digest('hex')
    const key = randomUUID()
    const beginArgs = {
      mutation_id: key,
      display_name: 'Synthetic setup coach',
      role: 'coach',
      email_fingerprint: fingerprint,
    }
    const begin = await fixture.admin.client.rpc(
      'begin_account_setup',
      beginArgs,
    )
    checked(begin.error)
    const envelope = object(begin.data)
    const progress = object(envelope.operation)
    const id = String(progress.id)
    const current = async () => {
      const result = await fixture.operator.rpc('get_worker_account_setup', {
        operation_id: id,
        actor_id: fixture.admin.id,
      })
      checked(result.error)
      return object(result.data)
    }
    let operation = await current()
    const user = await fixture.operator.auth.admin.createUser({
      id: String(operation.planned_auth_id),
      email,
      email_confirm: false,
      app_metadata: { sfda_setup_operation_id: id },
    })
    checked(user.error)
    const step = async (name: string, fields: Record<string, unknown> = {}) => {
      const result = await fixture.operator.rpc('record_account_setup_step', {
        operation_id: id,
        actor_id: fixture.admin.id,
        claim_id: operation.claim_id,
        expected_version: operation.version,
        step: name,
        ...fields,
      })
      checked(result.error)
      operation = object(result.data)
    }
    await step('auth_confirmed')
    const profile = await fixture.admin.client.rpc(
      'create_account_setup_profile',
      { operation_id: id, expected_version: operation.version },
    )
    checked(profile.error)
    operation = await current()
    const targetId = String(operation.auth_user_id)
    const rows = await fixture.operator
      .from('profiles')
      .select('access_enabled,version')
      .eq('id', targetId)
      .single()
    checked(rows.error)
    expect(rows.data?.access_enabled).toBe(false)
    expect(object(operation.step_references).profile).toBeDefined()
    await rejected(
      fixture.admin,
      'set_profile_access',
      {
        profile_id: targetId,
        enabled: true,
        expected_version: 1,
        reason: 'Synthetic forbidden activation',
      },
      'ACCOUNT_SETUP_PENDING',
    )
    await step('email_started', {
      capability_digest: createHash('sha256')
        .update(randomBytes(32))
        .digest('hex'),
    })
    await step('email_accepted', {
      attempt_id: operation.email_attempt_id,
      attempt_generation: operation.email_attempt_generation,
    })
    const complete = await fixture.admin.client.rpc('complete_account_setup', {
      operation_id: id,
      expected_version: operation.version,
    })
    checked(complete.error)
    const ready = object(object(complete.data).operation)
    expect(ready.checkpoint).toBe('ready')
    expect(ready.accessEnabled).toBe(true)
    const passwordArgs = {
      operation_id: id,
      generation: Number(operation.setup_generation),
      capability_digest: String(operation.setup_capability_digest),
      target_id: targetId,
    }
    const passwordResult = await fixture.operator.rpc(
      'record_password_setup_result',
      passwordArgs,
    )
    checked(passwordResult.error)
    expect(object(passwordResult.data).outcome).toBe('password_set')
    const passwordReplay = await fixture.operator.rpc(
      'record_password_setup_result',
      passwordArgs,
    )
    checked(passwordReplay.error)
    const passwordAudits = await fixture.operator
      .from('audit_events')
      .select('id')
      .eq('actor_id', targetId)
      .eq('mutation_id', String(operation.email_attempt_id))
      .eq('action', 'password_setup_completed')
    checked(passwordAudits.error)
    expect(passwordAudits.data?.length).toBe(1)
    const replay = await fixture.admin.client.rpc(
      'begin_account_setup',
      beginArgs,
    )
    checked(replay.error)
    expect(object(replay.data).outcome).toBe('already_committed')
    expect(object(object(replay.data).operation).id === id).toBe(true)
    const changed = await fixture.admin.client.rpc('begin_account_setup', {
      ...beginArgs,
      role: 'player',
    })
    expect(changed.error?.message).toBe('IDEMPOTENCY_CONFLICT')
    await rpc(fixture.admin, 'set_profile_access', {
      profile_id: targetId,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic subsequent revocation',
    })
    const resumed = await fixture.admin.client.rpc('complete_account_setup', {
      operation_id: id,
      expected_version: Number(ready.version),
    })
    checked(resumed.error)
    expect(object(object(resumed.data).operation).accessEnabled).toBe(false)
    const denied = await fixture.coach.client.rpc(
      'get_account_setup_progress',
      { operation_id: id },
    )
    expect(denied.error?.message).toBe('FORBIDDEN')
    const privateRead = await fixture.admin.client.rpc(
      'get_worker_account_setup',
      { operation_id: id, actor_id: fixture.admin.id },
    )
    expect(Boolean(privateRead.error)).toBe(true)
  })
})
