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
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  )
}
