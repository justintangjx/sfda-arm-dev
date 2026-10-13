import {
  validateFeedbackText,
  voiceContextMatches,
  type FeedbackKind,
} from '../../domain/feedback'
import { bindingFor, kindForStage, singaporeToday, writable } from './editor'
import type {
  Actor,
  Campaign,
  CampaignContext,
  CoachAdapter,
  Command,
  Commit,
  DataResult,
  Draft,
  Entry,
  HistorySummary,
  Page,
  Player,
  PlayerContext,
  RosterNeighbors,
  Workspace,
} from './contracts'

// Synthetic UI evidence only. This factory is never constructed for live configuration.
export const sampleActor: Actor = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Sample Coach',
  accessVersion: 1,
}
export const sampleCampaignId = '10000000-0000-4000-8000-000000000001'
export const samplePlayerId = 'a0000001-0000-4000-8000-000000000001'
const success = <T>(value: T): DataResult<T> => ({ ok: true, value })
const failure = <T>(
  code:
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'STAGE_LOCKED'
    | 'VERSION_CONFLICT'
    | 'INVALID_INPUT'
    | 'ALREADY_SUBMITTED',
  requestId: string = crypto.randomUUID(),
): DataResult<T> => ({ ok: false, code, requestId })
const pageOf = <T extends { id: string }>(
  rows: readonly T[],
  cursor: string | undefined,
): Page<T> => {
  const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0
  const page = rows.slice(start, start + 20)
  return {
    rows: page,
    nextCursor: start + page.length < rows.length ? page.at(-1)?.id : undefined,
  }
}
const keyFor = (campaignId: string, playerId: string, kind: FeedbackKind) =>
  `${campaignId}/${playerId}/${kind}`
