import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const env = {
  APP_ENV: 'preview',
  APP_ORIGIN: 'http://127.0.0.1:5173',
  RELEASE_ID: 'local',
  ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
}

afterEach(() => vi.restoreAllMocks())

describe('Worker API boundary (Node unit checks)', () => {
  it('returns a safe config error when local credentials are absent', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (const path of ['/api/health', '/api/config']) {
      const response = await worker.fetch(
        new Request(`http://127.0.0.1:5173${path}`),
        {
          ...env,
          APP_ENV: 'local',
        },
      )
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({
        code: 'CONFIG_INVALID',
        requestId: expect.any(String),
      })
    }
  })

  it('logs only fixed labels and safe identifiers for an unknown sensitive URL', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await worker.fetch(
      new Request(
        'http://127.0.0.1:5173/api/synthetic-private-name?token=synthetic-secret',
      ),
      { ...env, APP_ENV: 'synthetic-secret', RELEASE_ID: 'synthetic-secret' },
    )
    const error = (await response.json()) as { requestId: string }
    expect(response.status).toBe(404)
    const record = JSON.parse(log.mock.calls[0][0])
    expect(record).toEqual({
      requestId: error.requestId,
      route: 'unmatched',
      status: 404,
      elapsedMs: expect.any(Number),
      appEnv: 'unknown',
      releaseId: 'unknown',
    })
    expect(JSON.stringify(record)).not.toContain('synthetic-')
    expect(error.requestId).toMatch(/^[a-f0-9-]{36}$/)
  })
})
