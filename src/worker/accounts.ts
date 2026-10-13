import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../domain/database.ts'
import {
  isPositiveInteger,
  isUuid,
  normalizeEmail,
  readAccess,
  readSetupProof,
  record,
  validPassword,
} from '../domain/accounts.js'
import type { PublicConfiguration } from '../domain/configuration.ts'

type Client = SupabaseClient<ApplicationDatabase>
type Functions = ApplicationDatabase['public']['Functions']
type Result<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>
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
  'OUTCOME_UNKNOWN',
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
] as const
const safeCode = (value: unknown) =>
  codes.find((code) => code === value) ?? 'PROVIDER_UNAVAILABLE'
const fail = (code: string): Result<never> => ({ ok: false, code })
const success = <T>(value: T): Result<T> => ({ ok: true, value })
const invoke = async <Name extends keyof Functions>(
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
const response = (value: unknown, status = 200) =>
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
const failure = (
  code: string,
  requestId: string,
  extra: Readonly<Record<string, unknown>> = {},
) => response({ code, requestId, ...extra }, statusFor(code))
const client = (
  config: PublicConfiguration,
  key: string,
  token: string | undefined = undefined,
) =>
  createClient<ApplicationDatabase>(config.supabaseUrl!, key, {
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
const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
const digestEmail = (email: string) => sha256(new TextEncoder().encode(email))
const newCapability = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return { bytes, encoded }
}
const capabilityDigest = (value: string) =>
  sha256(
    Uint8Array.from(
      atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='),
      (char) => char.charCodeAt(0),
    ),
  )
const exactKeys = (body: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(body).every((key) => keys.includes(key))
const readBody = async (
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

export const accountRoute = (
  method: string,
  path: string,
): string | undefined => {
  if (method === 'POST' && path === '/api/accounts/setup-password')
    return 'account_setup_password'
  if (method === 'POST' && path === '/api/admin/accounts')
    return 'account_create'
  if (method === 'GET' && path === '/api/admin/account-operations')
    return 'account_operations_list'
  const match =
    /^\/api\/admin\/account-operations\/([^/]+)(?:\/(resume|setup-link))?$/.exec(
      path,
    )
  if (!match || !isUuid(match[1])) return undefined
  return method === 'GET' && !match[2]
    ? 'account_operation_read'
    : method === 'POST' && match[2] === 'resume'
      ? 'account_resume'
      : method === 'POST' && match[2] === 'setup-link'
        ? 'account_setup_link'
        : undefined
}

// Temporary process protection. Both buckets discard their client discriminators.
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
const passwordLimiter = createPasswordLimiter()

type PrivateOperation = Readonly<{
  id: string
  parentId: string | undefined
  plannedId: string
  emailFingerprint: string
  checkpoint: string
  attemptState: string
  generation: number
  version: number
  claimId: string | undefined
  attemptId: string | undefined
  attemptGeneration: number | undefined
}>
const privateOperation = (value: unknown): PrivateOperation | undefined => {
  const item = record(value)
  if (
    !item ||
    !isUuid(item.id) ||
    !isUuid(item.planned_auth_id) ||
    typeof item.email_fingerprint !== 'string' ||
    typeof item.checkpoint !== 'string' ||
    typeof item.email_attempt_state !== 'string' ||
    !isPositiveInteger(item.setup_generation) ||
    !isPositiveInteger(item.version) ||
    !(item.claim_id === null || isUuid(item.claim_id)) ||
    !(item.parent_id === null || isUuid(item.parent_id)) ||
    !(item.email_attempt_id === null || isUuid(item.email_attempt_id)) ||
    !(
      item.email_attempt_generation === null ||
      isPositiveInteger(item.email_attempt_generation)
    )
  )
    return undefined
  return {
    id: item.id,
    parentId: item.parent_id ?? undefined,
    plannedId: item.planned_auth_id,
    emailFingerprint: item.email_fingerprint,
    checkpoint: item.checkpoint,
    attemptState: item.email_attempt_state,
    generation: item.setup_generation,
    version: item.version,
    claimId: item.claim_id ?? undefined,
    attemptId: item.email_attempt_id ?? undefined,
    attemptGeneration: item.email_attempt_generation ?? undefined,
  }
}
type Actor = Readonly<{ id: string; user: Client; service: Client }>
const authorize = async (
  request: Request,
  config: PublicConfiguration,
  adminKey: string,
): Promise<Result<Actor>> => {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16384)
    return fail('AUTH_REQUIRED')
  const token = authorization.slice(7)
  const user = client(config, config.supabasePublicKey!, token)
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
    return success({ id: profile.id, user, service: client(config, adminKey) })
  } catch {
    return fail('PROVIDER_UNAVAILABLE')
  }
}
const currentAdmin = async (actor: Actor): Promise<Result<true>> => {
  const result = await invoke(actor.user, 'get_my_access', {})
  if (!result.ok) return result
  const profile = readAccess(result.value)
  return profile?.enabled && profile.role === 'admin' && profile.id === actor.id
    ? success(true)
    : fail('FORBIDDEN')
}
const drive = async (
  actor: Actor,
  operationId: string,
  email: string | undefined,
  config: PublicConfiguration,
): Promise<Result<true>> => {
  let operation: PrivateOperation | undefined
  const load = async (): Promise<Result<true>> => {
    const result = await invoke(actor.service, 'get_worker_account_setup', {
      operation_id: operationId,
      actor_id: actor.id,
    })
    if (!result.ok) return result
    operation = privateOperation(result.value)
    return operation ? success(true) : fail('RECONCILIATION_REQUIRED')
  }
  const renew = async (): Promise<Result<true>> => {
    const access = await currentAdmin(actor)
    if (!access.ok) return access
    if (!operation?.claimId) return fail('OPERATION_BUSY')
    const result = await invoke(actor.service, 'renew_account_setup_claim', {
      operation_id: operation.id,
      actor_id: actor.id,
      claim_id: operation.claimId,
      expected_version: operation.version,
    })
    if (!result.ok) return result
    operation = privateOperation(result.value)
    return operation ? success(true) : fail('RECONCILIATION_REQUIRED')
  }
  const step = async (
    name: string,
    fields: Partial<Functions['record_account_setup_step']['Args']> = {},
  ): Promise<Result<true>> => {
    const fresh = await renew()
    if (!fresh.ok) return fresh
    if (!operation?.claimId) return fail('OPERATION_BUSY')
    const result = await invoke(actor.service, 'record_account_setup_step', {
      operation_id: operation.id,
      actor_id: actor.id,
      claim_id: operation.claimId,
      expected_version: operation.version,
      step: name,
      ...fields,
    })
    if (!result.ok) return result
    operation = privateOperation(result.value)
    return operation ? success(true) : fail('RECONCILIATION_REQUIRED')
  }
  const loaded = await load()
  if (!loaded.ok || !operation) return loaded
  if (operation.checkpoint === 'ready') return success(true)
  const fresh = await renew()
  if (!fresh.ok) return fresh
  const rootId = operation.parentId ?? operation.id
  let authUser = await actor.service.auth.admin.getUserById(operation.plannedId)
  if (
    authUser.error &&
    operation.checkpoint === 'planned' &&
    !operation.parentId &&
    authUser.error.code === 'user_not_found'
  ) {
    if (!email || (await digestEmail(email)) !== operation.emailFingerprint)
      return fail('INVALID_INPUT')
    const creating = await renew()
    if (!creating.ok) return creating
    authUser = await actor.service.auth.admin.createUser({
      id: operation.plannedId,
      email,
      email_confirm: false,
      app_metadata: { sfda_setup_operation_id: rootId },
    })
  }
  if (authUser.error || !authUser.data.user) {
    await step('blocked', { safe_code: 'PROVIDER_UNAVAILABLE' })
    return fail('PROVIDER_UNAVAILABLE')
  }
  const target = authUser.data.user
  const targetEmail = normalizeEmail(target.email)
  if (
    target.id !== operation.plannedId ||
    target.app_metadata.sfda_setup_operation_id !== rootId ||
    !targetEmail ||
    (await digestEmail(targetEmail)) !== operation.emailFingerprint
  ) {
    await step('blocked', { safe_code: 'RECONCILIATION_REQUIRED' })
    return fail('RECONCILIATION_REQUIRED')
  }
  if (operation.checkpoint === 'planned' && !operation.parentId) {
    const recorded = await step('auth_confirmed')
    if (!recorded.ok) return recorded
  }
  if (operation.checkpoint === 'auth_confirmed') {
    const creatingProfile = await renew()
    if (!creatingProfile.ok) return creatingProfile
    const profile = await invoke(actor.user, 'create_account_setup_profile', {
      operation_id: operation.id,
      expected_version: operation.version,
    })
    if (!profile.ok) return profile
    const refreshed = await load()
    if (!refreshed.ok) return refreshed
  }
  if (!operation) return fail('RECONCILIATION_REQUIRED')
  if (operation.attemptState === 'not_started') {
    const sending = await renew()
    if (!sending.ok) return sending
    const verifiedIdentity = await actor.service.auth.admin.getUserById(
      operation.plannedId,
    )
    const verifiedEmail = normalizeEmail(verifiedIdentity.data.user?.email)
    if (
      verifiedIdentity.error ||
      verifiedIdentity.data.user?.app_metadata.sfda_setup_operation_id !==
        rootId ||
      !verifiedEmail ||
      (await digestEmail(verifiedEmail)) !== operation.emailFingerprint
    )
      return fail('RECONCILIATION_REQUIRED')
    const capability = newCapability()
    const started = await step('email_started', {
      capability_digest: await sha256(capability.bytes),
    })
    if (!started.ok) return started
    const dispatching = await renew()
    if (!dispatching.ok) return dispatching
    const redirect = new URL('/auth/setup', config.appOrigin)
    redirect.searchParams.set('operationId', operation.id)
    redirect.searchParams.set('generation', String(operation.generation))
    redirect.searchParams.set('setupCapability', capability.encoded)
    let accepted = false
    let unknown = false
    try {
      if (verifiedIdentity.data.user?.email_confirmed_at) {
        const result = await client(
          config,
          config.supabasePublicKey!,
        ).auth.resetPasswordForEmail(verifiedEmail, {
          redirectTo: redirect.href,
        })
        accepted = !result.error
        unknown = Boolean(
          result.error && (!result.error.status || result.error.status >= 500),
        )
        if (accepted) {
          const observing = await renew()
          if (!observing.ok) return fail('OUTCOME_UNKNOWN')
          const recheck = await actor.service.auth.admin.getUserById(
            operation.plannedId,
          )
          accepted =
            !recheck.error &&
            recheck.data.user?.app_metadata.sfda_setup_operation_id ===
              rootId &&
            normalizeEmail(recheck.data.user?.email) === verifiedEmail
          unknown = !accepted
        }
      } else {
        const result = await actor.service.auth.admin.inviteUserByEmail(
          verifiedEmail,
          { redirectTo: redirect.href },
        )
        accepted = !result.error && result.data.user?.id === operation.plannedId
        unknown = Boolean(
          result.error && (!result.error.status || result.error.status >= 500),
        )
      }
    } catch {
      unknown = true
    }
    const observed = await step(
      accepted ? 'email_accepted' : unknown ? 'email_unknown' : 'email_failed',
      {
        attempt_id: operation.attemptId,
        attempt_generation: operation.attemptGeneration,
      },
    )
    if (!observed.ok) return fail('OUTCOME_UNKNOWN')
    if (!accepted)
      return fail(unknown ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE')
  }
  if (
    operation.attemptState === 'started' ||
    operation.attemptState === 'unknown' ||
    operation.attemptState === 'failed'
  )
    return fail('OUTCOME_UNKNOWN')
  if (operation.attemptState === 'accepted') {
    const completing = await renew()
    if (!completing.ok) return completing
    const completed = await invoke(actor.user, 'complete_account_setup', {
      operation_id: operation.id,
      expected_version: operation.version,
    })
    if (!completed.ok) return completed
  }
  return success(true)
}

const passwordSetup = async (
  request: Request,
  body: Record<string, unknown>,
  config: PublicConfiguration,
  adminKey: string,
  requestId: string,
) => {
  const proof = readSetupProof(body)
  if (
    !exactKeys(body, [
      'operationId',
      'generation',
      'setupCapability',
      'tokenHash',
      'type',
      'password',
    ]) ||
    !proof ||
    !validPassword(body.password)
  )
    return failure('INVALID_INPUT', requestId)
  if (
    !passwordLimiter(
      request.headers.get('CF-Connecting-IP') ?? 'local',
      proof.operationId,
      Date.now(),
    )
  )
    return failure('RATE_LIMITED', requestId)
  const service = client(config, adminKey)
  const digest = await capabilityDigest(proof.setupCapability)
  const args = {
    operation_id: proof.operationId,
    generation: proof.generation,
    capability_digest: digest,
  }
  const context = await invoke(service, 'get_password_setup_context', args)
  if (!context.ok) return failure(context.code, requestId)
  const targetId = record(context.value)?.targetId
  if (!isUuid(targetId)) return failure('LINK_INVALID', requestId)
  const temporary = client(config, config.supabasePublicKey!)
  let updating = false
  try {
    const verified = await temporary.auth.verifyOtp({
      token_hash: proof.tokenHash,
      type: proof.type,
    })
    if (
      verified.error ||
      verified.data.user?.id !== targetId ||
      !verified.data.session
    )
      return failure('LINK_INVALID', requestId)
    const current = await invoke(service, 'get_password_setup_context', args)
    if (!current.ok || record(current.value)?.targetId !== targetId)
      return failure(current.ok ? 'LINK_INVALID' : current.code, requestId)
    updating = true
    const updated = await temporary.auth.updateUser({ password: body.password })
    if (updated.error || updated.data.user?.id !== targetId)
      return failure('OUTCOME_UNKNOWN', requestId)
    const recorded = await invoke(service, 'record_password_setup_result', {
      ...args,
      target_id: targetId,
    })
    return recorded.ok
      ? response({ outcome: 'password_set' })
      : failure('OUTCOME_UNKNOWN', requestId)
  } catch {
    return failure(updating ? 'OUTCOME_UNKNOWN' : 'LINK_INVALID', requestId)
  } finally {
    try {
      await temporary.auth.signOut({ scope: 'local' })
    } catch {
      /* Discard the temporary session regardless. */
    }
  }
}

export const handleAccountRequest = async (
  request: Request,
  config: PublicConfiguration,
  adminKey: unknown,
  requestId: string,
): Promise<Response> => {
  if (config.appEnv !== 'local' || config.appOrigin !== 'http://127.0.0.1:5173')
    return failure('FORBIDDEN', requestId)
  if (
    !config.supabaseUrl ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(
      new URL(config.supabaseUrl).hostname,
    ) ||
    typeof adminKey !== 'string' ||
    !adminKey.trim() ||
    config.voiceEnabled
  )
    return failure('CONFIG_INVALID', requestId)
  const origin = request.headers.get('Origin')
  if (
    (request.method !== 'GET' && origin !== config.appOrigin) ||
    (origin !== null && origin !== config.appOrigin)
  )
    return failure('FORBIDDEN', requestId)
  const url = new URL(request.url)
  const route = accountRoute(request.method, url.pathname)
  if (!route) return failure('NOT_FOUND', requestId)
  const input =
    request.method === 'POST'
      ? await readBody(request)
      : success({} as Record<string, unknown>)
  if (!input.ok) return failure(input.code, requestId)
  if (route === 'account_setup_password')
    return passwordSetup(request, input.value, config, adminKey, requestId)
  const actor = await authorize(request, config, adminKey)
  if (!actor.ok) return failure(actor.code, requestId)
  const body = input.value
  const operationId = url.pathname.split('/')[4]
  if (route === 'account_operation_read' && operationId) {
    const result = await invoke(
      actor.value.user,
      'get_account_setup_progress',
      { operation_id: operationId },
    )
    return result.ok ? response(result.value) : failure(result.code, requestId)
  }
  if (route === 'account_operations_list') {
    const pageSize = url.searchParams.has('pageSize')
      ? Number(url.searchParams.get('pageSize'))
      : 20
    let cursor: unknown = null
    try {
      if (url.searchParams.has('cursor'))
        cursor = JSON.parse(atob(url.searchParams.get('cursor')!))
    } catch {
      return failure('INVALID_INPUT', requestId)
    }
    const item = record(cursor)
    if (
      !isPositiveInteger(pageSize) ||
      pageSize > 100 ||
      (cursor !== null &&
        (!item || !isUuid(item.id) || typeof item.createdAt !== 'string'))
    )
      return failure('INVALID_INPUT', requestId)
    const result = await invoke(
      actor.value.user,
      'list_account_setup_operations',
      {
        page_size: pageSize,
        page_cursor:
          cursor as Functions['list_account_setup_operations']['Args']['page_cursor'],
      },
    )
    if (!result.ok) return failure(result.code, requestId)
    const data = record(result.value)
    return response({
      ...data,
      nextCursor: data?.nextCursor
        ? btoa(JSON.stringify(data.nextCursor))
        : null,
    })
  }
  if (!isUuid(body.mutationId)) return failure('INVALID_INPUT', requestId)
  let intent: Result<unknown>
  let email: string | undefined
  if (route === 'account_create') {
    email = normalizeEmail(body.email)
    const name =
      typeof body.displayName === 'string' ? body.displayName.trim() : ''
    if (
      !exactKeys(body, ['mutationId', 'email', 'displayName', 'role']) ||
      !email ||
      Array.from(name).length < 1 ||
      Array.from(name).length > 160 ||
      (body.role !== 'coach' && body.role !== 'player')
    )
      return failure('INVALID_INPUT', requestId)
    const fingerprint = await digestEmail(email)
    intent = await invoke(actor.value.user, 'begin_account_setup', {
      mutation_id: body.mutationId,
      display_name: name,
      role: body.role,
      email_fingerprint: fingerprint,
    })
    if (
      !intent.ok &&
      (intent.code === 'EMAIL_EXISTS' || intent.code === 'SETUP_EXISTS')
    ) {
      const access = await currentAdmin(actor.value)
      if (!access.ok) return failure(access.code, requestId)
      const lookup = await invoke(
        actor.value.service,
        'lookup_setup_auth_identity',
        { email_fingerprint: fingerprint },
      )
      if (!lookup.ok) return failure(lookup.code, requestId)
      const found = record(lookup.value)
      const conflict =
        intent.code === 'SETUP_EXISTS'
          ? {
              kind: 'existing_operation',
              operationId: found?.operationId,
              version: found?.operationVersion,
            }
          : found?.profile
            ? { kind: 'existing_profile', profile: found.profile }
            : { kind: 'auth_identity_unlinked' }
      return failure(intent.code, requestId, { conflict })
    }
  } else if (operationId && isPositiveInteger(body.expectedVersion)) {
    if (route === 'account_resume') {
      if (
        !exactKeys(body, ['mutationId', 'expectedVersion', 'email']) ||
        (body.email !== undefined && !normalizeEmail(body.email))
      )
        return failure('INVALID_INPUT', requestId)
      email = normalizeEmail(body.email)
      intent = await invoke(actor.value.user, 'claim_account_setup', {
        operation_id: operationId,
        mutation_id: body.mutationId,
        expected_version: body.expectedVersion,
      })
    } else {
      if (!exactKeys(body, ['mutationId', 'expectedVersion']))
        return failure('INVALID_INPUT', requestId)
      intent = await invoke(actor.value.user, 'begin_setup_link_replacement', {
        parent_id: operationId,
        mutation_id: body.mutationId,
        expected_version: body.expectedVersion,
      })
    }
  } else return failure('INVALID_INPUT', requestId)
  if (!intent.ok) return failure(intent.code, requestId)
  const committed = record(intent.value)
  const id = record(committed?.operation)?.id
  if (!isUuid(id)) return failure('RECONCILIATION_REQUIRED', requestId)
  let driving: Result<true> = success(true)
  if (committed?.outcome === 'committed') {
    try {
      driving = await drive(actor.value, id, email, config)
    } catch {
      driving = fail('PROVIDER_UNAVAILABLE')
    }
  }
  const progress = await invoke(
    actor.value.user,
    'get_account_setup_progress',
    { operation_id: id },
  )
  if (!progress.ok)
    return failure(progress.code, requestId, { operationId: id })
  const operation = record(progress.value)
  if (
    !driving.ok &&
    !['OUTCOME_UNKNOWN', 'PROVIDER_UNAVAILABLE'].includes(driving.code)
  )
    return failure(driving.code, requestId, { operationId: id })
  return response(
    {
      operation: progress.value,
      outcome: committed?.outcome,
      ...(!driving.ok ? { code: driving.code, requestId } : {}),
    },
    operation?.checkpoint === 'ready'
      ? committed?.outcome === 'already_committed' || route !== 'account_create'
        ? 200
        : 201
      : 202,
  )
}
