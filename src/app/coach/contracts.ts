import type {
  CampaignStage,
  FeedbackKind,
  FeedbackText,
  VoiceContextBinding,
} from '../../domain/feedback.ts'
import type { DataErrorCode } from '../data/mutations.ts'

export type Actor = Readonly<{
  id: string
  displayName: string
  accessVersion: number
}>
export type CampaignDiscoveryQuery = Readonly<{
  mode: 'current' | 'history'
  text: string | undefined
  stage: CampaignStage | undefined
}>
export const defaultCampaignDiscovery: CampaignDiscoveryQuery = {
  mode: 'current',
  text: undefined,
  stage: undefined,
}
export type RosterDiscoveryQuery = Readonly<{
  text: string | undefined
  membership: 'all' | 'active' | 'withdrawn'
  drafts: 'all' | 'saved'
}>
export const defaultRosterDiscovery: RosterDiscoveryQuery = {
  text: undefined,
  membership: 'active',
  drafts: 'all',
}
export type HistoryDiscoveryQuery = Readonly<{
  observedFrom: string | undefined
  observedTo: string | undefined
}>
export const defaultHistoryDiscovery: HistoryDiscoveryQuery = {
  observedFrom: undefined,
  observedTo: undefined,
}
export type Campaign = Readonly<{
  id: string
  name: string
  team: string
  competition: string
  stage: CampaignStage
  version: number
  membershipVersion: number
  isActive: boolean
  frozen: boolean
  accessLabel?: string
}>
export type FreezeRequirements = Readonly<{
  scope: 'self'
  frozen: boolean
  frozenRequiredCount: number | null
}>
export type CampaignContext = Readonly<{
  campaign: Campaign
  requirements: FreezeRequirements
  writeKinds: readonly ['preparation']
  correctionSupport: 'unavailable'
}>
export type Player = Readonly<{
  id: string
  displayName: string
  isActive: boolean
  membershipVersion: number
  obligation: 'outstanding' | 'submitted' | 'waived' | 'none'
  waiverReason: string | undefined
  hasSavedPreparationDraft?: boolean
  preparationSubmissionCount?: string
  latestPreparationSubmittedAt?: string | undefined
}>
export type HistorySummary = Readonly<{
  id: string
  kind: FeedbackKind
  observedOn: string
  submittedAt: string
  preview: string
}>
export type RosterNeighbor = Readonly<{
  playerId: string
  displayName: string
  membershipVersion: number
}>
export type RosterNeighbors = Readonly<{
  queryFingerprint: string
  selectedMatch: boolean
  previous: RosterNeighbor | undefined
  next: RosterNeighbor | undefined
}>
export type PlayerContext = Readonly<{
  context: CampaignContext
  player: Player
  filterMatch: boolean
  preparationWritable: boolean
  draft: Draft | undefined
}>
export type Correction = Readonly<{
  id: string
  revision: number
  content: FeedbackText
  reason: string
  correctedAt: string
}>
export type Entry = Readonly<{
  id: string
  kind: FeedbackKind
  content: FeedbackText
  submittedAt: string
  corrections: readonly Correction[]
}>
export type Draft = Readonly<{
  id: string
  version: number
  content: FeedbackText
}>
export type Context = Readonly<{
  actorId: string
  campaignId: string
  playerId: string
  kind: FeedbackKind
}>
export type Page<T> = Readonly<{
  rows: readonly T[]
  nextCursor: string | undefined
  queryFingerprint?: string
  readAt?: string
}>
export type DataResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: DataErrorCode; requestId: string }>
export type Workspace = Readonly<{
  campaign: Campaign
  player: Player
  draft: Draft | undefined
  finalEntry: Entry | undefined
}>
export type Completion = Readonly<{
  scope: 'self'
  frozen: boolean
  submitted: number
  waived: number
  outstanding: number
}>
export type Command = Readonly<{
  action: 'save' | 'submit' | 'discard'
  mutationId: string
  context: Context
  content: FeedbackText
  draftId: string | undefined
  expectedVersion: number | undefined
  voiceBindings: readonly VoiceContextBinding[]
  reviewConfirmed: true
}>
export type Commit =
  | Readonly<{ type: 'draft'; draft: Draft | undefined }>
  | Readonly<{ type: 'submission'; entry: Entry }>
  | Readonly<{ type: 'discard' }>
export type Recovery =
  | Readonly<{ status: 'unknown' }>
  | Readonly<{ status: 'resolved'; result: DataResult<Commit> }>

// The live slice supplies caller scoped reads, Auth and atomic mutations.
// A voice capable adapter must validate every binding at the write boundary.
export type CoachAdapter = Readonly<{
  evidence: 'fixture' | 'live'
  signIn: (email: string, password: string) => Promise<DataResult<Actor>>
  getAccess: (actor: Actor) => Promise<DataResult<Actor>>
  signOut: () => Promise<void>
  loadCampaigns: (
    actor: Actor,
    discovery: CampaignDiscoveryQuery,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Page<Campaign>>>
  loadRoster: (
    actor: Actor,
    campaignId: string,
    discovery: RosterDiscoveryQuery,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Page<Player>>>
  loadCampaignContext: (
    actor: Actor,
    campaignId: string,
    signal: AbortSignal,
  ) => Promise<DataResult<CampaignContext>>
  loadPlayerContext: (
    actor: Actor,
    campaignId: string,
    playerId: string,
    discovery: RosterDiscoveryQuery,
    signal: AbortSignal,
  ) => Promise<DataResult<PlayerContext>>
  loadRosterNeighbors: (
    actor: Actor,
    campaignId: string,
    playerId: string,
    discovery: RosterDiscoveryQuery,
    signal: AbortSignal,
  ) => Promise<DataResult<RosterNeighbors>>
  loadWorkspace: (
    actor: Actor,
    campaignId: string,
    playerId: string,
    kind: FeedbackKind | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Workspace>>
  loadHistory: (
    actor: Actor,
    campaignId: string,
    playerId: string,
    discovery: HistoryDiscoveryQuery,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Page<HistorySummary>>>
  loadFeedbackEntry: (
    actor: Actor,
    campaignId: string,
    playerId: string,
    feedbackId: string,
    signal: AbortSignal,
  ) => Promise<DataResult<Entry>>
  mutate: (actor: Actor, command: Command) => Promise<DataResult<Commit>>
  checkPendingResult: (actor: Actor, command: Command) => Promise<Recovery>
}>
