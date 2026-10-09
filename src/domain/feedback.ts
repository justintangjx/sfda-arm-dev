export type AccountRole = 'admin' | 'coach' | 'player'
export type CampaignStage =
  'setup' | 'preparation' | 'competition' | 'final_feedback' | 'closed'
export type FeedbackKind = 'preparation' | 'final'
export type FeedbackText = Readonly<{
  observations: string | null
  strengths: string | null
  developmentFocus: string | null
  observedOn: string | null
}>
export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: 'INVALID_INPUT' }>
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0
const dateIsValid = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}
const nullableText = (
  value: unknown,
  maximum: number,
): string | null | undefined => {
  if (value === null) return null
  if (typeof value !== 'string' || Array.from(value).length > maximum)
    return undefined
  return value.trim() || null
}

export const validateFeedbackText = (
  value: unknown,
  complete: boolean,
): Result<FeedbackText> => {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 4 ||
    !['observations', 'strengths', 'developmentFocus', 'observedOn'].every(
      (key) => key in value,
    )
  )
    return { ok: false, code: 'INVALID_INPUT' }
  const observations = nullableText(value.observations, 10000)
  const strengths = nullableText(value.strengths, 5000)
  const developmentFocus = nullableText(value.developmentFocus, 5000)
  const observedOn = value.observedOn
  if (
    observations === undefined ||
    strengths === undefined ||
    developmentFocus === undefined ||
    (observedOn !== null &&
      (typeof observedOn !== 'string' || !dateIsValid(observedOn))) ||
    (complete && (observations === null || observedOn === null))
  )
    return { ok: false, code: 'INVALID_INPUT' }
  // The database alone checks the Singapore calendar date against its current time.
  return {
    ok: true,
    value: { observations, strengths, developmentFocus, observedOn },
  }
}
export const feedbackRpcContent = (text: FeedbackText) => ({
  observations: text.observations,
  strengths: text.strengths,
  development_focus: text.developmentFocus,
  observed_on: text.observedOn,
})

export type RecordReference =
  | Readonly<{
      type:
        | 'profile'
        | 'competition'
        | 'campaign'
        | 'feedback_entry'
        | 'final_waiver'
        | 'feedback_correction'
      id: string
      version: number
      exists: boolean
      metadata: Readonly<Record<string, unknown>>
    }>
  | Readonly<{
      type: 'campaign_coach'
      campaignId: string
      coachId: string
      version: number
      exists: boolean
      metadata: Readonly<Record<string, unknown>>
    }>
  | Readonly<{
      type: 'campaign_player'
      campaignId: string
      playerId: string
      version: number
      exists: boolean
      metadata: Readonly<Record<string, unknown>>
    }>
export type MutationResult = Readonly<{
  outcome: 'committed' | 'already_committed'
  mutationId: string
  result: RecordReference
}>
export const validateMutationResult = (
  value: unknown,
): Result<MutationResult> => {
  if (
    !isObject(value) ||
    (value.outcome !== 'committed' && value.outcome !== 'already_committed') ||
    !isUuid(value.mutationId) ||
    !isObject(value.result)
  )
    return { ok: false, code: 'INVALID_INPUT' }
  const result = value.result
  if (
    !positiveInteger(result.version) ||
    typeof result.exists !== 'boolean' ||
    !isObject(result.metadata)
  )
    return { ok: false, code: 'INVALID_INPUT' }
  const common = {
    version: result.version,
    exists: result.exists,
    metadata: result.metadata,
  }
  if (
    result.type === 'campaign_coach' &&
    isUuid(result.campaignId) &&
    isUuid(result.coachId)
  )
    return {
      ok: true,
      value: {
        outcome: value.outcome,
        mutationId: value.mutationId,
        result: {
          type: result.type,
          campaignId: result.campaignId,
          coachId: result.coachId,
          ...common,
        },
      },
    }
  if (
    result.type === 'campaign_player' &&
    isUuid(result.campaignId) &&
    isUuid(result.playerId)
  )
    return {
      ok: true,
      value: {
        outcome: value.outcome,
        mutationId: value.mutationId,
        result: {
          type: result.type,
          campaignId: result.campaignId,
          playerId: result.playerId,
          ...common,
        },
      },
    }
  const recordType = (
    [
      'profile',
      'competition',
      'campaign',
      'feedback_entry',
      'final_waiver',
      'feedback_correction',
    ] as const
  ).find((type) => type === result.type)
  if (recordType && isUuid(result.id))
    return {
      ok: true,
      value: {
        outcome: value.outcome,
        mutationId: value.mutationId,
        result: { type: recordType, id: result.id, ...common },
      },
    }
  return { ok: false, code: 'INVALID_INPUT' }
}

export type VoiceContextBinding = Readonly<{
  callerId: string
  campaignId: string
  playerId: string
  kind: FeedbackKind
  campaignVersion: number
  callerAccessVersion: number
  coachMembershipVersion: number
  playerMembershipVersion: number
}>
export const validateVoiceContextBinding = (
  value: unknown,
): Result<VoiceContextBinding> => {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 8 ||
    !isUuid(value.callerId) ||
    !isUuid(value.campaignId) ||
    !isUuid(value.playerId) ||
    (value.kind !== 'preparation' && value.kind !== 'final') ||
    !positiveInteger(value.campaignVersion) ||
    !positiveInteger(value.callerAccessVersion) ||
    !positiveInteger(value.coachMembershipVersion) ||
    !positiveInteger(value.playerMembershipVersion)
  )
    return { ok: false, code: 'INVALID_INPUT' }
  return {
    ok: true,
    value: {
      callerId: value.callerId,
      campaignId: value.campaignId,
      playerId: value.playerId,
      kind: value.kind,
      campaignVersion: value.campaignVersion,
      callerAccessVersion: value.callerAccessVersion,
      coachMembershipVersion: value.coachMembershipVersion,
      playerMembershipVersion: value.playerMembershipVersion,
    },
  }
}
// Every revision must still match. Revoking and restoring access changes the revision twice.
export const voiceContextMatches = (
  started: VoiceContextBinding,
  current: VoiceContextBinding,
  writePermitted: boolean,
) =>
  writePermitted &&
  (Object.keys(started) as (keyof VoiceContextBinding)[]).every(
    (key) => started[key] === current[key],
  )
