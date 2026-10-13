import type { PublicConfiguration } from '../domain/configuration.ts'
import {
  fail,
  success,
  type AccountRuntime,
  type Result,
} from './account-http.js'

export interface AccountBindings {
  SUPABASE_ADMIN_KEY?: unknown
  ACCOUNT_OPERATIONS_ENABLED?: unknown
  ACCOUNT_REQUEST_LIMITER?: unknown
  ACCOUNT_PROJECT_LIMITER?: unknown
}
// Email initiation and password proofs use separate fixed classes; reads are not counted.
export type RouteClass = 'read' | 'write' | 'email' | 'proof'
type NativeLimiter = Readonly<{
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}>
const isLimiter = (value: unknown): value is NativeLimiter =>
  typeof (value as NativeLimiter | undefined)?.limit === 'function'
const loopback = (value: string) =>
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)

// Temporary process protection for local mode. Both buckets discard their client discriminators.
export const createPasswordLimiter = () => {
  const buckets = new Map<string, { tokens: number; at: number }>()
  const take = (key: string, capacity: number, now: number) => {
    const prior = buckets.get(key) ?? { tokens: capacity, at: now }
    const tokens = Math.min(
      capacity,
      prior.tokens + ((now - prior.at) * capacity) / 60000,
    )
    buckets.set(key, { tokens: tokens >= 1 ? tokens - 1 : tokens, at: now })
    return tokens >= 1
  }
  return (discriminator: string, operation: string, now: number) => {
    for (const [key, bucket] of buckets)
      if (now - bucket.at > 120000) buckets.delete(key)
    return (
      take('global', 60, now) && take(`${discriminator}:${operation}`, 10, now)
    )
  }
}
const processLimiter = createPasswordLimiter()

const allowed = async (
  request: Request,
  appEnv: 'local' | 'production',
  bindings: AccountBindings,
  routeClass: RouteClass,
) => {
  if (routeClass === 'read') return true
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (appEnv === 'local') return processLimiter(address, routeClass, Date.now())
  const requestLimiter = bindings.ACCOUNT_REQUEST_LIMITER as NativeLimiter
  const projectLimiter = bindings.ACCOUNT_PROJECT_LIMITER as NativeLimiter
  try {
    if (
      !(await requestLimiter.limit({ key: `${routeClass}:${address}` })).success
    )
      return false
    return routeClass === 'write'
      ? true
      : (await projectLimiter.limit({ key: `${appEnv}:${routeClass}` })).success
  } catch {
    return false
  }
}

// The single release gate. The order matters: preview and the production flag are
// decided before any secret, binding or provider is consulted.
export const openAccounts = async (
  request: Request,
  config: PublicConfiguration,
  bindings: AccountBindings,
  routeClass: RouteClass,
  defer: AccountRuntime['defer'],
): Promise<Result<AccountRuntime>> => {
  if (config.appEnv === 'preview') return fail('FORBIDDEN')
  if (config.appEnv === 'production') {
    const flag = bindings.ACCOUNT_OPERATIONS_ENABLED
    if (flag !== 'true' && flag !== true) return fail('FORBIDDEN')
    if (
      !config.appOrigin.startsWith('https://') ||
      !isLimiter(bindings.ACCOUNT_REQUEST_LIMITER) ||
      !isLimiter(bindings.ACCOUNT_PROJECT_LIMITER)
    )
      return fail('CONFIG_INVALID')
  } else if (config.appOrigin !== 'http://127.0.0.1:5173')
    return fail('FORBIDDEN')
  const adminKey = bindings.SUPABASE_ADMIN_KEY
  if (
    !config.supabaseUrl ||
    !config.supabasePublicKey ||
    (config.appEnv === 'local' && !loopback(config.supabaseUrl)) ||
    typeof adminKey !== 'string' ||
    !adminKey.trim() ||
    config.voiceEnabled
  )
    return fail('CONFIG_INVALID')
  const origin = request.headers.get('Origin')
  if (
    (request.method !== 'GET' && origin !== config.appOrigin) ||
    (origin !== null && origin !== config.appOrigin)
  )
    return fail('FORBIDDEN')
  if (!(await allowed(request, config.appEnv, bindings, routeClass)))
    return fail('RATE_LIMITED')
  return success({
    config: {
      appEnv: config.appEnv,
      appOrigin: config.appOrigin,
      supabaseUrl: config.supabaseUrl,
      supabasePublicKey: config.supabasePublicKey,
    },
    adminKey,
    defer,
  })
}
