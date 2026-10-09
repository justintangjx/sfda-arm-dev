import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { ApplicationDatabase } from '../../domain/database.ts'
import { executeMutation, prepareMutation } from './mutations.ts'

const request = () =>
  prepareMutation('create_competition', {
    name: 'Synthetic retry test',
    starts_on: null,
    ends_on: null,
  })
const simulatedClient = (fetch: typeof globalThis.fetch) =>
  createClient<ApplicationDatabase>(
    'http://127.0.0.1:54321',
    'synthetic-public-placeholder',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch },
    },
  )

describe('SDK retry policy, synthetic network simulation', () => {
  it('makes at most three attempts with the same snapshot and identifier (covers: AC-12)', async () => {
    const bodies: unknown[] = []
    const waits: number[] = []
    const client = simulatedClient(async (_url, init) => {
      bodies.push(init?.body)
      throw new TypeError('Synthetic network failure')
    })
    const pending = request()
    expect(
      await executeMutation(client, pending, async (milliseconds) => {
        waits.push(milliseconds)
      }),
    ).toEqual({
      ok: false,
      code: 'NETWORK_ERROR',
      requestId: pending.inputs.mutation_id,
    })
    expect(bodies).toHaveLength(3)
    expect(new Set(bodies).size).toBe(1)
    expect(waits).toEqual([250, 500])
  })
  it('does not retry a state conflict and discards raw provider details (covers: AC-12, AC-15)', async () => {
    let calls = 0
    const client = simulatedClient(async () => {
      calls++
      return new Response(
        JSON.stringify({
          code: 'PT409',
          message: 'VERSION_CONFLICT',
          details: 'Synthetic private detail',
          hint: 'Synthetic private hint',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      )
    })
    const pending = request()
    expect(await executeMutation(client, pending)).toEqual({
      ok: false,
      code: 'VERSION_CONFLICT',
      requestId: pending.inputs.mutation_id,
    })
    expect(calls).toBe(1)
  })
})

describe('mutation snapshots and responses (covers: AC-12, AC-15)', () => {
  const success = (mutationId: string, outcome = 'committed') => ({
    outcome,
    mutationId,
    result: {
      type: 'competition',
      id: '00000000-0000-4000-8000-000000000001',
      version: 1,
      exists: true,
      metadata: {},
    },
  })
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('creates a fresh identifier and copies nested reviewed text once', () => {
    const inputs = {
      campaign_id: '00000000-0000-4000-8000-000000000001',
      player_id: '00000000-0000-4000-8000-000000000002',
      kind: 'preparation' as const,
      content: {
        observations: 'Synthetic reviewed snapshot',
        strengths: null,
        development_focus: null,
        observed_on: '2026-01-01',
      },
      review_confirmed: true,
      draft_id: null,
      expected_version: null,
    }
    const pending = prepareMutation('submit_feedback', inputs)
    const another = prepareMutation('submit_feedback', inputs)
    inputs.content.observations = 'Synthetic later edit'
    expect(pending.inputs.content).toMatchObject({
      observations: 'Synthetic reviewed snapshot',
    })
    expect(pending.inputs.mutation_id).not.toBe(another.inputs.mutation_id)
    expect(pending.inputs.mutation_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each(['committed', 'already_committed'])(
    'returns the validated %s result',
    async (outcome) => {
      const pending = request()
      const value = success(pending.inputs.mutation_id, outcome)
      expect(
        await executeMutation(
          simulatedClient(async () => json(value)),
          pending,
        ),
      ).toEqual({ ok: true, value })
    },
  )

  it.each(['40P01', '40001'])(
    'retries %s with the original snapshot and delays',
    async (code) => {
      const pending = request()
      const bodies: unknown[] = []
      const waits: number[] = []
      const client = simulatedClient(async (_url, init) => {
        bodies.push(init?.body)
        return bodies.length < 3
          ? json({ code, message: 'Synthetic transient failure' }, 500)
          : json(success(pending.inputs.mutation_id))
      })
      const response = await executeMutation(
        client,
        pending,
        async (milliseconds) => {
          waits.push(milliseconds)
          // Caller edits during a retry cannot change the already pending action.
          Object.assign(pending.inputs, { name: 'Synthetic later edit' })
        },
      )
      expect(response.ok).toBe(true)
      expect(waits).toEqual([250, 500])
      expect(bodies).toHaveLength(3)
      expect(new Set(bodies).size).toBe(1)
      expect(JSON.parse(String(bodies[0])).name).toBe('Synthetic retry test')
    },
  )

  it.each([
    'AUTH_REQUIRED',
    'FORBIDDEN',
    'INVALID_INPUT',
    'NOT_FOUND',
    'PAIR_CONFLICT',
    'STAGE_CLOSED',
    'ALREADY_SUBMITTED',
    'IDEMPOTENCY_CONFLICT',
  ])('does not retry %s', async (message) => {
    const pending = request()
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(
        { code: 'PT409', message, details: 'Synthetic private detail' },
        409,
      ),
    )
    const wait = vi.fn(async () => {})
    expect(
      await executeMutation(simulatedClient(fetch), pending, wait),
    ).toEqual({
      ok: false,
      code: message,
      requestId: pending.inputs.mutation_id,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('stops after the retry bound and hides an unknown database error', async () => {
    const pending = request()
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(
        { code: '40001', message: 'Synthetic SQL and private content' },
        500,
      ),
    )
    const wait = vi.fn(async () => {})
    expect(
      await executeMutation(simulatedClient(fetch), pending, wait),
    ).toEqual({
      ok: false,
      code: 'DATABASE_ERROR',
      requestId: pending.inputs.mutation_id,
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toHaveLength(2)
  })

  it.each([
    null,
    {},
    [],
    { outcome: 'committed', mutationId: 'bad', result: {} },
  ])('rejects malformed successful response %# without retry', async (data) => {
    const pending = request()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(data))
    expect(await executeMutation(simulatedClient(fetch), pending)).toEqual({
      ok: false,
      code: 'INVALID_RESPONSE',
      requestId: pending.inputs.mutation_id,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a successful response belonging to another request', async () => {
    const pending = request()
    expect(
      await executeMutation(
        simulatedClient(async () => json(success(crypto.randomUUID()))),
        pending,
      ),
    ).toEqual({
      ok: false,
      code: 'INVALID_RESPONSE',
      requestId: pending.inputs.mutation_id,
    })
  })

  it.each([
    new Error('Synthetic private exception'),
    new TypeError('Synthetic transport exception'),
  ])('handles an exception from the SDK boundary %# safely', async (error) => {
    const pending = request()
    const client = simulatedClient(async () => json(null))
    const rpc = vi.spyOn(client, 'rpc').mockImplementation(() => {
      throw error
    })
    const wait = vi.fn(async () => {})
    expect(await executeMutation(client, pending, wait)).toEqual({
      ok: false,
      code: error instanceof TypeError ? 'NETWORK_ERROR' : 'DATABASE_ERROR',
      requestId: pending.inputs.mutation_id,
    })
    expect(rpc).toHaveBeenCalledTimes(error instanceof TypeError ? 3 : 1)
  })
})
