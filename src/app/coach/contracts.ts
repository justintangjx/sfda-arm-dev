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
}>
export type Player = Readonly<{
  id: string
  displayName: string
  isActive: boolean
  membershipVersion: number
  obligation: 'outstanding' | 'submitted' | 'waived' | 'none'
  waiverReason: string | undefined
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
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Page<Campaign>>>
  loadRoster: (
    actor: Actor,
    campaignId: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Page<Player>>>
  loadCampaign: (
    actor: Actor,
    campaignId: string,
    signal: AbortSignal,
  ) => Promise<DataResult<Campaign>>
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
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Page<Entry>>>
  loadCompletion: (
    actor: Actor,
    campaignId: string,
    signal: AbortSignal,
  ) => Promise<DataResult<Completion>>
  mutate: (actor: Actor, command: Command) => Promise<DataResult<Commit>>
  checkPendingResult: (actor: Actor, command: Command) => Promise<Recovery>
}>
