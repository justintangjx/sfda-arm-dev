import { describe, expect, it } from 'vitest'
import { readConfiguration, type ConfigurationBindings } from './configuration'

const local: ConfigurationBindings = {
  APP_ENV: 'local',
  APP_ORIGIN: 'http://127.0.0.1:5173',
  RELEASE_ID: 'local',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLIC_KEY: 'synthetic-public-key',
}

describe('configuration boundary', () => {
  it('uses the explicit bindings and defaults voice to false', () => {
    expect(readConfiguration(local)).toEqual({
      appEnv: 'local',
      appOrigin: local.APP_ORIGIN,
      releaseId: 'local',
      supabaseUrl: local.SUPABASE_URL,
      supabasePublicKey: local.SUPABASE_PUBLIC_KEY,
      voiceEnabled: false,
    })
  })

  it('uses production values rather than local defaults', () => {
    const config = readConfiguration({
      ...local,
      APP_ENV: 'production',
      APP_ORIGIN: 'https://synthetic.example',
      RELEASE_ID: 'a'.repeat(40),
      SUPABASE_URL: 'https://synthetic.supabase.example',
      VOICE_ENABLED: 'true',
    })
    expect(config).toMatchObject({
      appEnv: 'production',
      appOrigin: 'https://synthetic.example',
      releaseId: 'a'.repeat(40),
      supabaseUrl: 'https://synthetic.supabase.example',
      voiceEnabled: true,
    })
  })

  it('returns only public fields when a live profile has server secrets', () => {
    const config = readConfiguration({
      ...local,
      SUPABASE_ADMIN_KEY: 'synthetic-admin-secret',
      ELEVENLABS_API_KEY: 'synthetic-provider-secret',
    } as ConfigurationBindings)
    expect(Object.keys(config!)).toEqual([
      'appEnv',
      'appOrigin',
      'releaseId',
      'supabaseUrl',
      'supabasePublicKey',
      'voiceEnabled',
    ])
    expect(JSON.stringify(config)).not.toContain('synthetic-admin-secret')
    expect(JSON.stringify(config)).not.toContain('synthetic-provider-secret')
  })

  it.each(['SUPABASE_URL', 'SUPABASE_PUBLIC_KEY'] as const)(
    'rejects missing %s in a live profile without choosing preview',
    (key) => {
      expect(readConfiguration({ ...local, [key]: undefined })).toBeNull()
    },
  )

  it('strips connection values and secrets from an explicit preview', () => {
    const config = readConfiguration({
      ...local,
      APP_ENV: 'preview',
      VOICE_ENABLED: 'true',
      SUPABASE_ADMIN_KEY: 'synthetic-admin-secret',
      ELEVENLABS_API_KEY: 'synthetic-provider-secret',
    } as ConfigurationBindings)
    expect(config).toEqual({
      appEnv: 'preview',
      appOrigin: local.APP_ORIGIN,
      releaseId: 'local',
      supabaseUrl: null,
      supabasePublicKey: null,
      voiceEnabled: false,
    })
  })

  it.each([
    { APP_ENV: undefined },
    { APP_ENV: 'staging' },
    { APP_ORIGIN: 'https://synthetic.example/path' },
    { APP_ORIGIN: 'https://user:secret@synthetic.example' },
    { APP_ORIGIN: 'not-a-url' },
    { RELEASE_ID: undefined },
    { RELEASE_ID: 'synthetic-secret' },
    { SUPABASE_URL: 'not-a-url' },
    { SUPABASE_PUBLIC_KEY: '  ' },
    { VOICE_ENABLED: 'yes' },
    { APP_ENV: 'production' },
  ])('rejects invalid settings: %j', (overrides) => {
    expect(readConfiguration({ ...local, ...overrides })).toBeNull()
  })
})
