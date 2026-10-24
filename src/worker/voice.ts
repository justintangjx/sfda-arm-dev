import type { PublicConfiguration } from '../domain/configuration'
import { readAccess } from '../domain/accounts'
import { isObject, isUuid } from '../domain/feedback'
import type { Json } from '../domain/database.types'
import {
  isEmptyProposal,
  isVoiceErrorCode,
  parseToolArguments,
  parseVoiceSession,
  voiceHttpStatus,
  type VoiceErrorCode,
} from '../domain/voice'
import { client, type Client, type Functions } from './account-http'
import {
  databaseVoiceConfig,
  readVoiceManifest,
  voiceAuthorisation,
  type VoiceBindings,
} from './voice-configuration'
import manifestValue from '../../verification/voice-config.json'
import {
  observeVoiceProvider,
  issueVoiceCredential,
  verifyProviderConfiguration,
} from './voice-provider'

export const voiceRoute = (
  method: string,
  path: string,
): string | undefined => {
  if (method === 'POST' && path === '/api/voice/sessions') return 'voice_start'
  if (
    !/^\/api\/voice\/sessions\/[0-9a-f-]{36}(\/(connected|finish|proposal|end))?$/i.test(
      path,
    )
  )
    return undefined
  const suffix = path.split('/')[5]
  return method === 'GET' && !suffix
    ? 'voice_read'
    : method === 'POST' && suffix
      ? `voice_${suffix}`
      : undefined
}
const response = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
const failure = (code: VoiceErrorCode, requestId: string) =>
  response({ code, requestId }, voiceHttpStatus(code))
const rpc = async <Name extends keyof Functions>(
  db: Client,
  name: Name,
  args: Functions[Name]['Args'],
) => {
  try {
    const { data, error } = await db.rpc(name, args)
    return {
      value: isObject(data) ? data : undefined,
      code: error
        ? isVoiceErrorCode(error.message)
          ? error.message
          : 'DATABASE_ERROR'
        : undefined,
    } as const
  } catch {
    return { value: undefined, code: 'DATABASE_ERROR' } as const
  }
}
type RpcResult = Awaited<ReturnType<typeof rpc>>
const publicReply = (
  result: RpcResult,
  requestId: string,
  extra: Record<string, unknown> = {},
) => {
  if (result.code) return failure(result.code, requestId)
  const value = result.value
  if (!value) return failure('DATABASE_ERROR', requestId)
  const code = isVoiceErrorCode(value.refusal) ? value.refusal : undefined
  const session =
    value.session === null ? null : parseVoiceSession(value.session)
  if (session === undefined) return failure('DATABASE_ERROR', requestId)
  return response(
    {
      requestId,
      session,
      ...(code ? { code } : {}),
      ...(typeof value.quotaResetAt === 'string'
        ? { quotaResetAt: value.quotaResetAt }
        : {}),
      ...(isUuid(value.outstandingSessionId)
        ? { outstandingSessionId: value.outstandingSessionId }
        : {}),
      ...extra,
    },
    code ? voiceHttpStatus(code) : 200,
  )
}
const internal = (result: RpcResult) =>
  isObject(result.value?.session) && isObject(result.value.session.worker)
    ? result.value.session.worker
    : undefined
const exact = (body: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(body).every((key) => keys.includes(key))
const readBody = async (
  request: Request,
  limit: number,
): Promise<Record<string, unknown> | 'BODY_TOO_LARGE' | undefined> => {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim() !==
    'application/json'
  )
    return undefined
  const reader = request.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) {
        await reader.cancel()
        return 'BODY_TOO_LARGE'
      }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    )
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}
type Limiter = Readonly<{
  limit: (input: { key: string }) => Promise<{ success: boolean }>
}>
const isLimiter = (value: unknown): value is Limiter =>
  typeof (value as Limiter | undefined)?.limit === 'function'
