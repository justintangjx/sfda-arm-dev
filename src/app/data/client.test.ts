import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicConfiguration } from '../../domain/configuration'
import { createDataClient } from './client'

const configuration: PublicConfiguration = {
  appEnv: 'local',
  appOrigin: 'http://127.0.0.1:5173',
  releaseId: 'synthetic',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabasePublicKey: 'synthetic-public-key',
  voiceEnabled: false,
}
afterEach(() => vi.unstubAllGlobals())

describe('caller data client (covers: AC-1, AC-3)', () => {
  it.each([
    { ...configuration, appEnv: 'preview' as const },
    { ...configuration, supabaseUrl: null },
    { ...configuration, supabasePublicKey: null },
    { ...configuration, supabaseUrl: '' },
    { ...configuration, supabasePublicKey: '' },
  ])(
    'does not create a client for preview or incomplete configuration %#',
    (value) => {
      expect(createDataClient(value)).toBeUndefined()
    },
  )

  it.each(['local', 'production'] as const)(
    'keeps a %s login in memory and ignores callback tokens',
    async (appEnv) => {
      const storage = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      }
      vi.stubGlobal('window', {
        localStorage: storage,
        location: {
          href: 'http://127.0.0.1:5173/#access_token=synthetic-untrusted',
        },
      })
      vi.stubGlobal('document', {})
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(
            JSON.stringify({
              access_token: 'synthetic-session-token',
              refresh_token: 'synthetic-refresh-token',
              token_type: 'bearer',
              expires_in: 3600,
              user: {
                id: '00000000-0000-4000-8000-000000000001',
                aud: 'authenticated',
                role: 'authenticated',
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      )
      vi.stubGlobal('fetch', fetch)
      const client = createDataClient({ ...configuration, appEnv })
      if (!client) throw new Error('Expected a configured client.')
      try {
        expect((await client.auth.getSession()).data.session).toBeNull()
        expect(fetch).not.toHaveBeenCalled()
        expect(
          (
            await client.auth.signInWithPassword({
              email: 'synthetic@example.invalid',
              password: 'synthetic',
            })
          ).error,
        ).toBeNull()
        expect(
          (await client.auth.getSession()).data.session?.access_token,
        ).toBe('synthetic-session-token')
        const fresh = createDataClient({ ...configuration, appEnv })
        if (!fresh) throw new Error('Expected another configured client.')
        expect((await fresh.auth.getSession()).data.session).toBeNull()
        fresh.auth.stopAutoRefresh()
        expect(storage.getItem).not.toHaveBeenCalled()
        expect(storage.setItem).not.toHaveBeenCalled()
        expect(storage.removeItem).not.toHaveBeenCalled()
      } finally {
        client.auth.stopAutoRefresh()
      }
    },
  )
})
