// Shared voice contracts for the browser and Worker. Pure: no fetch, no SDK, no secrets.
// Lifecycle rules live in supabase/migrations/20261015000100_voice_sessions.sql.
import type { Database } from './database.types.js'
import { isObject, isUuid, validateVoiceContextBinding } from './feedback.js'
import type { VoiceContextBinding } from './feedback.js'

type ProposalParseResult =
  | Readonly<{ ok: true; value: ProposalFields }>
  | Readonly<{ ok: false; code: 'INVALID_PROPOSAL' }>

type Enums = Database['public']['Enums']
export type VoiceStatus = NonNullable<Enums['voice_session_status']>
export type VoiceLocalOutcome = Enums['voice_local_outcome']
export type VoiceProviderState = Enums['voice_provider_state']

export const voiceDisclosure =
  'Your speech is sent to ElevenLabs to prepare a draft. Audio saving is off. Conversation text is scheduled for deletion. Start only if you are authorised to share these observations.'

export const providerContext = {
  player_label: 'selected player',
  phase: 'preparation',
} as const

export const proposalToolName = 'prepare_feedback_proposal'

/** Grafted from candidate B: explicit empty sections for unsupported content. */
export const finishMessage =
  'Prepare the feedback proposal now by calling prepare_feedback_proposal. Leave any section you cannot support empty.'

export type ProposalFields = Readonly<{
  observations: string | null
  strengths: string | null
  developmentFocus: string | null
}>

export type VoiceSessionBinding = Readonly<{
  sessionId: string
  context: VoiceContextBinding
}>

export type VoiceSessionView = Readonly<{
  id: string
  version: number
  status: VoiceStatus
  startRequestId: string
  localOutcome: VoiceLocalOutcome
  providerState: VoiceProviderState
  failureCode: string | null
  binding: VoiceContextBinding
  connectedAt: string | null
  endedAt: string | null
  holdUntil: string | null
  callCapSeconds: number
  warningSeconds: number
  callRemainingMs: number | null
  finishRemainingMs: number | null
  proposalId: string | null
  proposalEligible: boolean
  revoked: boolean
  finishMode: 'mute_and_request' | 'end_immediately'
}>

const statuses: readonly VoiceStatus[] = [
  'reserved',
  'authorising',
  'active',
  'finishing',
  'proposal_ready',
  'completed',
  'cancelled',
  'failed',
  'expired',
  'uncertain',
]
const timestamp = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === 'string' && Number.isFinite(Date.parse(value)))
const remaining = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === 'number' && Number.isFinite(value) && value >= 0)

// Build an allowlisted value instead of forwarding database or provider objects.
export const parseVoiceSession = (
  value: unknown,
): VoiceSessionView | undefined => {
  if (!isObject(value)) return undefined
  const binding = validateVoiceContextBinding(value.binding)
  const status = statuses.find((status) => status === value.status)
  const outcome = (
    ['open', 'finished', 'failed', 'timed_out', 'cancelled'] as const
  ).find((outcome) => outcome === value.localOutcome)
  const provider = (
    ['not_issued', 'unknown', 'live', 'terminal'] as const
  ).find((state) => state === value.providerState)
  if (
    !binding.ok ||
    !status ||
    !outcome ||
    !provider ||
    !isUuid(value.id) ||
    !isUuid(value.startRequestId) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    !(
      value.failureCode === null ||
      (typeof value.failureCode === 'string' &&
        /^[A-Z_]+$/.test(value.failureCode))
    ) ||
    !timestamp(value.connectedAt) ||
    !timestamp(value.endedAt) ||
    !timestamp(value.holdUntil) ||
    !remaining(value.callRemainingMs) ||
    !remaining(value.finishRemainingMs) ||
    value.callCapSeconds !== 300 ||
    value.warningSeconds !== 30 ||
    !(value.proposalId === null || isUuid(value.proposalId)) ||
    typeof value.proposalEligible !== 'boolean' ||
    typeof value.revoked !== 'boolean'
  )
    return undefined
  return {
    id: value.id,
    startRequestId: value.startRequestId,
    version: Number(value.version),
    status,
    localOutcome: outcome,
    providerState: provider,
    failureCode: value.failureCode,
    binding: binding.value,
    connectedAt: value.connectedAt,
    endedAt: value.endedAt,
    holdUntil: value.holdUntil,
    callCapSeconds: 300,
    warningSeconds: 30,
    callRemainingMs: value.callRemainingMs,
    finishRemainingMs: value.finishRemainingMs,
    proposalId: value.proposalId,
    proposalEligible: value.proposalEligible,
    revoked: value.revoked,
    finishMode:
      value.finishMode === 'mute_and_request'
        ? 'mute_and_request'
        : 'end_immediately',
  }
}

