import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../domain/database.ts'
import {
  isPositiveInteger,
  isUuid,
  readAccess,
  record,
} from '../domain/accounts.js'

export type Client = SupabaseClient<ApplicationDatabase>
export type Functions = ApplicationDatabase['public']['Functions']
export type Result<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>
export type LiveConfiguration = Readonly<{
  appEnv: 'local' | 'production'
  appOrigin: string
  supabaseUrl: string
  supabasePublicKey: string
}>
export type AccountRuntime = Readonly<{
  config: LiveConfiguration
  adminKey: string
  // Work that continues after the response, such as public recovery mail.
  defer: (work: Promise<unknown>) => void
}>
const codes = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_INPUT',
  'CONFIG_INVALID',
  'EMAIL_EXISTS',
  'SETUP_EXISTS',
  'IDEMPOTENCY_CONFLICT',
  'VERSION_CONFLICT',
  'OPERATION_BUSY',
  'RECONCILIATION_REQUIRED',
  'ACCOUNT_DISABLED',
  'ACCOUNT_SETUP_PENDING',
  'LINK_INVALID',
  'ACCOUNT_NOT_READY',
  'EMAIL_COOLDOWN',
  'OUTCOME_UNKNOWN',
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
] as const
const safeCode = (value: unknown) =>
  codes.find((code) => code === value) ?? 'PROVIDER_UNAVAILABLE'
export const fail = (code: string): Result<never> => ({ ok: false, code })
export const success = <T>(value: T): Result<T> => ({ ok: true, value })
export const invoke = async <Name extends keyof Functions>(
  client: Client,
  name: Name,
  args: Functions[Name]['Args'],
): Promise<Result<unknown>> => {
  try {
    const { data, error } = await client.rpc(name, args)
    return error ? fail(safeCode(error.message)) : success(data)
  } catch {
    return fail('PROVIDER_UNAVAILABLE')
  }
}
export const response = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
const statusFor = (code: string) =>
  code === 'AUTH_REQUIRED'
    ? 401
    : code === 'FORBIDDEN'
      ? 403
      : code === 'NOT_FOUND'
        ? 404
        : code === 'INVALID_INPUT' || code === 'LINK_INVALID'
          ? 422
          : code === 'RATE_LIMITED'
            ? 429
            : [
                  'OUTCOME_UNKNOWN',
                  'PROVIDER_UNAVAILABLE',
                  'CONFIG_INVALID',
                ].includes(code)
              ? 503
              : 409
export const failure = (
  code: string,
  requestId: string,
  extra: Readonly<Record<string, unknown>> = {},
) => {
  const result = response({ code, requestId, ...extra }, statusFor(code))
  // A fixed hint, independent of any account cooldown.
  if (code === 'RATE_LIMITED') result.headers.set('Retry-After', '60')
  return result
}
export const client = (
  config: LiveConfiguration,
  key: string,
  token: string | undefined = undefined,
) =>
  createClient<ApplicationDatabase>(config.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  })
export const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
export const digestEmail = (email: string) =>
  sha256(new TextEncoder().encode(email))
export const newCapability = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return { bytes, encoded }
}
export const capabilityDigest = (value: string) =>
  sha256(
    Uint8Array.from(
      atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='),
      (char) => char.charCodeAt(0),
    ),
  )
export const exactKeys = (
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
) => Object.keys(body).every((key) => keys.includes(key))
export const readBody = async (
  request: Request,
): Promise<Result<Record<string, unknown>>> => {
  if (
    !request.headers
      .get('Content-Type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase()
      .includes('application/json')
  )
    return fail('INVALID_INPUT')
  const reader = request.body?.getReader()
  if (!reader) return fail('INVALID_INPUT')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 16384) {
        await reader.cancel()
        return fail('INVALID_INPUT')
      }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const value = record(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
          bytes,
        ),
      ),
    )
    return value ? success(value) : fail('INVALID_INPUT')
  } catch {
    return fail('INVALID_INPUT')
  }
}
export type Actor = Readonly<{ id: string; user: Client; service: Client }>
export const authorize = async (
  request: Request,
  runtime: AccountRuntime,
): Promise<Result<Actor>> => {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16384)
    return fail('AUTH_REQUIRED')
  const token = authorization.slice(7)
  const user = client(runtime.config, runtime.config.supabasePublicKey, token)
  try {
    const identity = await user.auth.getUser(token)
    if (identity.error || !identity.data.user) return fail('AUTH_REQUIRED')
    const access = await invoke(user, 'get_my_access', {})
    if (!access.ok) return access
    const profile = readAccess(access.value)
    if (
      !profile ||
      !profile.enabled ||
      profile.role !== 'admin' ||
      profile.id !== identity.data.user.id
    )
      return fail('FORBIDDEN')
    return success({
      id: profile.id,
      user,
      service: client(runtime.config, runtime.adminKey),
    })
  } catch {
    return fail('PROVIDER_UNAVAILABLE')
  }
}
export const currentAdmin = async (actor: Actor): Promise<Result<true>> => {
  const result = await invoke(actor.user, 'get_my_access', {})
  if (!result.ok) return result
  const profile = readAccess(result.value)
  return profile?.enabled && profile.role === 'admin' && profile.id === actor.id
    ? success(true)
    : fail('FORBIDDEN')
}
export type Page = Readonly<{
  pageSize: number
  cursor: Readonly<{ createdAt: string; id: string }> | null
}>
export const readPage = (url: URL): Result<Page> => {
  const pageSize = url.searchParams.has('pageSize')
    ? Number(url.searchParams.get('pageSize'))
    : 20
  let cursor: unknown = null
  try {
    if (url.searchParams.has('cursor'))
      cursor = JSON.parse(atob(url.searchParams.get('cursor')!))
  } catch {
    return fail('INVALID_INPUT')
  }
  const item = record(cursor)
  if (
    !isPositiveInteger(pageSize) ||
    pageSize > 100 ||
    (cursor !== null &&
      (!item ||
        Object.keys(item).length !== 2 ||
        !isUuid(item.id) ||
        typeof item.createdAt !== 'string'))
  )
    return fail('INVALID_INPUT')
  return success({
    pageSize,
    cursor: item
      ? { createdAt: String(item.createdAt), id: String(item.id) }
      : null,
  })
}
export const pageResponse = (value: unknown) => {
  const data = record(value)
  return response({
    ...data,
    nextCursor: data?.nextCursor ? btoa(JSON.stringify(data.nextCursor)) : null,
  })
}