export const createVoiceLimiter = () => {
  const buckets = new Map<string, { count: number; at: number }>()
  return (address: string, route: string, now: number) => {
    for (const [key, value] of buckets)
      if (now - value.at >= 60_000) buckets.delete(key)
    const take = (key: string, limit: number) => {
      const prior = buckets.get(key) ?? { count: 0, at: now }
      if (prior.count >= limit) return false
      buckets.set(key, { ...prior, count: prior.count + 1 })
      return true
    }
    return take('project', 120) && take(`${address}:${route}`, 30)
  }
}
const localLimiter = createVoiceLimiter()
const rateAllowed = async (
  request: Request,
  config: PublicConfiguration,
  env: VoiceBindings,
  route: string,
) => {
  const address = request.headers.get('CF-Connecting-IP') ?? 'local'
  if (config.appEnv === 'local') return localLimiter(address, route, Date.now())
  if (
    !isLimiter(env.VOICE_REQUEST_LIMITER) ||
    !isLimiter(env.VOICE_PROJECT_LIMITER)
  )
    return false
  try {
    return (
      (await env.VOICE_REQUEST_LIMITER.limit({ key: `${address}:${route}` }))
        .success &&
      (await env.VOICE_PROJECT_LIMITER.limit({ key: config.appEnv })).success
    )
  } catch {
    return false
  }
}
export const handleVoiceRequest = async (
  request: Request,
  config: PublicConfiguration,
  env: VoiceBindings,
  requestId: string,
): Promise<Response> => {
  const url = new URL(request.url)
  const route = voiceRoute(request.method, url.pathname)
  if (!route) return failure('NOT_FOUND', requestId)
  if (config.appEnv === 'preview')
    return failure('VOICE_UNAVAILABLE', requestId)
  const origin = request.headers.get('Origin')
  if (
    (request.method !== 'GET' && origin !== config.appOrigin) ||
    (origin !== null && origin !== config.appOrigin)
  )
    return failure('FORBIDDEN', requestId)
  if (
    !config.supabaseUrl ||
    !config.supabasePublicKey ||
    typeof env.SUPABASE_ADMIN_KEY !== 'string' ||
    !env.SUPABASE_ADMIN_KEY.trim() ||
    (config.appEnv === 'local' &&
      (config.appOrigin !== 'http://127.0.0.1:5173' ||
        config.supabaseUrl !== 'http://127.0.0.1:54321'))
  )
    return failure('VOICE_UNAVAILABLE', requestId)
  if (!(await rateAllowed(request, config, env, route)))
    return failure('RATE_LIMITED', requestId)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16_384)
    return failure('AUTH_REQUIRED', requestId)
  const live = {
    ...config,
    appEnv: config.appEnv,
    supabaseUrl: config.supabaseUrl,
    supabasePublicKey: config.supabasePublicKey,
  }
  const user = client(live, config.supabasePublicKey, authorization.slice(7))
  const service = client(live, env.SUPABASE_ADMIN_KEY)
  try {
    const identity = await user.auth.getUser(authorization.slice(7))
    if (identity.error || !identity.data.user)
      return failure('AUTH_REQUIRED', requestId)
    const access = await user.rpc('get_my_access')
    const profile = readAccess(access.data)
    // A verified owner can still revoke their row after access is disabled.
    if (
      !profile ||
      profile.id !== identity.data.user.id ||
      profile.role !== 'coach' ||
      (!profile.enabled && route !== 'voice_end')
    )
      return failure('FORBIDDEN', requestId)
    const actorId = profile.id
    const body =
      request.method === 'GET'
        ? {}
        : await readBody(
            request,
            route === 'voice_proposal' ? 96 * 1024 : 8 * 1024,
          )
    if (body === 'BODY_TOO_LARGE') return failure(body, requestId)
    if (!body) return failure('INVALID_INPUT', requestId)
    if (route === 'voice_start') {
      if (
        !exact(body, [
          'startRequestId',
          'campaignId',
          'playerId',
          'acknowledged',
        ]) ||
        !isUuid(body.startRequestId) ||
        !isUuid(body.campaignId) ||
        !isUuid(body.playerId) ||
        body.acknowledged !== true
      )
        return failure('INVALID_INPUT', requestId)
      const target = {
        actorId,
        campaignId: body.campaignId,
        playerId: body.playerId,
        startRequestId: body.startRequestId,
      }
      const gate = await voiceAuthorisation(config, env, target)
      if (
        !gate ||
        !(await verifyProviderConfiguration(gate.manifest, gate.apiKey))
      )
        return failure('VOICE_UNAVAILABLE', requestId)
      if (
        gate.authorisation.kind === 'local_verification' &&
        (!gate.run ||
          identity.data.user.app_metadata.sfda_voice_fixture_instance_id !==
            gate.run.fixtureInstanceId)
      )
        return failure('VOICE_UNAVAILABLE', requestId)
      const reserved = await rpc(user, 'reserve_voice_session', {
        start_request_id: target.startRequestId,
        campaign_id: target.campaignId,
        player_id: target.playerId,
      })
      if (
        reserved.code ||
        reserved.value?.fresh !== true ||
        reserved.value.refusal
      )
        return publicReply(reserved, requestId)
      const session = parseVoiceSession(reserved.value.session)
      if (!session) return failure('DATABASE_ERROR', requestId)
      const facts = databaseVoiceConfig(gate.manifest, gate.fingerprint)
      const claimed = await rpc(service, 'claim_voice_session', {
        session_id: session.id,
        actor_id: actorId,
        config: facts,
        authorisation: gate.authorisation as unknown as Json,
      })
      const dispatchId = claimed.value?.dispatchId
      if (claimed.code || claimed.value?.refusal || !isUuid(dispatchId))
        return publicReply(claimed, requestId)
      const current = await voiceAuthorisation(config, env, target)
      if (!current || current.fingerprint !== gate.fingerprint) {
        return publicReply(
          await rpc(service, 'end_voice_session', {
            session_id: session.id,
            actor_id: actorId,
            reason: 'failed',
          }),
          requestId,
        )
      }
      const armed = await rpc(service, 'arm_voice_dispatch', {
        session_id: session.id,
        actor_id: actorId,
        dispatch_id: dispatchId,
        config: facts,
      })
      if (armed.code || armed.value?.refusal)
        return publicReply(armed, requestId)
      const until = internal(armed)?.dispatchUntil
      // No await occurs between this absolute deadline check and the external dispatch.
      const issued =
        typeof until === 'string' &&
        Date.now() < Date.parse(until) &&
        Date.now() < Date.parse(current.authorisation.until)
          ? await issueVoiceCredential(current.manifest, current.apiKey)
          : { outcome: 'not_issued' as const }
      const observation =
        issued.outcome === 'issued'
          ? {
              outcome: 'issued',
              conversationId: issued.conversationId,
              unexpected:
                Date.now() >
                Date.parse(String(until)) +
                  current.manifest.dispatchToIssuanceSeconds * 1000,
            }
          : { outcome: issued.outcome, unexpected: false }
      const recorded = await rpc(service, 'record_voice_issuance', {
        session_id: session.id,
        actor_id: actorId,
        dispatch_id: dispatchId,
        observation,
      })
      return publicReply(
        recorded,
        requestId,
        issued.outcome === 'issued' && recorded.value?.deliverToken === true
          ? { token: issued.token, conversationId: issued.conversationId }
          : {},
      )
    }
    const sessionId = url.pathname.split('/')[4]
    if (!isUuid(sessionId)) return failure('INVALID_INPUT', requestId)
    const args = { session_id: sessionId, actor_id: actorId }
    const known = await rpc(service, 'read_voice_session', args)
    if (known.code) return publicReply(known, requestId)
    const manifest = readVoiceManifest(manifestValue)
    const facts =
      manifest && typeof env.VOICE_CONFIG_FINGERPRINT === 'string'
        ? databaseVoiceConfig(manifest, env.VOICE_CONFIG_FINGERPRINT)
        : null
    const reference = internal(known)?.providerConversationId
    const observation = async () =>
      typeof reference === 'string' &&
      typeof env.ELEVENLABS_API_KEY === 'string'
        ? observeVoiceProvider(reference, env.ELEVENLABS_API_KEY)
        : { kind: 'unavailable' as const }
    if (route === 'voice_read')
      return publicReply(
        await rpc(service, 'observe_voice_provider', {
          ...args,
          config: facts,
          observation: await observation(),
        }),
        requestId,
      )
    if (route === 'voice_end') {
      if (
        !exact(body, ['reason']) ||
        ![
          'finished',
          'cancelled',
          'backgrounded',
          'failed',
          'timed_out',
        ].includes(String(body.reason))
      )
        return failure('INVALID_INPUT', requestId)
      const ended = await rpc(service, 'end_voice_session', {
        ...args,
        reason: String(body.reason),
      })
      if (ended.code) return publicReply(ended, requestId)
      return publicReply(
        await rpc(service, 'observe_voice_provider', {
          ...args,
          config: facts,
          observation: await observation(),
        }),
        requestId,
      )
    }
    if (route === 'voice_connected') {
      if (
        !exact(body, ['conversationId', 'expectedVersion']) ||
        typeof body.conversationId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(body.conversationId) ||
        !Number.isSafeInteger(body.expectedVersion) ||
        Number(body.expectedVersion) < 1
      )
        return failure('INVALID_INPUT', requestId)
      return publicReply(
        await rpc(service, 'record_voice_connection', {
          ...args,
          expected_version: Number(body.expectedVersion),
          sdk_conversation_id: body.conversationId,
          config: facts,
          observation: await observation(),
        }),
        requestId,
      )
    }
    if (route === 'voice_finish') {
      if (
        !exact(body, ['expectedVersion']) ||
        !Number.isSafeInteger(body.expectedVersion) ||
        Number(body.expectedVersion) < 1
      )
        return failure('INVALID_INPUT', requestId)
      return publicReply(
        await rpc(service, 'begin_voice_finish', {
          ...args,
          expected_version: Number(body.expectedVersion),
          config: facts,
        }),
        requestId,
      )
    }
    if (!exact(body, ['proposalId', 'fields']) || !isUuid(body.proposalId))
      return failure('INVALID_PROPOSAL', requestId)
    const fields = parseToolArguments(body.fields)
    if (!fields.ok) return failure(fields.code, requestId)
    if (isEmptyProposal(fields.value))
      return publicReply(
        await rpc(service, 'end_voice_session', {
          ...args,
          reason: 'finished',
        }),
        requestId,
      )
    const accepted = await rpc(service, 'accept_voice_proposal', {
      ...args,
      proposal_id: body.proposalId,
    })
    return publicReply(
      accepted,
      requestId,
      !accepted.code && !accepted.value?.refusal
        ? { proposalId: body.proposalId, fields: fields.value }
        : {},
    )
  } catch {
    return failure('DATABASE_ERROR', requestId)
  }
}

