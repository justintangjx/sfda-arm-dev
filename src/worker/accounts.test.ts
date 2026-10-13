import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import { createPasswordLimiter } from './release'

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
const request = (
  body: unknown,
  origin = 'http://127.0.0.1:5173',
  path = '/api/admin/accounts',
): Parameters<typeof worker.fetch>[0] =>
  new Request(`http://127.0.0.1:5173${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
afterEach(() => vi.restoreAllMocks())
describe('account Worker boundaries (spec 0005, AC-1, AC-4, AC-9, AC-12)', () => {
  it.each(['preview', 'production'])(
    'rejects %s setup before any provider request',
    async (appEnv) => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const network = vi.spyOn(globalThis, 'fetch')
      const env =
        appEnv === 'preview'
          ? { ...local, APP_ENV: appEnv }
          : {
              ...local,
              APP_ENV: appEnv,
              APP_ORIGIN: 'https://synthetic.example.invalid',
              SUPABASE_URL: 'https://synthetic-supabase.example.invalid',
              RELEASE_ID: 'a'.repeat(40),
            }
      const response = await worker.fetch(request({}), env)
      expect(response.status).toBe(403)
      expect(network.mock.calls.length).toBe(0)
    },
  )
  it('denies cross origin requests and anonymous administration before service use', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const network = vi.spyOn(globalThis, 'fetch')
    expect(
      (
        await worker.fetch(
          request({}, 'https://synthetic.example.invalid'),
          local,
        )
      ).status,
    ).toBe(403)
    expect((await worker.fetch(request({}), local)).status).toBe(401)
    expect(network.mock.calls.length).toBe(0)
  })
  it('checks the current database role instead of trusting a verified account alone', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const id = crypto.randomUUID()
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input)
        return Response.json(
          url.endsWith('/auth/v1/user')
            ? { id, aud: 'authenticated', role: 'authenticated' }
            : {
                status: 'present',
                id,
                displayName: 'Synthetic coach',
                role: 'coach',
                enabled: true,
                version: 1,
              },
        )
      })
    const input = request({
      mutationId: crypto.randomUUID(),
      email: 'synthetic@example.invalid',
      displayName: 'Synthetic target',
      role: 'player',
    })
    input.headers.set('Authorization', 'Bearer synthetic-token')
    const response = await worker.fetch(input, local)
    expect(response.status).toBe(403)
    expect(
      network.mock.calls.some(([input]) => String(input).includes('/admin/')),
    ).toBe(false)
  })
  it('bounds password request bodies and excludes proofs from logs', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const network = vi.spyOn(globalThis, 'fetch')
    const secret = crypto.randomUUID()
    const response = await worker.fetch(
      request(
        { password: secret.repeat(1000) },
        undefined,
        '/api/accounts/setup-password',
      ),
      local,
    )
    expect(response.status).toBe(422)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(JSON.stringify(logs.mock.calls).includes(secret)).toBe(false)
    expect(
      JSON.stringify(logs.mock.calls).includes('account_setup_password'),
    ).toBe(true)
    expect(network.mock.calls.length).toBe(0)
  })
  it('removes the setup query before asset dispatch and sets private page headers', async () => {
    const assets = vi.fn(
      async (_request: Request) => new Response('<html></html>'),
    )
    const response = await worker.fetch(
      new Request(
        'http://127.0.0.1:5173/auth/setup?token_hash=synthetic-proof',
      ),
      { ...local, ASSETS: { fetch: assets } as unknown as Fetcher },
    )
    expect(
      new URL((assets.mock.calls[0][0] as unknown as Request).url).search,
    ).toBe('')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('limits both one operation and a burst of different operations', () => {
    const limiter = createPasswordLimiter()
    for (let index = 0; index < 10; index++)
      expect(limiter('synthetic-client', 'same-operation', 0)).toBe(true)
    expect(limiter('synthetic-client', 'same-operation', 0)).toBe(false)
    const global = createPasswordLimiter()
    for (let index = 0; index < 60; index++)
      expect(global('synthetic-client', String(index), 0)).toBe(true)
    expect(global('another-client', 'different-operation', 0)).toBe(false)
    expect(limiter('synthetic-client', 'same-operation', 60000)).toBe(true)
  })
})
