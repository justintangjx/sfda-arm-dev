import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  passwordLinkBody,
  readPasswordLinkUrl,
} from '../../src/domain/accounts.ts'
import { handleAccountRequest } from '../../src/worker/accounts.ts'
import {
  checked,
  createFixture,
  object,
  rejected,
  rpc,
  type Fixture,
  type Identity,
} from './fixture.ts'
import { mailCapture } from './mail.ts'
import { markPasswordInitialized } from './sql.ts'

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const origin = 'http://127.0.0.1:5173'
type Person = Identity & Readonly<{ email: string; password: string }>
const person = async (
  fixture: Fixture,
  initialized = true,
): Promise<Person> => {
  const email = `synthetic-${randomUUID()}@example.invalid`
  const password = `Synthetic!${randomUUID()}`
  const created = await fixture.operator.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  checked(created.error)
  const id = String(created.data.user?.id)
  await rpc(fixture.admin, 'create_profile', {
    profile_id: id,
    display_name: 'Synthetic recovery coach',
    role: 'coach',
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
  return { id, email, password, client }
}
const request = async (
  path: string,
  body?: unknown,
  actor?: Identity,
): Promise<Request> => {
  const session = actor && (await actor.client.auth.getSession()).data.session
  if (actor && !session) throw new Error('Synthetic caller session missing.')
  return new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const execute = async (fixture: Fixture, input: Request) => {
  const deferred: Promise<unknown>[] = []
  const response = await handleAccountRequest(
    input,
    {
      appEnv: 'local',
      appOrigin: origin,
      releaseId: 'local',
      supabaseUrl: fixture.url,
      supabasePublicKey: fixture.publicKey,
      voiceEnabled: false,
    },
    { SUPABASE_ADMIN_KEY: process.env.SFDA_TEST_SUPABASE_ADMIN_KEY },
    randomUUID(),
    (work) => deferred.push(work),
  )
  const text = await response.text()
  await Promise.all(deferred)
  return {
    status: response.status,
    headers: response.headers,
    body: object(JSON.parse(text)),
  }
}
const newPassword = () => `Synthetic!${randomUUID()}`

describe('recovery through the Worker against local Auth and mail capture (spec 0006, AC-3, AC-5, AC-7)', () => {
  it('sends one recovery link whose completion changes the password and revokes refresh sessions', async () => {
    const fixture = await createFixture()
    const mail = mailCapture()
    const target = await person(fixture)
    await mail.clear(await mail.list(target.email))
    try {
      const accepted = await execute(
        fixture,
        await request('/api/accounts/recovery', {
          requestId: randomUUID(),
          email: target.email.toUpperCase(),
        }),
      )
      expect(accepted.status).toBe(202)
      expect(accepted.body).toEqual({ outcome: 'check_email' })
      expect(accepted.headers.get('Cache-Control')).toBe('no-store')
      const messages = await mail.list(target.email)
      expect(messages).toHaveLength(1)
      const url = await mail.link(String(messages[0]))
      expect(url.origin).toBe(origin)
      expect(url.pathname).toBe('/auth/recovery')
      expect(url.hash).toBe('')
      const link = readPasswordLinkUrl(url)
      if (!link) throw new Error('The recovery email has no valid link.')
      expect(link.kind).toBe('recovery')
      const password = newPassword()
      const completed = await execute(
        fixture,
        await request(
          '/api/accounts/recovery-password',
          passwordLinkBody(link, password),
        ),
      )
      expect(completed.status).toBe(200)
      expect(completed.body).toEqual({
        outcome: 'password_changed',
        sessions: 'refresh_revoked',
      })
      expect((await target.client.auth.refreshSession()).error).not.toBeNull()
      const fresh = createClient(fixture.url, fixture.publicKey, options)
      expect(
        (
          await fresh.auth.signInWithPassword({
            email: target.email,
            password: target.password,
          })
        ).error,
      ).not.toBeNull()
      checked(
        (await fresh.auth.signInWithPassword({ email: target.email, password }))
          .error,
      )
      const reused = await execute(
        fixture,
        await request(
          '/api/accounts/recovery-password',
          passwordLinkBody(link, newPassword()),
        ),
      )
      expect(reused.body.code).toBe('LINK_INVALID')
      const setupShape = await execute(
        fixture,
        await request('/api/accounts/setup-password', {
          ...passwordLinkBody(link, newPassword()),
        }),
      )
      expect(setupShape.body.code).toBe('INVALID_INPUT')
    } finally {
      await mail.clear(await mail.list(target.email))
    }
  })

  it('returns the identical acknowledgment for unknown, ineligible and cooled down requests without mail', async () => {
    const fixture = await createFixture()
    const mail = mailCapture()
    const unready = await person(fixture, false)
    const unknown = `synthetic-${randomUUID()}@example.invalid`
    const ready = await person(fixture)
    await mail.clear(await mail.list(ready.email))
    try {
      const ask = async (email: string) =>
        execute(
          fixture,
          await request('/api/accounts/recovery', {
            requestId: randomUUID(),
            email,
          }),
        )
      const results = []
      for (const email of [unknown, unready.email, ready.email, ready.email])
        results.push(await ask(email))
      expect(results.map(({ status, body }) => ({ status, body }))).toEqual(
        Array.from({ length: 4 }, () => ({
          status: 202,
          body: { outcome: 'check_email' },
        })),
      )
      expect(await mail.list(unready.email)).toHaveLength(0)
      expect(await mail.list(ready.email)).toHaveLength(1)
      const invalid = await execute(
        fixture,
        await request('/api/accounts/recovery', {
          requestId: randomUUID(),
          email: ready.email,
          extra: true,
        }),
      )
      expect(invalid.status).toBe(422)
    } finally {
      await mail.clear([
        ...(await mail.list(ready.email)),
        ...(await mail.list(unready.email)),
      ])
    }
  })

  it('lets an admin find an account, read its login email and send one cooled down recovery link', async () => {
    const fixture = await createFixture()
    const mail = mailCapture()
    const target = await person(fixture)
    await mail.clear(await mail.list(target.email))
    try {
      const found = await execute(
        fixture,
        await request(
          '/api/admin/accounts/lookup',
          { email: ` ${target.email.toUpperCase()} ` },
          fixture.admin,
        ),
      )
      expect(found.body.outcome).toBe('found')
      expect(object(found.body.profile).id).toBe(target.id)
      expect(JSON.stringify(found.body)).not.toContain('@')
      const detail = await execute(
        fixture,
        await request(
          `/api/admin/accounts/${target.id}`,
          undefined,
          fixture.admin,
        ),
      )
      expect(detail.body.loginEmail).toBe(target.email)
      expect(detail.body.recoveryEligible).toBe(true)
      const coachDetail = await execute(
        fixture,
        await request(
          `/api/admin/accounts/${target.id}`,
          undefined,
          fixture.coach,
        ),
      )
      expect(coachDetail.body.code).toBe('FORBIDDEN')
      const body = {
        mutationId: randomUUID(),
        expectedProfileVersion: 2,
        reason: 'link_missing_or_expired',
      }
      const sent = await execute(
        fixture,
        await request(
          `/api/admin/accounts/${target.id}/recovery`,
          body,
          fixture.admin,
        ),
      )
      expect(sent.status).toBe(201)
      const operation = object(sent.body.operation)
      expect(operation.status).toBe('accepted')
      expect(operation.current).toBe(true)
      const replay = await execute(
        fixture,
        await request(
          `/api/admin/accounts/${target.id}/recovery`,
          body,
          fixture.admin,
        ),
      )
      expect(replay.status).toBe(200)
      expect(replay.body.outcome).toBe('already_committed')
      const again = await execute(
        fixture,
        await request(
          `/api/admin/accounts/${target.id}/recovery`,
          { ...body, mutationId: randomUUID() },
          fixture.admin,
        ),
      )
      expect(again.body.code).toBe('EMAIL_COOLDOWN')
      expect(await mail.list(target.email)).toHaveLength(1)
      const listed = await execute(
        fixture,
        await request(
          `/api/admin/recovery-operations?targetProfileId=${target.id}`,
          undefined,
          fixture.admin,
        ),
      )
      expect(
        (listed.body.operations as readonly Record<string, unknown>[]).map(
          (item) => item.id,
        ),
      ).toEqual([operation.id])
    } finally {
      await mail.clear(await mail.list(target.email))
    }
  })

  it('keeps an unfinished setup account out of name edits and roster admission', async () => {
    const fixture = await createFixture()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      if (new URL(String(input)).pathname.endsWith('/auth/v1/invite'))
        throw new Error('Synthetic lost send response.')
      return response
    }
    let operation: Record<string, unknown>
    try {
      const created = await execute(
        fixture,
        await request(
          '/api/admin/accounts',
          {
            mutationId: randomUUID(),
            email: `synthetic-${randomUUID()}@example.invalid`,
            displayName: 'Synthetic pending coach',
            role: 'coach',
          },
          fixture.admin,
        ),
      )
      operation = object(created.body.operation)
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(operation.checkpoint).not.toBe('ready')
    const targetId = String(operation.targetId)
    await rejected(
      fixture.admin,
      'update_profile_name',
      {
        profile_id: targetId,
        display_name: 'Synthetic renamed coach',
        expected_version: 1,
        reason: 'Synthetic correction',
      },
      'ACCOUNT_SETUP_PENDING',
    )
    const detail = await execute(
      fixture,
      await request(
        `/api/admin/accounts/${targetId}`,
        undefined,
        fixture.admin,
      ),
    )
    expect(object(detail.body.profile).setupStatus).toBe('needs_reconciliation')
    expect(detail.body.loginEmail).toBeNull()
    expect(detail.body.recoveryEligible).toBe(false)
  })
})
