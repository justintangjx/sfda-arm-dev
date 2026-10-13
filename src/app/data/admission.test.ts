import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { AccountSummary } from '../../domain/accounts'
import type { ApplicationDatabase } from '../../domain/database'
import { loadAdmissionCandidates } from './admission'

const account = (
  index: number,
  role: 'coach' | 'player' = 'coach',
): AccountSummary => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  displayName: `Synthetic ${role} ${index}`,
  role,
  enabled: true,
  version: 1,
  createdAt: '2026-10-13T00:00:00Z',
  setupStatus: 'ready',
  passwordInitialized: false,
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

describe('roster admission pagination, synthetic responses (spec 0006, AC-4)', () => {
  it('includes newly provisioned coaches and players after the first 100 accounts', async () => {
    const first = Array.from({ length: 100 }, (_, index) => account(index + 1))
    const coach = account(101)
    const player = account(102, 'player')
    const cursor = { createdAt: first[99]!.createdAt, id: first[99]!.id }
    const requests: unknown[] = []
    const client = simulatedClient(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return Response.json(
        requests.length === 1
          ? { items: first, nextCursor: cursor }
          : { items: [coach, player], nextCursor: null },
      )
    })
    const result = await loadAdmissionCandidates(client)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected the full admission list.')
    expect(result.value).toHaveLength(102)
    expect(result.value.slice(-2)).toEqual([coach, player])
    expect(requests).toEqual([
      {
        name_query: null,
        role_filter: null,
        enabled_filter: true,
        page_cursor: null,
        page_size: 100,
      },
      {
        name_query: null,
        role_filter: null,
        enabled_filter: true,
        page_cursor: cursor,
        page_size: 100,
      },
    ])
  })

  it('continues through pages with no eligible members and excludes incomplete or disabled accounts', async () => {
    const first = { ...account(1), setupStatus: 'pending' }
    const ready = { ...account(2, 'player'), setupStatus: 'not_tracked' }
    const disabled = { ...account(3), enabled: false }
    let calls = 0
    const client = simulatedClient(async () => {
      calls++
      return Response.json(
        calls === 1
          ? {
              items: [first],
              nextCursor: { createdAt: first.createdAt, id: first.id },
            }
          : { items: [ready, disabled], nextCursor: null },
      )
    })
    expect(await loadAdmissionCandidates(client)).toEqual({
      ok: true,
      value: [ready],
    })
    expect(calls).toBe(2)
  })

  it('returns a failure rather than a truncated picker if a later page fails', async () => {
    let calls = 0
    const first = account(1)
    const client = simulatedClient(async () => {
      calls++
      return calls === 1
        ? Response.json({
            items: [first],
            nextCursor: { createdAt: first.createdAt, id: first.id },
          })
        : Response.json(
            { code: 'PT403', message: 'FORBIDDEN' },
            { status: 403 },
          )
    })
    expect(await loadAdmissionCandidates(client)).toMatchObject({
      ok: false,
      code: 'DATABASE_ERROR',
    })
    expect(calls).toBe(2)
  })

  it('stops on a repeated cursor rather than looping indefinitely', async () => {
    let calls = 0
    const first = account(1)
    const client = simulatedClient(async () => {
      calls++
      return Response.json({
        items: [first],
        nextCursor: { createdAt: first.createdAt, id: first.id },
      })
    })
    expect(await loadAdmissionCandidates(client)).toMatchObject({
      ok: false,
      code: 'INVALID_RESPONSE',
    })
    expect(calls).toBe(2)
  })
})
