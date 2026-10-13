import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../../domain/database.ts'
import { isUuid, readAccess, record } from '../../domain/accounts.ts'
import {
  validateFeedbackText,
  type FeedbackText,
} from '../../domain/feedback.ts'
import type {
  Actor,
  Campaign,
  CoachAdapter,
  Command,
  Commit,
  Correction,
  DataResult,
  Draft,
  Entry,
  Page,
  Player,
  Workspace,
} from '../coach/contracts.ts'
import { executeMutation, type DataErrorCode } from './mutations.ts'

type Client = SupabaseClient<ApplicationDatabase>
const ok = <T>(value: T): DataResult<T> => ({ ok: true, value })
const failure = (
  code: DataErrorCode,
  requestId: string = crypto.randomUUID(),
): DataResult<never> => ({ ok: false, code, requestId })
const readError = (error: { code?: string; message?: string } | null) =>
  error
    ? failure(
        error.code === ''
          ? 'NETWORK_ERROR'
          : [
                'FORBIDDEN',
                'AUTH_REQUIRED',
                'NOT_FOUND',
                'INVALID_INPUT',
              ].includes(error.message ?? '')
            ? (error.message as DataErrorCode)
            : 'DATABASE_ERROR',
      )
    : undefined
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
    developmentFocus: row.development_focus,
    observedOn: row.observed_on,
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
const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) return undefined
  try {
    const value = record(JSON.parse(atob(cursor)))
    return value &&
      isUuid(value.id) &&
      typeof value.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(value.at) &&
      Number.isFinite(Date.parse(value.at))
      ? { id: value.id, at: value.at }
      : null
  } catch {
    return null
  }
}
const page = <T>(
  rows: readonly T[],
  last: { id: string; at: string } | undefined,
): Page<T> => ({
  rows: rows.slice(0, 20),
  nextCursor: rows.length > 20 && last ? btoa(JSON.stringify(last)) : undefined,
})
const campaignFrom = (value: unknown): Campaign | undefined => {
  const row = record(value)
  const competition = record(row?.competition)
  const memberships = row?.membership
  const member = Array.isArray(memberships)
    ? record(memberships[0])
    : record(memberships)
  if (
    !row ||
    !isUuid(row.id) ||
    typeof row.name !== 'string' ||
    typeof row.team_name !== 'string' ||
    typeof competition?.name !== 'string' ||
    ![
      'setup',
      'preparation',
      'competition',
      'final_feedback',
      'closed',
    ].includes(String(row.stage)) ||
    typeof row.version !== 'number' ||
    typeof member?.version !== 'number' ||
    typeof member.is_active !== 'boolean'
  )
    return undefined
  return {
    id: row.id,
    name: row.name,
    team: row.team_name,
    competition: competition.name,
    stage: row.stage as Campaign['stage'],
    version: row.version,
    membershipVersion: member.version,
    isActive: member.is_active,
    frozen: row.requirements_frozen_at !== null,
  }
}
const playerFrom = (value: unknown): Player | undefined => {
  const row = record(value)
  const profile = record(row?.profile)
  if (
    !row ||
    !isUuid(row.player_id) ||
    typeof profile?.display_name !== 'string' ||
    typeof row.is_active !== 'boolean' ||
    typeof row.version !== 'number'
  )
    return undefined
  return {
    id: row.player_id,
    displayName: profile.display_name,
    isActive: row.is_active,
    membershipVersion: row.version,
    obligation: 'none',
    waiverReason: undefined,
  }
}
const draftFrom = (value: unknown): Draft | undefined => {
  const row = record(value)
  const body = row ? content(row) : undefined
  return row && isUuid(row.id) && typeof row.version === 'number' && body
    ? { id: row.id, version: row.version, content: body }
    : undefined
}

