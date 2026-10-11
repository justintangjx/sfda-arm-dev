import type { Capability, Result } from './contracts.js'
import type { CaseResult } from './eval.js'

// Future feature owners provide actual execution and target proofs. These
// interfaces grant no provider access, feedback write or activation authority.
export type LiveProviderRequest = Readonly<{
  caseIds: readonly string[]
  corpusDigest: string
  maxCases: number
  costAcknowledged: true
  signal: AbortSignal
}>
export type LiveProviderResult = Readonly<{
  executionId: string
  agentId: string
  immutableVersion: string
  verifiedConfigurationFingerprint: string
  providerPrivacyFingerprint: string
  modality: 'text' | 'audio'
  executedAt: string
  caseResults: readonly CaseResult[]
}>
export type LiveProviderAdapter = (
  request: LiveProviderRequest,
) => Promise<LiveProviderResult>
export type ProductionSmokeResult = Readonly<{
  targetAlias: string
  approvedOrigin: string
  deployedReleaseId: string
  configurationFingerprint: string
  syntheticSubjectIds: readonly string[]
  results: readonly Result[]
}>
export type ProductionTargetAdapter = Readonly<{
  currentState: () => Promise<
    Readonly<{
      deployedSha: string | null
      currentActivations: readonly Capability[]
      verifiedDeactivations: readonly Capability[]
      voiceEnabled: boolean
      configurationFingerprint: string
    }>
  >
  smoke: (signal: AbortSignal) => Promise<ProductionSmokeResult>
}>
export const liveProviderAdapter: LiveProviderAdapter | undefined = undefined
export const productionTargetAdapter: ProductionTargetAdapter | undefined =
  undefined
