import { isUuid } from '../../domain/feedback.ts'
import type {
  Actor,
  CoachAdapter,
  DataResult,
  PlayerContext,
  RosterDiscoveryQuery,
} from './contracts.ts'

export type PlayerNavigationGate = Readonly<{
  campaignId: string
  rosterQuery: RosterDiscoveryQuery
}>

export const rosterQueryIdentity = (query: RosterDiscoveryQuery): string =>
  JSON.stringify({
    text: query.text?.trim() ?? '',
    membership: query.membership,
    drafts: query.drafts,
  })

export const playerIdFromCoachPath = (pathname: string): string | undefined => {
  const match = pathname.match(/^\/coach\/campaigns\/[^/]+\/players\/([^/?#]+)/)
  const candidate = match?.[1]
  return candidate && isUuid(candidate) ? candidate : undefined
}

export const campaignIdFromCoachPath = (
  pathname: string,
): string | undefined => {
  const match = pathname.match(/^\/coach\/campaigns\/([^/]+)/)
  const candidate = match?.[1]
  return candidate && isUuid(candidate) ? candidate : undefined
}

/** Confirms the named player is readable and still matches applied roster filters. */
export const verifyPlayerNavigationTarget = async (
  adapter: CoachAdapter,
  actor: Actor,
  gate: PlayerNavigationGate,
  targetPlayerId: string,
  intentRosterQuery: RosterDiscoveryQuery,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<DataResult<PlayerContext>> => {
  const current = () =>
    !signal.aborted &&
    isCurrent() &&
    rosterQueryIdentity(gate.rosterQuery) ===
      rosterQueryIdentity(intentRosterQuery)
  if (!current())
    return {
      ok: false,
      code: 'INVALID_INPUT',
      requestId: crypto.randomUUID(),
    }
  const result = await adapter.loadPlayerContext(
    actor,
    gate.campaignId,
    targetPlayerId,
    gate.rosterQuery,
    signal,
  )
  if (!current())
    return {
      ok: false,
      code: 'INVALID_INPUT',
      requestId: crypto.randomUUID(),
    }
  if (!result.ok) return result
  if (!result.value.filterMatch)
    return {
      ok: false,
      code: 'NOT_FOUND',
      requestId: crypto.randomUUID(),
    }
  return result
}