export type VoiceReply = Readonly<{
  session: VoiceSessionView | undefined
  code: VoiceErrorCode | undefined
  requestId: string
  token: string | undefined
  conversationId: string | undefined
  quotaResetAt: string | undefined
  outstandingSessionId: string | undefined
}>

export const voiceErrorCodes = {
  START_UNKNOWN: 202,
  DISPATCH_EXPIRED: 503,
  INVALID_INPUT: 400,
  INVALID_PROPOSAL: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VOICE_BUSY: 409,
  CONTEXT_CHANGED: 409,
  VERSION_CONFLICT: 409,
  SESSION_ENDED: 409,
  FINISH_EXPIRED: 409,
  PROPOSAL_UNAVAILABLE: 409,
  CONVERSATION_MISMATCH: 409,
  EXECUTION_IDENTITY_UNAVAILABLE: 409,
  CONFIG_CHANGED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  BODY_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  VOICE_UNAVAILABLE: 503,
  PROVIDER_STATUS_UNKNOWN: 503,
  DATABASE_ERROR: 503,
} as const

export type VoiceErrorCode = keyof typeof voiceErrorCodes

export const isVoiceErrorCode = (value: unknown): value is VoiceErrorCode =>
  typeof value === 'string' && Object.hasOwn(voiceErrorCodes, value)

export const voiceHttpStatus = (code: VoiceErrorCode): number =>
  voiceErrorCodes[code]

const toolKeys = ['observations', 'strengths', 'development_focus'] as const
const limits = {
  observations: 10_000,
  strengths: 5_000,
  development_focus: 5_000,
} as const

const lengthOk = (text: string, max: number) => [...text].length <= max

const field = (
  value: unknown,
  max: number,
): Readonly<{ ok: true; value: string | null }> | Readonly<{ ok: false }> => {
  if (value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  if (!lengthOk(value, max)) return { ok: false }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  return { ok: true, value: trimmed }
}

export const parseToolArguments = (value: unknown): ProposalParseResult => {
  if (!isObject(value)) return { ok: false, code: 'INVALID_PROPOSAL' }
  for (const key of Object.keys(value))
    if (!(toolKeys as readonly string[]).includes(key))
      return { ok: false, code: 'INVALID_PROPOSAL' }
  const observations = field(value.observations, limits.observations)
  if (!observations.ok) return { ok: false, code: 'INVALID_PROPOSAL' }
  const strengths = field(value.strengths, limits.strengths)
  if (!strengths.ok) return { ok: false, code: 'INVALID_PROPOSAL' }
  const development = field(value.development_focus, limits.development_focus)
  if (!development.ok) return { ok: false, code: 'INVALID_PROPOSAL' }
  return {
    ok: true,
    value: {
      observations: observations.value,
      strengths: strengths.value,
      developmentFocus: development.value,
    },
  }
}

export const isEmptyProposal = (fields: ProposalFields) =>
  fields.observations === null &&
  fields.strengths === null &&
  fields.developmentFocus === null
