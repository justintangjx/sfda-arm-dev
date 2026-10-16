import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../../domain/database.ts'
import { isUuid, readAccess, record } from '../../domain/accounts.ts'
import {
  validateFeedbackText,
  type FeedbackKind,
  type FeedbackText,
} from '../../domain/feedback.ts'
import type {
  Actor,
  CampaignContext,
  CoachAdapter,
  Command,
  Commit,
  DataResult,
  Draft,
  HistorySummary,
  PlayerContext,
  RosterDiscoveryQuery,
  RosterNeighbors,
  Workspace,
} from '../coach/contracts.ts'
import { defaultRosterDiscovery } from '../coach/contracts.ts'
import { executeMutation, type DataErrorCode } from './mutations.ts'
import {
  parseCampaignRow,
  parseListEnvelope,
  parsePlayerRow,
  parseStage,
  readRpcError,
} from './coachList.ts'

type Client = SupabaseClient<ApplicationDatabase>
const ok = <T>(value: T): DataResult<T> => ({ ok: true, value })
const failure = (
  code: DataErrorCode,
  requestId: string = crypto.randomUUID(),
): DataResult<never> => ({ ok: false, code, requestId })
const readError = readRpcError
const safe = <T>(work: () => Promise<DataResult<T>>) =>
  work().catch(() => failure('NETWORK_ERROR'))
const text = (value: unknown): FeedbackText | undefined => {
  const parsed = validateFeedbackText(value, false)
  return parsed.ok ? parsed.value : undefined
}
const content = (row: Record<string, unknown>) =>
  text({
    observations: row.observations,
    strengths: row.strengths,
    developmentFocus: row.development_focus ?? row.developmentFocus,
    observedOn: row.observed_on ?? row.observedOn,
  })