export const reconcileVoiceSessions = async (
  config: PublicConfiguration,
  env: VoiceBindings,
) => {
  if (
    config.appEnv === 'preview' ||
    !config.supabaseUrl ||
    !config.supabasePublicKey ||
    typeof env.SUPABASE_ADMIN_KEY !== 'string'
  )
    return
  const db = client(
    {
      ...config,
      appEnv: config.appEnv,
      supabaseUrl: config.supabaseUrl,
      supabasePublicKey: config.supabasePublicKey,
    },
    env.SUPABASE_ADMIN_KEY,
  )
  let cursor: { createdAt: string; id: string } | undefined
  // Bounded pages. At most 100 daily reservations exist, held rows may span days.
  for (let page = 0; page < 32; page++) {
    const list = await rpc(db, 'list_voice_reconciliation', {
      after_created_at: cursor?.createdAt ?? null,
      after_id: cursor?.id ?? null,
      page_size: 100,
    })
    if (list.code || !Array.isArray(list.value?.items)) {
      console.error(
        JSON.stringify({ route: 'voice_maintenance', code: 'DATABASE_ERROR' }),
      )
      return
    }
    for (const item of list.value.items) {
      if (!isObject(item) || !isUuid(item.id)) continue
      const observed =
        typeof item.providerConversationId === 'string' &&
        typeof env.ELEVENLABS_API_KEY === 'string'
          ? await observeVoiceProvider(
              item.providerConversationId,
              env.ELEVENLABS_API_KEY,
            )
          : { kind: 'unavailable' as const }
      const result = await rpc(db, 'reconcile_voice_session', {
        session_id: item.id,
        observation: observed,
        config: null,
      })
      if (result.code || internal(result)?.alert)
        console.error(
          JSON.stringify({
            route: 'voice_maintenance',
            code: result.code ?? 'HELD_UNBOUNDED',
          }),
        )
    }
    const next = list.value.nextCursor
    if (next === null) break
    if (
      !isObject(next) ||
      typeof next.createdAt !== 'string' ||
      !isUuid(next.id)
    )
      return
    cursor = { createdAt: next.createdAt, id: next.id }
  }
  const deleted = await db.rpc('delete_ended_voice_sessions', {
    batch_size: 1000,
  })
  if (deleted.error)
    console.error(
      JSON.stringify({ route: 'voice_maintenance', code: 'DATABASE_ERROR' }),
    )
}
