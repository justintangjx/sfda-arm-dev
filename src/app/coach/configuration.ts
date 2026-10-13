import type { PublicConfiguration } from '../../domain/configuration'
import { isObject } from '../../domain/feedback'

export const validatePublicConfiguration = (
  value: unknown,
): PublicConfiguration | undefined => {
  if (
    !isObject(value) ||
    (value.appEnv !== 'local' &&
      value.appEnv !== 'preview' &&
      value.appEnv !== 'production') ||
    typeof value.appOrigin !== 'string' ||
    typeof value.releaseId !== 'string' ||
    typeof value.voiceEnabled !== 'boolean' ||
    !(value.supabaseUrl === null || typeof value.supabaseUrl === 'string') ||
    !(
      value.supabasePublicKey === null ||
      typeof value.supabasePublicKey === 'string'
    )
  )
    return undefined
  if (
    value.appEnv === 'preview' &&
    (value.voiceEnabled ||
      value.supabaseUrl !== null ||
      value.supabasePublicKey !== null)
  )
    return undefined
  return {
    appEnv: value.appEnv,
    appOrigin: value.appOrigin,
    releaseId: value.releaseId,
    supabaseUrl: value.supabaseUrl,
    supabasePublicKey: value.supabasePublicKey,
    voiceEnabled: value.voiceEnabled,
  }
}