export const createLiveCoachAdapter = (client: Client): CoachAdapter => {
  const getAccess = (actor: Actor) =>
    safe(async () => {
      const result = await client.rpc('get_my_access')
      const error = readError(result.error)
      if (error) return error
      const current = actorFrom(result.data)
      return current?.id === actor.id ? ok(current) : failure('FORBIDDEN')
    })
  const campaigns = () =>
    client
      .from('campaigns')
      .select(
        'id,name,team_name,stage,version,created_at,requirements_frozen_at,competition:competitions(name),membership:campaign_coaches!inner(coach_id,is_active,version)',
      )
  const roster = () =>
    client
      .from('campaign_players')
      .select(
        'player_id,is_active,version,created_at,profile:profiles(id,display_name)',
      )
  const loadCampaign = (
    actor: Actor,
    campaignId: string,
    signal: AbortSignal,
  ): Promise<DataResult<Campaign>> =>
    safe(async () => {
      const access = await getAccess(actor)
      if (!access.ok) return access
      const result = await campaigns()
        .eq('id', campaignId)
        .eq('membership.coach_id', actor.id)
        .abortSignal(signal)
        .maybeSingle()
      const error = readError(result.error)
      if (error) return error
      const value = campaignFrom(result.data)
      return value ? ok(value) : failure('NOT_FOUND')
    })
  const corrections = async (
    entryId: string,
    signal: AbortSignal,
  ): Promise<DataResult<readonly Correction[]>> => {
    const items: Correction[] = []
    let revision = 0
    while (!signal.aborted) {
      const result = await client
        .from('feedback_corrections')
        .select(
          'id,revision,observations,strengths,development_focus,observed_on,reason,created_at',
        )
        .eq('feedback_id', entryId)
        .gt('revision', revision)
        .order('revision')
        .limit(100)
        .abortSignal(signal)
      const error = readError(result.error)
      if (error) return error
      for (const item of result.data ?? []) {
        const body = content(item)
        if (!body) return failure('INVALID_RESPONSE')
        items.push({
          id: item.id,
          revision: item.revision,
          content: body,
          reason: item.reason,
          correctedAt: item.created_at,
        })
        revision = item.revision
      }
      if ((result.data?.length ?? 0) < 100) return ok(items)
    }
    return failure('NETWORK_ERROR')
  }
  const entryFrom = async (
    value: unknown,
    signal: AbortSignal,
  ): Promise<DataResult<Entry>> => {
    const row = record(value)
    const body = text(row?.original)
    if (
      !row ||
      !isUuid(row.id) ||
      !body ||
      typeof row.submitted_at !== 'string' ||
      (row.kind !== 'preparation' && row.kind !== 'final')
    )
      return failure('INVALID_RESPONSE')
    const changes = await corrections(row.id, signal)
    return changes.ok
      ? ok({
          id: row.id,
          kind: row.kind,
          content: body,
          submittedAt: row.submitted_at,
          corrections: changes.value,
        })
      : changes
  }
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
    const result = await client
      .from('feedback_history')
      .select('id,kind,original,submitted_at')
      .eq('id', id)
      .eq('coach_id', command.context.actorId)
      .maybeSingle()
    const error = readError(result.error)
    if (error) return error
    const entry = await entryFrom(result.data, new AbortController().signal)
    return entry.ok ? ok({ type: 'submission', entry: entry.value }) : entry
  }
  const loadWorkspace = (
    actor: Actor,
    campaignId: string,
    playerId: string,
    kind: 'preparation' | 'final' | undefined,
    signal: AbortSignal,
  ): Promise<DataResult<Workspace>> =>
    safe(async () => {
      const campaign = await loadCampaign(actor, campaignId, signal)
      if (!campaign.ok) return campaign
      const result = await roster()
        .eq('campaign_id', campaignId)
        .eq('player_id', playerId)
        .abortSignal(signal)
        .maybeSingle()
      const error = readError(result.error)
      if (error) return error
      const player = playerFrom(result.data)
      if (!player) return failure('NOT_FOUND')
      let draft: Draft | undefined
      if (kind !== 'final') {
        const saved = await client
          .from('feedback_entries')
          .select(
            'id,version,observations,strengths,development_focus,observed_on',
          )
          .eq('campaign_id', campaignId)
          .eq('player_id', playerId)
          .eq('coach_id', actor.id)
          .eq('kind', 'preparation')
          .eq('status', 'draft')
          .abortSignal(signal)
          .maybeSingle()
        const draftError = readError(saved.error)
        if (draftError) return draftError
        draft = saved.data ? draftFrom(saved.data) : undefined
        if (saved.data && !draft) return failure('INVALID_RESPONSE')
      }
      return ok({
        campaign: campaign.value,
        player,
        draft,
        finalEntry: undefined,
      })
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
    loadCampaign,
    loadCampaigns: (actor, cursor, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const after = decodeCursor(cursor)
        if (after === null) return failure('INVALID_INPUT')
        let query = campaigns()
          .eq('membership.coach_id', actor.id)
          .order('created_at')
          .order('id')
          .limit(21)
        if (after)
          query = query.or(
            `created_at.gt.${after.at},and(created_at.eq.${after.at},id.gt.${after.id})`,
          )
        const result = await query.abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const mapped = (result.data ?? []).map(campaignFrom)
        if (mapped.some((item) => !item)) return failure('INVALID_RESPONSE')
        const last = result.data?.[19]
        return ok(
          page(
            mapped as Campaign[],
            last ? { id: last.id, at: last.created_at } : undefined,
          ),
        )
      }),
    loadRoster: (actor, campaignId, cursor, signal) =>
      safe(async () => {
        const campaign = await loadCampaign(actor, campaignId, signal)
        if (!campaign.ok) return campaign
        const after = decodeCursor(cursor)
        if (after === null) return failure('INVALID_INPUT')
        let query = roster()
          .eq('campaign_id', campaignId)
          .order('created_at')
          .order('player_id')
          .limit(21)
        if (after)
          query = query.or(
            `created_at.gt.${after.at},and(created_at.eq.${after.at},player_id.gt.${after.id})`,
          )
        const result = await query.abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const mapped = (result.data ?? []).map(playerFrom)
        if (mapped.some((item) => !item)) return failure('INVALID_RESPONSE')
        const last = result.data?.[19]
        return ok(
          page(
            mapped as Player[],
            last ? { id: last.player_id, at: last.created_at } : undefined,
          ),
        )
      }),
    loadWorkspace,
    loadHistory: (actor, campaignId, playerId, cursor, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const after = decodeCursor(cursor)
        if (after === null) return failure('INVALID_INPUT')
        let query = client
          .from('feedback_history')
          .select('id,kind,original,submitted_at')
          .eq('campaign_id', campaignId)
          .eq('player_id', playerId)
          .eq('coach_id', actor.id)
          .order('submitted_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(21)
        if (after)
          query = query.or(
            `submitted_at.lt.${after.at},and(submitted_at.eq.${after.at},id.lt.${after.id})`,
          )
        const result = await query.abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const entries: Entry[] = []
        for (const item of result.data ?? []) {
          const parsed = await entryFrom(item, signal)
          if (!parsed.ok) return parsed
          entries.push(parsed.value)
        }
        const last = result.data?.[19]
        return ok(
          page(
            entries,
            last?.id && last.submitted_at
              ? { id: last.id, at: last.submitted_at }
              : undefined,
          ),
        )
      }),
    loadCompletion: (actor, campaignId, signal) =>
      safe(async () => {
        const access = await getAccess(actor)
        if (!access.ok) return access
        const result = await client
          .rpc('get_campaign_completion', { campaign_id: campaignId })
          .abortSignal(signal)
        const error = readError(result.error)
        if (error) return error
        const row = record(result.data)
        return row?.scope === 'self' &&
          typeof row.frozen === 'boolean' &&
          typeof row.submitted === 'number' &&
          typeof row.waived === 'number' &&
          typeof row.outstanding === 'number'
          ? ok({
              scope: 'self',
              frozen: row.frozen,
              submitted: row.submitted,
              waived: row.waived,
              outstanding: row.outstanding,
            })
          : failure('INVALID_RESPONSE')
      }),
    mutate: (actor, command) =>
      safe(async () => {
        if (
          command.context.actorId !== actor.id ||
          command.context.kind !== 'preparation' ||
          command.voiceBindings.length
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
