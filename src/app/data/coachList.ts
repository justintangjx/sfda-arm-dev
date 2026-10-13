import { isUuid, type CampaignStage } from '../../domain/feedback.ts'
import { record } from '../../domain/accounts.ts'
import type { DataErrorCode } from './mutations.ts'
import type { DataResult, Page } from '../coach/contracts.ts'

export type ListEnvelope<T> = Page<T> &
  Readonly<{
    queryFingerprint: string
    readAt: string
  }>

const failure = (
  code: DataErrorCode,
  requestId: string = crypto.randomUUID(),
): DataResult<never> => ({ ok: false, code, requestId })

export const readRpcError = (error: { message?: string } | null) =>
  error
    ? failure(
        [
          'FORBIDDEN',
          'AUTH_REQUIRED',
          'NOT_FOUND',
          'INVALID_INPUT',
          'INVALID_CURSOR',
        ].includes(error.message ?? '')
          ? (error.message as DataErrorCode)
          : error.message === ''
            ? 'NETWORK_ERROR'
            : 'DATABASE_ERROR',
      )
    : undefined

export const parseListEnvelope = <T>(
  data: unknown,
  map: (item: unknown) => T | undefined,
): DataResult<ListEnvelope<T>> => {
  const row = record(data)
  const items = row?.items
  if (!row || !Array.isArray(items)) return failure('INVALID_RESPONSE')
  const mapped = items.map(map)
  if (mapped.some((item) => item === undefined))
    return failure('INVALID_RESPONSE')
  const nextCursor =
    row.nextCursor === null || row.nextCursor === undefined
      ? undefined
      : typeof row.nextCursor === 'string'
        ? row.nextCursor
        : undefined
  if (row.nextCursor !== null && row.nextCursor !== undefined && !nextCursor)
    return failure('INVALID_RESPONSE')
  const queryFingerprint = row.queryFingerprint
  const readAt = row.readAt
  if (typeof queryFingerprint !== 'string' || typeof readAt !== 'string')
    return failure('INVALID_RESPONSE')
  return {
    ok: true,
    value: {
      rows: mapped as T[],
      nextCursor,
      queryFingerprint,
      readAt,
    },
  }
}

export const parseStage = (value: unknown): CampaignStage | undefined =>
  ['setup', 'preparation', 'competition', 'final_feedback', 'closed'].includes(
    String(value),
  )
    ? (value as CampaignStage)
    : undefined

export const parseCampaignRow = (value: unknown) => {
  const row = record(value)
  if (
    !row ||
    !isUuid(row.campaignId) ||
    typeof row.name !== 'string' ||
    typeof row.teamName !== 'string' ||
    typeof row.competitionName !== 'string' ||
    !parseStage(row.stage) ||
    typeof row.version !== 'number' ||
    typeof row.membershipVersion !== 'number' ||
    typeof row.membershipActive !== 'boolean' ||
    typeof row.accessLabel !== 'string'
  )
    return undefined
  return {
    id: row.campaignId,
    name: row.name,
    team: row.teamName,
    competition: row.competitionName,
    stage: parseStage(row.stage)!,
    version: row.version,
    membershipVersion: row.membershipVersion,
    isActive: row.membershipActive,
    frozen: false,
    accessLabel: row.accessLabel,
  }
}

export const parsePlayerRow = (value: unknown) => {
  const row = record(value)
  if (
    !row ||
    !isUuid(row.playerId) ||
    typeof row.displayName !== 'string' ||
    typeof row.membershipActive !== 'boolean' ||
    typeof row.membershipVersion !== 'number' ||
    typeof row.hasSavedPreparationDraft !== 'boolean' ||
    typeof row.preparationSubmissionCount !== 'string'
  )
    return undefined
  const latest =
    row.latestPreparationSubmittedAt === null ||
    row.latestPreparationSubmittedAt === undefined
      ? undefined
      : typeof row.latestPreparationSubmittedAt === 'string'
        ? row.latestPreparationSubmittedAt
        : undefined
  if (
    row.latestPreparationSubmittedAt !== null &&
    row.latestPreparationSubmittedAt !== undefined &&
    !latest
  )
    return undefined
  return {
    id: row.playerId,
    displayName: row.displayName,
    isActive: row.membershipActive,
    membershipVersion: row.membershipVersion,
    obligation: 'none' as const,
    waiverReason: undefined,
    hasSavedPreparationDraft: row.hasSavedPreparationDraft,
    preparationSubmissionCount: row.preparationSubmissionCount,
    latestPreparationSubmittedAt: latest,
  }
}