const actorFrom = (value: unknown): Actor | undefined => {
  const access = readAccess(value)
  return access?.enabled
    ? {
        id: access.id,
        displayName: access.displayName,
        accessVersion: access.version,
      }
    : undefined
}
const draftFrom = (value: unknown): Draft | undefined => {
  const row = record(value)
  const body = row ? content(row) : undefined
  return row && isUuid(row.id) && typeof row.version === 'number' && body
    ? { id: row.id, version: row.version, content: body }
    : undefined
}
const parseRequirements = (value: unknown) => {
  const row = record(value)
  if (
    !row ||
    row.scope !== 'self' ||
    typeof row.frozen !== 'boolean' ||
    (row.frozenRequiredCount !== null &&
      typeof row.frozenRequiredCount !== 'number')
  )
    return undefined
  return {
    scope: 'self' as const,
    frozen: row.frozen,
    frozenRequiredCount:
      row.frozenRequiredCount === null
        ? null
        : (row.frozenRequiredCount as number),
  }
}
const parseCampaignContext = (value: unknown): CampaignContext | undefined => {
  const row = record(value)
  const requirements = parseRequirements(row?.requirements)
  const stage = parseStage(row?.stage)
  if (
    !row ||
    !requirements ||
    !stage ||
    !isUuid(row.campaignId) ||
    typeof row.name !== 'string' ||
    typeof row.teamName !== 'string' ||
    typeof row.competitionName !== 'string' ||
    typeof row.version !== 'number' ||
    typeof row.membershipVersion !== 'number' ||
    typeof row.membershipActive !== 'boolean' ||
    row.correctionSupport !== 'unavailable' ||
    !Array.isArray(row.writeKinds) ||
    row.writeKinds.length !== 1 ||
    row.writeKinds[0] !== 'preparation'
  )
    return undefined
  return {
    campaign: {
      id: row.campaignId,
      name: row.name,
      team: row.teamName,
      competition: row.competitionName,
      stage,
      version: row.version,
      membershipVersion: row.membershipVersion,
      isActive: row.membershipActive,
      frozen: requirements.frozen,
    },
    requirements,
    writeKinds: ['preparation'],
    correctionSupport: 'unavailable',
  }
}
const parsePlayerContext = (value: unknown): PlayerContext | undefined => {
  const row = record(value)
  const context = parseCampaignContext(row?.campaignContext ?? row)
  if (
    !row ||
    !context ||
    !isUuid(row.playerId) ||
    typeof row.displayName !== 'string' ||
    typeof row.membershipActive !== 'boolean' ||
    typeof row.membershipVersion !== 'number' ||
    typeof row.filterMatch !== 'boolean' ||
    typeof row.preparationWritable !== 'boolean'
  )
    return undefined
  const draft =
    row.draft === null || row.draft === undefined
      ? undefined
      : draftFrom(row.draft)
  if (row.draft !== null && row.draft !== undefined && !draft) return undefined
  return {
    context,
    player: {
      id: row.playerId,
      displayName: row.displayName,
      isActive: row.membershipActive,
      membershipVersion: row.membershipVersion,
      obligation: 'none',
      waiverReason: undefined,
    },
    filterMatch: row.filterMatch,
    preparationWritable: row.preparationWritable,
    draft,
  }
}
const parseHistorySummary = (value: unknown): HistorySummary | undefined => {
  const row = record(value)
  const kind = row?.kind
  const observedOn =
    typeof row?.observedOn === 'string'
      ? row.observedOn
      : row?.observedOn instanceof String
        ? String(row.observedOn)
        : typeof row?.observedOn === 'object' && row?.observedOn !== null
          ? String(row.observedOn)
          : undefined
  if (
    !row ||
    !isUuid(row.feedbackId) ||
    (kind !== 'preparation' && kind !== 'final') ||
    !observedOn ||
    typeof row.submittedAt !== 'string' ||
    typeof row.preview !== 'string'
  )
    return undefined
  return {
    id: row.feedbackId,
    kind,
    observedOn,
    submittedAt: row.submittedAt,
    preview: row.preview,
  }
}
const parseNeighbor = (value: unknown) => {
  const row = record(value)
  if (
    !row ||
    !isUuid(row.playerId) ||
    typeof row.displayName !== 'string' ||
    typeof row.membershipVersion !== 'number'
  )
    return undefined
  return {
    playerId: row.playerId,
    displayName: row.displayName,
    membershipVersion: row.membershipVersion,
  }
}
const rosterArgs = (discovery: RosterDiscoveryQuery) => ({
  query: discovery.text?.trim() || null,
  membership: discovery.membership,
  drafts: discovery.drafts,
})
const toWorkspace = (value: PlayerContext): Workspace => ({
  campaign: value.context.campaign,
  player: value.player,
  draft: value.draft,
  finalEntry: undefined,
})

