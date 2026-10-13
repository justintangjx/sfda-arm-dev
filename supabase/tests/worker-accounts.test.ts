import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAccountRequest } from '../../src/worker/accounts.ts'
import { checked, createFixture, object, type Identity } from './fixture.ts'
import { expireEmailCooldown } from './sql.ts'

afterEach(() => vi.restoreAllMocks())
const requestAs = async (
  actor: Identity,
  body: unknown,
  path = '/api/admin/accounts',
) => {
  const session = await actor.client.auth.getSession()
  if (!session.data.session)
    throw new Error('Synthetic caller session missing.')
  return new Request(`http://127.0.0.1:5173${path}`, {
    method: 'POST',
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.data.session.access_token}`,
    },
    body: JSON.stringify(body),
  })
}
const execute = async (
  request: Request,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) => {
  const response = await handleAccountRequest(
    request,
    {
      appEnv: 'local',
      appOrigin: 'http://127.0.0.1:5173',
      releaseId: 'local',
      supabaseUrl: fixture.url,
      supabasePublicKey: fixture.publicKey,
      voiceEnabled: false,
    },
    { SUPABASE_ADMIN_KEY: process.env.SFDA_TEST_SUPABASE_ADMIN_KEY },
    randomUUID(),
  )
  return { status: response.status, body: object(await response.json()) }
}
const newAccount = () => ({
  mutationId: randomUUID(),
  email: `synthetic-${randomUUID()}@example.invalid`,
  displayName: 'Synthetic Worker coach',
  role: 'coach',
})

describe('Worker orchestration against actual local Auth and database (spec 0005)', () => {
  it('reconciles a lost Auth creation response by planned identity without creating a second user', async () => {
    const fixture = await createFixture()
    const originalFetch = globalThis.fetch
    let creates = 0
    const intercept = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const response = await originalFetch(input, init)
        if (
          String(input).endsWith('/auth/v1/admin/users') &&
          init?.method === 'POST'
        ) {
          creates++
          throw new Error('Synthetic lost creation response.')
        }
        return response
      })
    const body = newAccount()
    const first = await execute(await requestAs(fixture.admin, body), fixture)
    intercept.mockRestore()
    expect(first.status).toBe(202)
    const operation = object(first.body.operation)
    expect(operation.checkpoint).toBe('planned')
    expect(Boolean(operation.accessEnabled)).toBe(false)
    const resumed = await execute(
      await requestAs(
        fixture.secondAdmin,
        { mutationId: randomUUID(), expectedVersion: operation.version },
        `/api/admin/account-operations/${String(operation.id)}/resume`,
      ),
      fixture,
    )
    expect(resumed.status).toBe(200)
    expect(object(resumed.body.operation).checkpoint).toBe('ready')
    expect(creates).toBe(1)
    const replay = await execute(await requestAs(fixture.admin, body), fixture)
    expect(replay.status).toBe(200)
    expect(replay.body.outcome).toBe('already_committed')
    expect(object(replay.body.operation).id === operation.id).toBe(true)
  })

  it('keeps a lost invite acceptance unknown and requires a distinct replacement attempt', async () => {
    const fixture = await createFixture()
    const originalFetch = globalThis.fetch
    let sends = 0
    const intercept = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const response = await originalFetch(input, init)
        if (new URL(String(input)).pathname.endsWith('/auth/v1/invite')) {
          sends++
          throw new Error('Synthetic lost send response.')
        }
        return response
      })
    const body = newAccount()
    const first = await execute(await requestAs(fixture.admin, body), fixture)
    expect(first.status).toBe(202)
    const operation = object(first.body.operation)
    expect(operation.emailAttemptState).toBe('unknown')
    expect(operation.accessEnabled).toBe(false)
    const replay = await execute(await requestAs(fixture.admin, body), fixture)
    expect(replay.status).toBe(202)
    expect(sends).toBe(1)
    intercept.mockRestore()
    await expireEmailCooldown(String(operation.targetId))
    const replacement = await execute(
      await requestAs(
        fixture.secondAdmin,
        { mutationId: randomUUID(), expectedVersion: operation.version },
        `/api/admin/account-operations/${String(operation.id)}/setup-link`,
      ),
      fixture,
    )
    expect(replacement.status).toBe(200)
    const child = object(replacement.body.operation)
    expect(child.id !== operation.id).toBe(true)
    expect(child.checkpoint).toBe('ready')
    expect(child.accessEnabled).toBe(true)
  })

  it('returns an unlinked identity conflict without creating or adopting a profile', async () => {
    const fixture = await createFixture()
    const body = newAccount()
    const existing = await fixture.operator.auth.admin.createUser({
      email: body.email,
      email_confirm: false,
    })
    checked(existing.error)
    const result = await execute(await requestAs(fixture.admin, body), fixture)
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('EMAIL_EXISTS')
    expect(object(result.body.conflict).kind).toBe('auth_identity_unlinked')
    const profile = await fixture.operator
      .from('profiles')
      .select('id')
      .eq('id', existing.data.user!.id)
    checked(profile.error)
    expect(profile.data?.length).toBe(0)
  })
})
