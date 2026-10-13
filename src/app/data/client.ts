import { createClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../../domain/database'
import type { PublicConfiguration } from '../../domain/configuration'

export const createDataClient = (configuration: PublicConfiguration) => {
  if (
    configuration.appEnv === 'preview' ||
    !configuration.supabaseUrl ||
    !configuration.supabasePublicKey
  )
    return undefined
  return createClient<ApplicationDatabase>(
    configuration.supabaseUrl,
    configuration.supabasePublicKey,
    {
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(10000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  )
}