export const createLiveCoachAdapter = (client: Client): CoachAdapter => {
  const getAccess = (actor: Actor) =>
    safe(async () => {
      const result = await client.rpc('get_my_access')
      const error = readError(result.error)
      if (error) return error
      const current = actorFrom(result.data)
      return current?.id === actor.id ? ok(current) : failure('FORBIDDEN')
    })
  const readCommit = async (
    command: Command,
    id: string | undefined,
  ): Promise<DataResult<Commit>> => {
    if (command.action === 'discard') return ok({ type: 'discard' })
    if (!id) return failure('INVALID_RESPONSE', command.mutationId)
    if (command.action === 'save') {
      const result = await client
        .from('feedback_entries')
        .select(
          'id,version,observations,strengths,development_focus,observed_on',
        )
        .eq('id', id)
        .eq('status', 'draft')
        .eq('coach_id', command.context.actorId)
        .maybeSingle()
      const error = readError(result.error)
      if (error) return error
      const draft = result.data ? draftFrom(result.data) : undefined
      return result.data && !draft
        ? failure('INVALID_RESPONSE', command.mutationId)
        : ok({ type: 'draft', draft })
    }
    const detail = await client.rpc('get_coach_feedback_entry', {
      campaign_id: command.context.campaignId,
      player_id: command.context.playerId,
      feedback_id: id,
    })
    const detailError = readError(detail.error)
    if (detailError) return detailError
    const row = record(detail.data)
    const body = row ? content(row) : undefined
    if (
      !row ||
      !body ||
      (row.kind !== 'preparation' && row.kind !== 'final') ||
      typeof row.submittedAt !== 'string'
    )
      return failure('INVALID_RESPONSE', command.mutationId)
    return ok({
      type: 'submission',
      entry: {
        id: id,
        kind: row.kind as FeedbackKind,
        content: body,
        submittedAt: row.submittedAt,
        corrections: [],
      },
    })
  }
  const loadPlayerContext = (
    actor: Actor,
    campaignId: string,
    playerId: string,
    discovery: RosterDiscoveryQuery,
    signal: AbortSignal,
  ): Promise<DataResult<PlayerContext>> =>
    safe(async () => {
      const access = await getAccess(actor)
      if (!access.ok) return access
      const result = await client
        .rpc('get_coach_player_context', {
          campaign_id: campaignId,
          player_id: playerId,
          ...rosterArgs(discovery),
        })
        .abortSignal(signal)
      const error = readError(result.error)
      if (error) return error
      const value = parsePlayerContext(result.data)
      return value ? ok(value) : failure('INVALID_RESPONSE')
    })
  return {
    evidence: 'live',
    getAccess,
    signIn: (email, password) =>
      safe(async () => {
        const login = await client.auth.signInWithPassword({ email, password })
        if (login.error || !login.data.user) return failure('AUTH_REQUIRED')
        const access = await client.rpc('get_my_access')
        const actor = actorFrom(access.data)
        return actor ? ok(actor) : failure('FORBIDDEN')
      }),
    signOut: async () => {
      await client.auth.signOut({ scope: 'local' })
    },
    loadCampaignContext: (actor, campaignId, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const result = await client
          .rpc('get_coach_campaign_context', { campaign_id: campaignId })
          .abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const value = parseCampaignContext(result.data)
        return value ? ok(value) : failure('INVALID_RESPONSE')
      }),
    loadCampaigns: (actor, discovery, cursor, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const result = await client
          .rpc('list_coach_campaigns', {
            mode: discovery.mode,
            query: discovery.text?.trim() || null,
            stage: discovery.stage ?? null,
            cursor: cursor ?? null,
            page_size: 20,
          })
          .abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const page = parseListEnvelope(result.data, (item) => {
          const row = parseCampaignRow(item)
          return row
            ? {
                ...row,
                frozen: false,
              }
            : undefined
        })
        return page
      }),
    loadRoster: (actor, campaignId, discovery, cursor, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const result = await client
          .rpc('list_coach_roster', {
            campaign_id: campaignId,
            ...rosterArgs(discovery),
            cursor: cursor ?? null,
            page_size: 20,
          })
          .abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        return parseListEnvelope(result.data, parsePlayerRow)
      }),
    loadPlayerContext,
    loadRosterNeighbors: (actor, campaignId, playerId, discovery, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const result = await client
          .rpc('get_coach_roster_neighbors', {
            campaign_id: campaignId,
            player_id: playerId,
            ...rosterArgs(discovery),
          })
          .abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const row = record(result.data)
        if (
          !row ||
          typeof row.queryFingerprint !== 'string' ||
          typeof row.selectedMatch !== 'boolean'
        )
          return failure('INVALID_RESPONSE')
        const previous =
          row.previous === null || row.previous === undefined
            ? undefined
            : parseNeighbor(row.previous)
        const next =
          row.next === null || row.next === undefined
            ? undefined
            : parseNeighbor(row.next)
        if (
          (row.previous !== null && row.previous !== undefined && !previous) ||
          (row.next !== null && row.next !== undefined && !next)
        )
          return failure('INVALID_RESPONSE')
        const value: RosterNeighbors = {
          queryFingerprint: row.queryFingerprint,
          selectedMatch: row.selectedMatch,
          previous,
          next,
        }
        return ok(value)
      }),
    loadWorkspace: (actor, campaignId, playerId, _kind, signal) =>
      safe(async () => {
        const context = await loadPlayerContext(
          actor,
          campaignId,
          playerId,
          defaultRosterDiscovery,
          signal,
        )
        return context.ok ? ok(toWorkspace(context.value)) : context
      }),
    loadHistory: (actor, campaignId, playerId, discovery, cursor, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const result = await client
          .rpc('list_coach_feedback_history', {
            campaign_id: campaignId,
            player_id: playerId,
            observed_from: discovery.observedFrom?.trim() || null,
            observed_to: discovery.observedTo?.trim() || null,
            cursor: cursor ?? null,
            page_size: 20,
          })
          .abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        return parseListEnvelope(result.data, parseHistorySummary)
      }),
    loadFeedbackEntry: (actor, campaignId, playerId, feedbackId, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const result = await client
          .rpc('get_coach_feedback_entry', {
            campaign_id: campaignId,
            player_id: playerId,
            feedback_id: feedbackId,
          })
          .abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const row = record(result.data)
        const body = row ? content(row) : undefined
        if (
          !row ||
          !isUuid(row.feedbackId) ||
          !body ||
          (row.kind !== 'preparation' && row.kind !== 'final') ||
          typeof row.submittedAt !== 'string'
        )
          return failure('INVALID_RESPONSE')
        return ok({
          id: row.feedbackId,
          kind: row.kind,
          content: body,
          submittedAt: row.submittedAt,
          corrections: [],
        })
      }),
    mutate: (actor, command) =>
      safe(async () => {
        if (
          command.context.actorId !== actor.id ||
          command.context.kind !== 'preparation' ||
          (command.voiceBindings.length > 0 && !command.voiceSessionIds?.length)
        )
          return failure('FORBIDDEN', command.mutationId)
        const access = await getAccess(actor)
        if (!access.ok) return access
        const args = {
          mutation_id: command.mutationId,
          campaign_id: command.context.campaignId,
          player_id: command.context.playerId,
          kind: 'preparation' as const,
          content: {
            observations: command.content.observations,
            strengths: command.content.strengths,
            development_focus: command.content.developmentFocus,
            observed_on: command.content.observedOn,
          },
          review_confirmed: true,
          draft_id: command.draftId ?? null,
          expected_version: command.expectedVersion ?? null,
          voice_session_ids: [...(command.voiceSessionIds ?? [])],
        }
        const result =
          command.action === 'discard'
            ? command.draftId && command.expectedVersion
              ? await executeMutation(client, {
                  action: 'discard_feedback_draft',
                  inputs: {
                    mutation_id: command.mutationId,
                    draft_id: command.draftId,
                    expected_version: command.expectedVersion,
                  },
                })
              : undefined
            : await executeMutation(client, {
                action:
                  command.action === 'save'
                    ? 'save_feedback_draft'
                    : 'submit_feedback',
                inputs: args,
              })
        if (!result) return failure('INVALID_INPUT', command.mutationId)
        if (!result.ok)
          return failure(
            result.code === 'INVALID_RESPONSE' ? 'NETWORK_ERROR' : result.code,
            command.mutationId,
          )
        return readCommit(
          command,
          'id' in result.value.result ? result.value.result.id : undefined,
        )
      }),
    checkPendingResult: async (actor, command) => {
      try {
        const access = await getAccess(actor)
        if (!access.ok) return { status: 'resolved', result: access }
        const receipt = await client
          .from('mutation_receipts')
          .select('actor_id,mutation_id,action,result_id')
          .eq('actor_id', actor.id)
          .eq('mutation_id', command.mutationId)
          .maybeSingle()
        if (receipt.error || !receipt.data) return { status: 'unknown' }
        const expected =
          command.action === 'save'
            ? 'save_feedback_draft'
            : command.action === 'submit'
              ? 'submit_feedback'
              : 'discard_feedback_draft'
        if (receipt.data.action !== expected)
          return {
            status: 'resolved',
            result: failure('IDEMPOTENCY_CONFLICT', command.mutationId),
          }
        const result = await readCommit(command, receipt.data.result_id)
        return result.ok ||
          !['NETWORK_ERROR', 'DATABASE_ERROR', 'INVALID_RESPONSE'].includes(
            result.code,
          )
          ? { status: 'resolved', result }
          : { status: 'unknown' }
      } catch {
        return { status: 'unknown' }
      }
    },
  }
}
