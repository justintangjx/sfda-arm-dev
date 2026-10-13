import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const local = {
  APP_ENV: 'local',
  APP_ORIGIN: 'http://127.0.0.1:5173',
  RELEASE_ID: 'local',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLIC_KEY: 'synthetic-public',
  SUPABASE_ADMIN_KEY: 'synthetic-service',
  VOICE_ENABLED: 'false',
  ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
}
const limiter = (success: boolean) => ({
  limit: vi.fn(async () => ({ success })),
})
const production = {
  ...local,
  APP_ENV: 'production',
  APP_ORIGIN: 'https://synthetic.example.invalid',
  SUPABASE_URL: 'https://synthetic-supabase.example.invalid',
  RELEASE_ID: 'a'.repeat(40),
}
const recovery = (
  body: unknown,
  origin = local.APP_ORIGIN,
): Parameters<typeof worker.fetch>[0] =>
  new Request(`${origin}/api/accounts/recovery`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {})
afterEach(() => vi.restoreAllMocks())

describe('account release gate (spec 0006, AC-9, AC-12)', () => {
  it('denies preview and an unflagged production before any provider or limiter call', async () => {
    quiet()
    const network = vi.spyOn(globalThis, 'fetch')
    const bindings = {
      ACCOUNT_REQUEST_LIMITER: limiter(true),
      ACCOUNT_PROJECT_LIMITER: limiter(true),
    }
    for (const env of [
      { ...local, APP_ENV: 'preview', ACCOUNT_OPERATIONS_ENABLED: 'true' },
      { ...production, ...bindings },
      { ...production, ...bindings, ACCOUNT_OPERATIONS_ENABLED: 'false' },
    ]) {
      const response = await worker.fetch(
        recovery({ requestId: crypto.randomUUID(), email: 'a@b.invalid' }),
        env,
      )
      expect(response.status).toBe(403)
    }
    expect(network).not.toHaveBeenCalled()
    expect(bindings.ACCOUNT_REQUEST_LIMITER.limit).not.toHaveBeenCalled()
  })

  it('requires both native limiter bindings once production is flagged on', async () => {
    quiet()
    const network = vi.spyOn(globalThis, 'fetch')
    const response = await worker.fetch(
      recovery(
        { requestId: crypto.randomUUID(), email: 'a@b.invalid' },
        production.APP_ORIGIN,
      ),
      {
        ...production,
        ACCOUNT_OPERATIONS_ENABLED: 'true',
        ACCOUNT_REQUEST_LIMITER: limiter(true),
      },
    )
    expect(response.status).toBe(503)
    expect(((await response.json()) as { code: string }).code).toBe(
      'CONFIG_INVALID',
    )
    expect(network).not.toHaveBeenCalled()
  })

  it('returns a fixed retry hint when the native limiter refuses', async () => {
    quiet()
    const network = vi.spyOn(globalThis, 'fetch')
    const response = await worker.fetch(
      recovery(
        { requestId: crypto.randomUUID(), email: 'a@b.invalid' },
        production.APP_ORIGIN,
      ),
      {
        ...production,
        ACCOUNT_OPERATIONS_ENABLED: 'true',
        ACCOUNT_REQUEST_LIMITER: limiter(false),
        ACCOUNT_PROJECT_LIMITER: limiter(true),
      },
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(network).not.toHaveBeenCalled()
  })
})

describe('public recovery responses (spec 0006, AC-5, AC-6)', () => {
  const lookup = (targetId: string | null) =>
    vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).endsWith('/rest/v1/rpc/lookup_recovery_identity')
          ? Response.json({ targetId })
          : Response.json({ code: 'unavailable' }, { status: 503 }),
      )
  const ask = async () => {
    const deferred: Promise<unknown>[] = []
    const response = await worker.fetch(
      recovery({ requestId: crypto.randomUUID(), email: 'a@b.invalid' }),
      local,
      { waitUntil: (work: Promise<unknown>) => void deferred.push(work) },
    )
    const headers = [...response.headers.entries()].filter(
      ([name]) => name !== 'x-request-id',
    )
    return {
      status: response.status,
      body: await response.text(),
      headers,
      deferred,
    }
  }

  it('gives an unknown and an eligible email the same status, body and headers', async () => {
    quiet()
    lookup(null)
    const unknown = await ask()
    vi.restoreAllMocks()
    quiet()
    lookup(crypto.randomUUID())
    const eligible = await ask()
    await Promise.all(eligible.deferred)
    expect(unknown.status).toBe(202)
    expect(eligible.status).toBe(unknown.status)
    expect(eligible.body).toBe(unknown.body)
    expect(eligible.headers).toEqual(unknown.headers)
    expect(unknown.deferred).toHaveLength(0)
    expect(eligible.deferred).toHaveLength(1)
  })

  it('rejects malformed input and reports only a universal lookup failure', async () => {
    quiet()
    const network = vi.spyOn(globalThis, 'fetch')
    for (const body of [
      { requestId: 'not-a-uuid', email: 'a@b.invalid' },
      { requestId: crypto.randomUUID(), email: 'not an email' },
      { requestId: crypto.randomUUID(), email: 'a@b.invalid', extra: 1 },
    ])
      expect((await worker.fetch(recovery(body), local)).status).toBe(422)
    expect(network).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    quiet()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ message: 'synthetic failure' }, { status: 500 }),
    )
    const failed = await worker.fetch(
      recovery({ requestId: crypto.randomUUID(), email: 'a@b.invalid' }),
      local,
    )
    expect(failed.status).toBe(503)
  })

  it('removes the recovery query before asset dispatch and sets private page headers', async () => {
    const assets = vi.fn(
      async (_request: Request) => new Response('<html></html>'),
    )
    const response = await worker.fetch(
      new Request(
        'http://127.0.0.1:5173/auth/recovery?capability=synthetic&token_hash=synthetic-proof',
      ),
      { ...local, ASSETS: { fetch: assets } as unknown as Fetcher },
    )
    expect(
      new URL((assets.mock.calls[0][0] as unknown as Request).url).search,
    ).toBe('')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
