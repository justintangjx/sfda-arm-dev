import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../../domain/database'
import { isObject, isUuid } from '../../domain/feedback'
import {
  isVoiceErrorCode,
  parseVoiceSession,
  type VoiceReply,
} from '../../domain/voice'

export const createVoiceApi = (
  client: SupabaseClient<ApplicationDatabase>,
  fetcher: typeof fetch = fetch,
) => {
  const request = async (
    path: string,
    body: unknown = undefined,
  ): Promise<VoiceReply> => {
    const requestId = crypto.randomUUID()
    const failed = {
      session: undefined,
      code: 'PROVIDER_STATUS_UNKNOWN' as const,
      requestId,
      token: undefined,
      conversationId: undefined,
      quotaResetAt: undefined,
      outstandingSessionId: undefined,
    }
    try {
      const auth = await client.auth.getSession()
      if (!auth.data.session) return { ...failed, code: 'AUTH_REQUIRED' }
      const response = await fetcher(`/api/voice/sessions${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${auth.data.session.access_token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(35_000),
      })
      const value: unknown = await response.json()
      if (!isObject(value) || typeof value.requestId !== 'string') return failed
      const session =
        value.session === null || value.session === undefined
          ? undefined
          : parseVoiceSession(value.session)
      const code = isVoiceErrorCode(value.code) ? value.code : undefined
      if ((!response.ok && !code) || (value.session && !session)) return failed
      return {
        session,
        code,
        requestId: value.requestId,
        token: typeof value.token === 'string' ? value.token : undefined,
        conversationId:
          typeof value.conversationId === 'string'
            ? value.conversationId
            : undefined,
        quotaResetAt:
          typeof value.quotaResetAt === 'string'
            ? value.quotaResetAt
            : undefined,
        outstandingSessionId: isUuid(value.outstandingSessionId)
          ? value.outstandingSessionId
          : undefined,
      }
    } catch {
      return failed
    }
  }
  return {
    request,
    current: async () => {
      try {
        const result = await client
          .from('voice_sessions')
          .select('id')
          .is('ended_at', null)
          .limit(1)
          .maybeSingle()
        return result.error
          ? { ok: false as const }
          : { ok: true as const, id: result.data?.id }
      } catch {
        return { ok: false as const }
      }
    },
    validate: async (id: string) => {
      try {
        const result = await client.rpc('validate_voice_binding', {
          session_id: id,
        })
        if (
          result.error ||
          !isObject(result.data) ||
          result.data.refusal !== null
        )
          return undefined
        return parseVoiceSession(result.data.session)
      } catch {
        return undefined
      }
    },
    proposal: async (id: string, proposalId: string, fields: unknown) => {
      const auth = await client.auth.getSession()
      if (!auth.data.session) return undefined
      try {
        const response = await fetcher(`/api/voice/sessions/${id}/proposal`, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            Authorization: `Bearer ${auth.data.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ proposalId, fields }),
          signal: AbortSignal.timeout(10_000),
        })
        const value: unknown = await response.json()
        if (
          !response.ok ||
          !isObject(value) ||
          value.code ||
          value.proposalId !== proposalId ||
          !isObject(value.fields)
        )
          return undefined
        const session = parseVoiceSession(value.session)
        const { observations, strengths, developmentFocus } = value.fields
        if (
          !session ||
          session.id !== id ||
          !session.proposalEligible ||
          session.proposalId !== proposalId ||
          ![observations, strengths, developmentFocus].every(
            (value) => value === null || typeof value === 'string',
          )
        )
          return undefined
        return {
          session,
          fields: {
            observations: String(observations ?? ''),
            strengths: String(strengths ?? ''),
            developmentFocus: String(developmentFocus ?? ''),
          },
        }
      } catch {
        return undefined
      }
    },
  }
}
export type VoiceApi = ReturnType<typeof createVoiceApi>
