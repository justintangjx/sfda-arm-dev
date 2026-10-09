import { expect, test } from '@playwright/test'

test('React loads at the root and through a direct SPA navigation', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const path of ['/', '/foundation/route-check']) {
    await page.goto(path)
    await expect(
      page.getByRole('heading', { name: 'SFDA', exact: true }),
    ).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('health and configuration run in the built Worker with preview bindings', async ({
  request,
}) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(health.headers()['cache-control']).toBe('no-store')
  expect(await health.json()).toEqual({
    service: 'sfda-arm',
    appEnv: 'preview',
    releaseId: 'local',
    status: 'ok',
  })

  const config = await request.get('/api/config')
  expect(config.status()).toBe(200)
  expect(config.headers()['cache-control']).toBe('no-store')
  expect(await config.json()).toEqual({
    appEnv: 'preview',
    appOrigin: 'http://127.0.0.1:5173',
    releaseId: 'local',
    supabaseUrl: null,
    supabasePublicKey: null,
    voiceEnabled: false,
  })
})

test('API navigation and unknown methods return JSON without the SPA fallback', async ({
  page,
  request,
}) => {
  for (const path of [
    '/api',
    '/api/not-a-route',
    '/api/accounts',
    '/api/voice/session',
  ]) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(404)
    expect(response?.headers()['content-type']).toContain('application/json')
    expect(response?.headers()['cache-control']).toBe('no-store')
    expect(await response?.json()).toEqual({
      code: 'NOT_FOUND',
      requestId: expect.any(String),
    })
  }
  const response = await request.post('/api/config')
  expect(response.status()).toBe(404)
  expect(await response.json()).toEqual({
    code: 'NOT_FOUND',
    requestId: expect.any(String),
  })
})