export const createFixtureAdapter = (
  options: Readonly<{ wait?: () => Promise<void> }> = {},
) => {
  const wait =
    options.wait ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 120)))
  let actorEnabled = true
  let campaigns: readonly Campaign[] = [
    {
      id: sampleCampaignId,
      name: 'Sample preparation campaign',
      team: 'Sample Open Team',
      competition: 'Sample Regional Competition',
      stage: 'preparation',
      version: 1,
      membershipVersion: 1,
      isActive: true,
      frozen: false,
    },
    ...(
      [
        'final_feedback',
        'competition',
        'closed',
        'setup',
        'preparation',
      ] as const
    ).map((stage, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
      name: [
        'Sample final assessments',
        'Sample competition pause',
        'Sample closed campaign',
        'Sample upcoming campaign',
        'Sample historical campaign',
      ][index],
      team: 'Sample Mixed Team',
      competition: 'Sample Invitational',
      stage,
      version: 1,
      membershipVersion: 1,
      isActive: index !== 4,
      frozen: stage === 'final_feedback' || stage === 'closed',
    })),
  ]
  const players: readonly Player[] = Array.from({ length: 23 }, (_, index) => ({
    id:
      index === 0
        ? samplePlayerId
        : index === 1
          ? 'a0000001-0000-4000-8000-000000000002'
          : `a${String(index + 1).padStart(7, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    displayName:
      index === 0
        ? 'Sample Player One'
        : index === 1
          ? 'Sample Player With a Longer Display Name'
          : `Sample Player ${index + 1}`,
    isActive: index !== 3,
    membershipVersion: 1,
    obligation: index === 2 ? 'waived' : 'outstanding',
    waiverReason:
      index === 2 ? 'Sample admin waiver, assessment not required.' : undefined,
  }))
  let drafts: Readonly<Record<string, Draft>> = {}
  let entries: Readonly<Record<string, readonly Entry[]>> = {
    [`${sampleCampaignId}/${samplePlayerId}`]: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        kind: 'preparation',
        content: {
          observations:
            'Sample observation: kept a clear passing option available during the practice drill.',
          strengths: 'Sample strength: communication with teammates.',
          developmentFocus: 'Sample focus: reset positioning after a turnover.',
          observedOn: '2026-10-01',
        },
        submittedAt: '2026-10-01T10:00:00Z',
        corrections: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            revision: 1,
            content: {
              observations:
                'Sample corrected observation: kept a clear passing option available during the afternoon practice drill.',
              strengths: 'Sample strength: communication with teammates.',
              developmentFocus:
                'Sample focus: reset positioning after a turnover.',
              observedOn: '2026-10-01',
            },
            reason: 'Sample correction to clarify the practice session.',
            correctedAt: '2026-10-02T02:00:00Z',
          },
        ],
      },
    ],
  }
  const receipts = new Map<string, DataResult<Commit>>()
  const access = (actor: Actor) => actorEnabled && actor.id === sampleActor.id
  const workspaceFor = (
    actor: Actor,
    campaignId: string,
    playerId: string,
    kind: FeedbackKind | undefined,
  ): Workspace | undefined => {
    if (!access(actor)) return undefined
    const campaign = campaigns.find((item) => item.id === campaignId)
    const basePlayer = players.find((item) => item.id === playerId)
    if (!campaign || !basePlayer) return undefined
    const finalEntry = entries[`${campaignId}/${playerId}`]?.find(
      (item) => item.kind === 'final',
    )
    const player: Player = {
      ...basePlayer,
      obligation: !campaign.frozen
        ? 'none'
        : finalEntry
          ? 'submitted'
          : basePlayer.obligation,
    }
    const draftKind = kind ?? kindForStage(campaign.stage)
    return {
      campaign,
      player,
      draft: draftKind
        ? drafts[keyFor(campaignId, playerId, draftKind)]
        : undefined,
      finalEntry,
    }
  }
  const adapter: CoachAdapter = {
    evidence: 'fixture',
    signIn: async () => failure('FORBIDDEN'),
    getAccess: async (actor) =>
      access(actor) ? success(sampleActor) : failure('FORBIDDEN'),
    signOut: async () => {},
    loadCampaigns: async (actor, discovery, cursor) => {
      await wait()
      if (!access(actor)) return failure('FORBIDDEN')
      const filtered = campaigns.filter((campaign) => {
        const current = campaign.isActive && campaign.stage !== 'closed'
        const modeOk = discovery.mode === 'current' ? current : !current
        const stageOk = !discovery.stage || campaign.stage === discovery.stage
        const text = discovery.text?.trim().toLowerCase()
        const textOk =
          !text ||
          campaign.name.toLowerCase().includes(text) ||
          campaign.team.toLowerCase().includes(text) ||
          campaign.competition.toLowerCase().includes(text)
        return modeOk && stageOk && textOk
      })
      return success(pageOf(filtered, cursor))
    },
    loadCampaignContext: async (actor, campaignId) => {
      await wait()
      const campaign = campaigns.find((item) => item.id === campaignId)
      if (!access(actor) || !campaign) return failure('NOT_FOUND')
      const value: CampaignContext = {
        campaign,
        requirements: {
          scope: 'self',
          frozen: campaign.frozen,
          frozenRequiredCount: campaign.frozen ? 1 : null,
        },
        writeKinds: ['preparation'],
        correctionSupport: 'unavailable',
      }
      return success(value)
    },
    loadRoster: async (actor, campaignId, discovery, cursor) => {
      await wait()
      if (!access(actor) || !campaigns.some((item) => item.id === campaignId))
        return failure('NOT_FOUND')
      const roster = players
        .map(
          (player) =>
            workspaceFor(actor, campaignId, player.id, undefined)!.player,
        )
        .filter((player) => {
          const membershipOk =
            discovery.membership === 'all' ||
            (discovery.membership === 'active' && player.isActive) ||
            (discovery.membership === 'withdrawn' && !player.isActive)
          const text = discovery.text?.trim().toLowerCase()
          const textOk =
            !text ||
            player.displayName.toLowerCase().includes(text) ||
            player.id.startsWith(text)
          const draftKey = keyFor(campaignId, player.id, 'preparation')
          const hasDraft = Boolean(drafts[draftKey])
          const draftOk = discovery.drafts === 'all' || hasDraft
          return membershipOk && textOk && draftOk
        })
        .map((player) => ({
          ...player,
          hasSavedPreparationDraft: Boolean(
            drafts[keyFor(campaignId, player.id, 'preparation')],
          ),
          preparationSubmissionCount: String(
            (entries[`${campaignId}/${player.id}`] ?? []).filter(
              (entry) => entry.kind === 'preparation',
            ).length,
          ),
          latestPreparationSubmittedAt: (
            entries[`${campaignId}/${player.id}`] ?? []
          ).find((entry) => entry.kind === 'preparation')?.submittedAt,
        }))
      return success(pageOf(roster, cursor))
    },
    loadPlayerContext: async (actor, campaignId, playerId, discovery) => {
      await wait()
      const workspace = workspaceFor(actor, campaignId, playerId, undefined)
      if (!workspace) return failure('NOT_FOUND')
      const player = workspace.player
      const membershipOk =
        discovery.membership === 'all' ||
        (discovery.membership === 'active' && player.isActive) ||
        (discovery.membership === 'withdrawn' && !player.isActive)
      const text = discovery.text?.trim().toLowerCase()
      const textOk =
        !text ||
        player.displayName.toLowerCase().includes(text) ||
        player.id.startsWith(text)
      const hasDraft = Boolean(
        drafts[keyFor(campaignId, playerId, 'preparation')],
      )
      const draftOk = discovery.drafts === 'all' || hasDraft
      const filterMatch = membershipOk && textOk && draftOk
      const value: PlayerContext = {
        context: {
          campaign: workspace.campaign,
          requirements: {
            scope: 'self',
            frozen: workspace.campaign.frozen,
            frozenRequiredCount: workspace.campaign.frozen ? 1 : null,
          },
          writeKinds: ['preparation'],
          correctionSupport: 'unavailable',
        },
        player: workspace.player,
        filterMatch: Boolean(filterMatch),
        preparationWritable: writable(workspace, 'preparation'),
        draft: workspace.draft,
      }
      return success(value)
    },
    loadRosterNeighbors: async (actor, campaignId, playerId, discovery) => {
      await wait()
      if (!access(actor) || !campaigns.some((item) => item.id === campaignId))
        return failure('NOT_FOUND')
      const rosterRows = players
        .map(
          (item) => workspaceFor(actor, campaignId, item.id, undefined)!.player,
        )
        .filter((item) => {
          const membershipOk =
            discovery.membership === 'all' ||
            (discovery.membership === 'active' && item.isActive) ||
            (discovery.membership === 'withdrawn' && !item.isActive)
          const text = discovery.text?.trim().toLowerCase()
          const textOk =
            !text ||
            item.displayName.toLowerCase().includes(text) ||
            item.id.startsWith(text)
          const hasDraft = Boolean(
            drafts[keyFor(campaignId, item.id, 'preparation')],
          )
          const draftOk = discovery.drafts === 'all' || hasDraft
          return membershipOk && textOk && draftOk
        })
      const ids = rosterRows.map((row) => row.id)
      const index = ids.indexOf(playerId)
      const at = (id: string) => rosterRows.find((row) => row.id === id)!
      const value: RosterNeighbors = {
        queryFingerprint: 'fixture',
        selectedMatch: index >= 0,
        previous:
          index > 0
            ? {
                playerId: ids[index - 1]!,
                displayName: at(ids[index - 1]!).displayName,
                membershipVersion: at(ids[index - 1]!).membershipVersion,
              }
            : undefined,
        next:
          index >= 0 && index < ids.length - 1
            ? {
                playerId: ids[index + 1]!,
                displayName: at(ids[index + 1]!).displayName,
                membershipVersion: at(ids[index + 1]!).membershipVersion,
              }
            : undefined,
      }
      return success(value)
    },
    loadWorkspace: async (actor, campaignId, playerId, kind) => {
      await wait()
      const workspace = workspaceFor(actor, campaignId, playerId, kind)
      return workspace ? success(workspace) : failure('NOT_FOUND')
    },
    loadHistory: async (actor, campaignId, playerId, _discovery, cursor) => {
      await wait()
      if (!workspaceFor(actor, campaignId, playerId, undefined))
        return failure('NOT_FOUND')
      const summaries: HistorySummary[] = (
        entries[`${campaignId}/${playerId}`] ?? []
      ).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        observedOn: entry.content.observedOn ?? '',
        submittedAt: entry.submittedAt,
        preview: (entry.content.observations ?? '').slice(0, 160),
      }))
      return success(pageOf(summaries, cursor))
    },
    loadFeedbackEntry: async (actor, campaignId, playerId, feedbackId) => {
      await wait()
      if (!workspaceFor(actor, campaignId, playerId, undefined))
        return failure('NOT_FOUND')
      const entry = (entries[`${campaignId}/${playerId}`] ?? []).find(
        (item) => item.id === feedbackId,
      )
      return entry ? success(entry) : failure('NOT_FOUND')
    },
    mutate: async (actor, command) => {
      await wait()
      const receipt = receipts.get(command.mutationId)
      if (receipt) return receipt
      const workspace = workspaceFor(
        actor,
        command.context.campaignId,
        command.context.playerId,
        command.context.kind,
      )
      if (!workspace || command.context.actorId !== actor.id)
        return failure('FORBIDDEN', command.mutationId)
      if (!writable(workspace, command.context.kind))
        return failure(
          workspace.finalEntry ? 'ALREADY_SUBMITTED' : 'STAGE_LOCKED',
          command.mutationId,
        )
      const current = bindingFor(actor, workspace, command.context.kind)
      if (
        command.voiceBindings.some(
          (binding) => !voiceContextMatches(binding, current, true),
        )
      )
        return failure('STAGE_LOCKED', command.mutationId)
      const parsed = validateFeedbackText(
        command.content,
        command.action === 'submit',
      )
      if (
        !parsed.ok ||
        (command.content.observedOn &&
          command.content.observedOn > singaporeToday())
      )
        return failure('INVALID_INPUT', command.mutationId)
      if (
        workspace.draft?.id !== command.draftId ||
        workspace.draft?.version !== command.expectedVersion
      )
        return failure('VERSION_CONFLICT', command.mutationId)
      const draftKey = keyFor(
        command.context.campaignId,
        command.context.playerId,
        command.context.kind,
      )
      let commit: Commit
      if (command.action === 'save') {
        const draft: Draft = {
          id: workspace.draft?.id ?? crypto.randomUUID(),
          version: (workspace.draft?.version ?? 0) + 1,
          content: parsed.value,
        }
        drafts = { ...drafts, [draftKey]: draft }
        commit = { type: 'draft', draft }
      } else {
        drafts = Object.fromEntries(
          Object.entries(drafts).filter(([key]) => key !== draftKey),
        )
        if (command.action === 'discard') commit = { type: 'discard' }
        else {
          const entry: Entry = {
            id: crypto.randomUUID(),
            kind: command.context.kind,
            content: parsed.value,
            submittedAt: new Date().toISOString(),
            corrections: [],
          }
          const historyKey = `${command.context.campaignId}/${command.context.playerId}`
          entries = {
            ...entries,
            [historyKey]: [entry, ...(entries[historyKey] ?? [])],
          }
          commit = { type: 'submission', entry }
        }
      }
      const result = success(commit)
      receipts.set(command.mutationId, result)
      return result
    },
    checkPendingResult: async (actor, command) => {
      await wait()
      const workspace = workspaceFor(
        actor,
        command.context.campaignId,
        command.context.playerId,
        command.context.kind,
      )
      if (!workspace)
        return {
          status: 'resolved',
          result: failure('FORBIDDEN', command.mutationId),
        }
      const result = receipts.get(command.mutationId)
      if (!result) return { status: 'unknown' }
      return {
        status: 'resolved',
        result:
          result.ok && result.value.type === 'draft'
            ? success({
                type: 'draft',
                draft:
                  workspace.draft?.id === result.value.draft?.id
                    ? workspace.draft
                    : undefined,
              })
            : result,
      }
    },
  }
  // Isolated tests can change revisions and permissions, never through preview routes.
  return {
    adapter,
    setCampaign: (id: string, update: Partial<Campaign>) => {
      campaigns = campaigns.map((item) =>
        item.id === id
          ? { ...item, ...update, version: item.version + 1 }
          : item,
      )
      drafts = Object.fromEntries(
        Object.entries(drafts).filter(([key]) => !key.startsWith(id)),
      )
    },
    disableActor: () => {
      actorEnabled = false
    },
    setDraft: (command: Command['context'], draft: Draft) => {
      drafts = {
        ...drafts,
        [keyFor(command.campaignId, command.playerId, command.kind)]: draft,
      }
    },
  }
}
