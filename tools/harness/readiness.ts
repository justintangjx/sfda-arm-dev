import type {
  Capability,
  Check,
  Manifest,
  Registry,
  Report,
  Result,
} from './contracts.js'
import { profileClosure, validateReport } from './contracts.js'
import { resultFor } from './adapters.js'
import type { Corpus, CaseResult, HumanReview } from './eval.js'
import { caseResultRule, reviewRule } from './eval.js'
import { reportRule } from './contracts.js'
import * as v from './validation.js'

export type VerifiedActivationState = Readonly<{
  currentActivations: readonly Capability[]
  verifiedDeactivations: readonly Capability[]
  deployedSha: string | null
  configurationFingerprint: string
  voiceEnabled: boolean
}>
const activationChecks = [
  'voice_quality',
  'voice_live',
  'voice_audio',
  'voice_privacy',
  'actual_devices',
]
const dataChecks = [
  'database_preparation',
  'database_campaign',
  'database_accounts',
  'browser_preparation',
  'preparation_accessibility',
  'migration_history',
]
const alwaysChecks = [
  'build',
  'types',
  'lint',
  'format',
  'unit',
  'harness',
  'browser',
  'ga_review',
  'release_notes',
  'activation_state',
]
export const selectReadinessChecks = (
  registry: Registry,
  manifest: Manifest,
  phase: 'predeploy' | 'enable',
  current: VerifiedActivationState | undefined,
): readonly Readonly<{ check: Check; applicable: boolean }>[] => {
  const shipped = [
    ...new Set(manifest.shippedCapabilities.flatMap(profileClosure)),
  ]
  const effective = [
    ...new Set([
      ...manifest.requestedActivations,
      ...(current?.currentActivations ?? []).filter(
        (capability) => !current?.verifiedDeactivations.includes(capability),
      ),
    ]),
  ]
  if (
    current &&
    effective.some(
      (capability) => !manifest.shippedCapabilities.includes(capability),
    )
  )
    v.invalid()
  if (
    current &&
    current.voiceEnabled !== current.currentActivations.includes('voice')
  )
    v.invalid()
  const voiceActive = effective.includes('voice')
  const voiceStateUnknown = current === undefined && shipped.includes('voice')
  const dataShipped =
    shipped.includes('preparation') || shipped.includes('campaign')
  const usingPlayers = effective.includes('pilot')
  const ids = new Set([...alwaysChecks, ...manifest.checkRequirements])
  if (dataShipped) for (const id of dataChecks) ids.add(id)
  if (shipped.includes('voice')) {
    ids.add('voice_simulation')
    ids.add('database_voice')
    for (const id of activationChecks) ids.add(id)
  }
  if (phase === 'enable') {
    ids.add('actual_devices')
    ids.add('production_smoke')
    ids.add('account_delivery')
    ids.add('real_data_policy')
  } else if (usingPlayers) ids.add('real_data_policy')
  return registry.checks
    .filter((check) => ids.has(check.id))
    .map((check) => {
      const voiceOnly = [
        'voice_quality',
        'voice_live',
        'voice_audio',
        'voice_privacy',
      ].includes(check.id)
      const actualDevices = check.id === 'actual_devices'
      const smoke = ['production_smoke', 'account_delivery'].includes(check.id)
      const applicable = voiceOnly
        ? voiceActive || voiceStateUnknown
        : actualDevices
          ? voiceActive || voiceStateUnknown || phase === 'enable'
          : smoke
            ? phase === 'enable' &&
              effective.some((capability) => capability !== 'foundation')
            : check.id === 'real_data_policy'
              ? usingPlayers
              : true
      return { check, applicable }
    })
}
export const matchingCandidateReport = (
  report: Report,
  candidate: Readonly<{
    sha: string
    registryDigest: string
    manifestDigest: string
    inputFingerprint: string
    runtimeFingerprint: string
  }>,
) =>
  !report.dirty &&
  !report.interrupted &&
  report.codeSha === candidate.sha &&
  report.registryDigest === candidate.registryDigest &&
  report.manifestDigest === candidate.manifestDigest &&
  report.inputFingerprint === candidate.inputFingerprint &&
  report.environment.runtimeFingerprint === candidate.runtimeFingerprint &&
  report.environment.execution === 'github_actions'

