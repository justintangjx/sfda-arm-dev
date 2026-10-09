import type {
  AppEnvironment,
  PublicConfiguration,
} from '../domain/configuration'

export interface ConfigurationBindings {
  APP_ENV?: unknown
  APP_ORIGIN?: unknown
  RELEASE_ID?: unknown
  SUPABASE_URL?: unknown
  SUPABASE_PUBLIC_KEY?: unknown
  VOICE_ENABLED?: unknown
}

export function isAppEnvironment(value: unknown): value is AppEnvironment {
  return value === 'local' || value === 'preview' || value === 'production'
}

export function isReleaseId(value: unknown): value is string {
  return typeof value === 'string' && /^(local|[a-f0-9]{40})$/.test(value)
}

function isOrigin(value: unknown, requireHttps: boolean): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' ||
        (!requireHttps && url.protocol === 'http:')) &&
      !url.username &&
      !url.password &&
      (value === url.origin || value === `${url.origin}/`)
    )
  } catch {
    return false
  }
}

export function readConfiguration(
  env: ConfigurationBindings,
): PublicConfiguration | null {
  if (
    !isAppEnvironment(env.APP_ENV) ||
    !isOrigin(env.APP_ORIGIN, env.APP_ENV === 'production') ||
    !isReleaseId(env.RELEASE_ID) ||
    (env.APP_ENV === 'production' && env.RELEASE_ID === 'local')
  ) {
    return null
  }

  const common = {
    appEnv: env.APP_ENV,
    appOrigin: env.APP_ORIGIN,
    releaseId: env.RELEASE_ID,
  }

  // Preview never returns connection values, even if extra bindings were supplied.
  if (env.APP_ENV === 'preview') {
    return {
      ...common,
      supabaseUrl: null,
      supabasePublicKey: null,
      voiceEnabled: false,
    }
  }

  if (
    !isOrigin(env.SUPABASE_URL, env.APP_ENV === 'production') ||
    typeof env.SUPABASE_PUBLIC_KEY !== 'string' ||
    !env.SUPABASE_PUBLIC_KEY.trim()
  ) {
    return null
  }

  const voice = env.VOICE_ENABLED ?? 'false'
  if (
    voice !== 'true' &&
    voice !== 'false' &&
    voice !== true &&
    voice !== false
  ) {
    return null
  }

  return {
    ...common,
    supabaseUrl: env.SUPABASE_URL,
    supabasePublicKey: env.SUPABASE_PUBLIC_KEY,
    voiceEnabled: voice === 'true' || voice === true,
  }
}