export const readinessResults = (
  input: Readonly<{
    registry: Registry
    manifest: Manifest
    phase: 'predeploy' | 'enable'
    current: VerifiedActivationState | undefined
    trustedResults: readonly Result[]
  }>,
): readonly Result[] =>
  selectReadinessChecks(
    input.registry,
    input.manifest,
    input.phase,
    input.current,
  ).map(({ check, applicable }) => {
    if (!applicable)
      return resultFor(check, 'not_applicable', 'FIXED_PHASE_RULE')
    if (check.id === 'activation_state' && !input.current)
      return resultFor(check, 'missing', 'ACTIVATION_STATE_UNAVAILABLE')
    return (
      input.trustedResults.find((result) => result.checkId === check.id) ??
      resultFor(check, 'missing', 'REQUIRED_EVIDENCE_UNAVAILABLE')
    )
  })
export type CompactSummary = Readonly<{
  schemaVersion: 1
  sourceRunId: string
  sourceReportDigest: string
  sourceRepository: string | null
  sourceWorkflowRunId: string | null
  sourceWorkflow: string | null
  sourceCommit: string | null
  createdAt: string
  report: Report
  corpusDigest: string
  requiredCases: readonly Readonly<{ id: string; version: number }>[]
  caseResults: readonly CaseResult[]
  reviews: readonly Readonly<{ review: HumanReview; payloadDigest: string }>[]
  missingCaseIds: readonly string[]
}>
export const compactRule = v.exact({
  schemaVersion: v.oneOf([1]),
  sourceRunId: v.uuid,
  sourceReportDigest: v.digest,
  sourceRepository: v.nullable(v.match(/^[\w.-]+\/[\w.-]+$/)),
  sourceWorkflowRunId: v.nullable(v.match(/^\d+$/)),
  sourceWorkflow: v.nullable(v.string),
  sourceCommit: v.nullable(v.sha),
  createdAt: v.utc,
  report: reportRule,
  corpusDigest: v.digest,
  requiredCases: v.list(
    v.exact({ id: v.id, version: v.integer(1, 1000) }),
    10,
    10,
  ),
  caseResults: v.list(caseResultRule),
  reviews: v.list(v.exact({ review: reviewRule, payloadDigest: v.digest })),
  missingCaseIds: v.list(v.id),
})
export const compactSummary = (
  report: Report,
  reportDigest: string,
  corpus: Corpus,
  corpusDigest: string,
): CompactSummary => ({
  schemaVersion: 1,
  sourceRunId: report.runId,
  sourceReportDigest: reportDigest,
  sourceRepository: report.environment.repository,
  sourceWorkflowRunId: report.environment.workflowRunId,
  sourceWorkflow: report.environment.workflow,
  sourceCommit: report.codeSha,
  createdAt: report.finishedAt,
  report,
  corpusDigest,
  requiredCases: corpus.cases.map(({ id, version }) => ({ id, version })),
  caseResults: report.caseResults,
  reviews: [],
  missingCaseIds: corpus.cases
    .filter(
      (item) => !report.caseResults.some((result) => result.caseId === item.id),
    )
    .map(({ id }) => id),
})
export const validateCompact = (
  value: unknown,
  registry: Registry,
  corpus: Corpus,
  corpusDigest: string,
): CompactSummary => {
  const summary = v.parse<CompactSummary>(value, compactRule)
  validateReport(summary.report, registry)
  if (
    summary.sourceRunId !== summary.report.runId ||
    summary.sourceCommit !== summary.report.codeSha ||
    summary.sourceWorkflowRunId !== summary.report.environment.workflowRunId ||
    summary.sourceRepository !== summary.report.environment.repository ||
    summary.sourceWorkflow !== summary.report.environment.workflow ||
    summary.createdAt !== summary.report.finishedAt ||
    summary.corpusDigest !== corpusDigest ||
    JSON.stringify(summary.requiredCases) !==
      JSON.stringify(corpus.cases.map(({ id, version }) => ({ id, version })))
  )
    v.invalid()
  v.unique(summary.caseResults.map((result) => result.caseId))
  v.unique(summary.missingCaseIds)
  const covered = new Set([
    ...summary.caseResults.map((result) => result.caseId),
    ...summary.missingCaseIds,
  ])
  if (
    covered.size !== corpus.cases.length ||
    corpus.cases.some((item) => !covered.has(item.id))
  )
    v.invalid()
  return summary
}
export const reusableCompactResults = (
  summary: CompactSummary,
): readonly Result[] =>
  summary.report.results.filter(
    (result) =>
      ['unit', 'fixture_browser', 'local_database', 'local_browser'].includes(
        result.evidenceKind,
      ) && !['migration_history', 'voice_simulation'].includes(result.checkId),
  )
