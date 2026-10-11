import * as v from './validation.js'
import { caseResultRule, type CaseResult } from './eval.js'

export const capabilities = [
  'foundation',
  'preparation',
  'campaign',
  'voice',
  'pilot',
] as const
export type Capability = (typeof capabilities)[number]
export const kinds = [
  'unit',
  'fixture_browser',
  'local_database',
  'local_browser',
  'provider_text',
  'provider_audio',
  'human',
  'production_smoke',
] as const
export type EvidenceKind = (typeof kinds)[number]
export const statuses = [
  'passed',
  'flaky',
  'failed',
  'missing',
  'not_applicable',
] as const
export type Status = (typeof statuses)[number]
export const adapters = [
  'build',
  'types',
  'lint',
  'format',
  'unit',
  'harness',
  'browser',
  'database_preparation',
  'database_campaign',
  'voice_simulation',
  'voice_quality',
  'voice_live',
  'voice_audio',
  'voice_privacy',
  'actual_devices',
  'ga_review',
  'release_notes',
  'production_smoke',
  'account_delivery',
  'real_data_policy',
  'migration_history',
  'activation_state',
] as const
export type AdapterId = (typeof adapters)[number]
export const adapterKinds: Readonly<Record<AdapterId, EvidenceKind>> = {
  build: 'unit',
  types: 'unit',
  lint: 'unit',
  format: 'unit',
  unit: 'unit',
  harness: 'unit',
  browser: 'fixture_browser',
  database_preparation: 'local_database',
  database_campaign: 'local_database',
  voice_simulation: 'unit',
  voice_quality: 'human',
  voice_live: 'provider_text',
  voice_audio: 'provider_audio',
  voice_privacy: 'human',
  actual_devices: 'human',
  ga_review: 'human',
  release_notes: 'human',
  production_smoke: 'production_smoke',
  account_delivery: 'human',
  real_data_policy: 'human',
  migration_history: 'local_database',
  activation_state: 'production_smoke',
}
export type SpecMapping = Readonly<{
  path: string
  criteria: readonly string[]
}>
const specRule = v.exact({
  path: v.relativePath,
  criteria: v.list(v.match(/^AC-[1-9][0-9]*$/), 1),
})
export type Check = Readonly<{
  id: string
  name: string
  evidenceKind: EvidenceKind
  specs: readonly SpecMapping[]
  capabilities: readonly Capability[]
  adapterId: AdapterId
  timeoutSeconds: number
}>
export type Registry = Readonly<{ schemaVersion: 1; checks: readonly Check[] }>
export const registryRule = v.exact({
  schemaVersion: v.oneOf([1]),
  checks: v.list(
    v.exact({
      id: v.id,
      name: v.string,
      evidenceKind: v.oneOf(kinds),
      specs: v.list(specRule, 1),
      capabilities: v.list(v.oneOf(capabilities), 1),
      adapterId: v.oneOf(adapters),
      timeoutSeconds: v.integer(1, 900),
    }),
    1,
  ),
})
export const validateRegistry = (value: unknown): Registry => {
  const registry = v.parse<Registry>(value, registryRule)
  v.unique(registry.checks.map((check) => check.id))
  v.unique(registry.checks.map((check) => check.adapterId))
  if (
    adapters.some(
      (adapter) =>
        !registry.checks.some((check) => check.adapterId === adapter),
    )
  )
    v.invalid()
  for (const check of registry.checks) {
    if (check.id !== check.adapterId) v.invalid()
    if (adapterKinds[check.adapterId] !== check.evidenceKind) v.invalid()
    v.unique(check.capabilities)
    for (const mapping of check.specs) v.unique(mapping.criteria)
  }
  return registry
}
export type Manifest = Readonly<{
  schemaVersion: 1
  shippedCapabilities: readonly Capability[]
  requestedActivations: readonly Capability[]
  migrations: readonly Readonly<{
    version: string
    path: string
    digest: string
  }>[]
  checkRequirements: readonly string[]
  inputPaths: readonly string[]
  actualDevices: readonly Readonly<{
    os: string
    browser: string
    engine: string
    inputMode: string
  }>[]
}>
export const manifestRule = v.exact({
  schemaVersion: v.oneOf([1]),
  shippedCapabilities: v.list(v.oneOf(capabilities), 1),
  requestedActivations: v.list(v.oneOf(capabilities)),
  migrations: v.list(
    v.exact({
      version: v.match(/^\d{14}$/),
      path: v.relativePath,
      digest: v.digest,
    }),
  ),
  checkRequirements: v.list(v.id, 1),
  inputPaths: v.list(v.relativePath, 1),
  actualDevices: v.list(
    v.exact({
      os: v.string,
      browser: v.string,
      engine: v.string,
      inputMode: v.string,
    }),
  ),
})
export const validateManifest = (
  value: unknown,
  registry: Registry,
): Manifest => {
  const manifest = v.parse<Manifest>(value, manifestRule)
  v.unique(manifest.shippedCapabilities)
  v.unique(manifest.requestedActivations)
  v.unique(manifest.checkRequirements)
  v.unique(manifest.inputPaths)
  v.unique(manifest.migrations.map((migration) => migration.version))
  for (const capability of manifest.requestedActivations)
    if (!manifest.shippedCapabilities.includes(capability)) v.invalid()
  for (const id of manifest.checkRequirements)
    if (!registry.checks.some((check) => check.id === id)) v.invalid()
  for (const migration of manifest.migrations)
    if (
      !migration.path.startsWith(`supabase/migrations/${migration.version}_`) ||
      !migration.path.endsWith('.sql')
    )
      v.invalid()
  return manifest
}
export type Attempt = Readonly<{
  id: string
  subjectId: string
  index: number
  startedAt: string
  durationMs: number
  outcome: 'passed' | 'failed' | 'skipped' | 'cancelled'
  reasonCode: string
  integrityFindings: readonly string[]
}>
export const attemptRule = v.exact({
  id: v.uuid,
  subjectId: v.digest,
  index: v.integer(0, 2),
  startedAt: v.utc,
  durationMs: v.integer(0, 1800000),
  outcome: v.oneOf(['passed', 'failed', 'skipped', 'cancelled']),
  reasonCode: v.match(/^[A-Z][A-Z0-9_]{0,79}$/),
  integrityFindings: v.list(v.id),
})
export type Result = Readonly<{
  checkId: string
  evidenceKind: EvidenceKind
  specs: readonly SpecMapping[]
  status: Status
  reasonCode: string
  attempts: readonly Attempt[]
  caseResultIds: readonly string[]
  execution: Readonly<{
    runtime: 'node' | 'workerd' | 'unavailable'
    browserProjects: readonly string[]
    databaseTarget: string | null
  }>
}>
export const resultRule = v.exact({
  checkId: v.id,
  evidenceKind: v.oneOf(kinds),
  specs: v.list(specRule, 1),
  status: v.oneOf(statuses),
  reasonCode: v.match(/^[A-Z][A-Z0-9_]{0,79}$/),
  attempts: v.list(attemptRule),
  caseResultIds: v.list(v.uuid),
  execution: v.exact({
    runtime: v.oneOf(['node', 'workerd', 'unavailable']),
    browserProjects: v.list(v.id),
    databaseTarget: v.nullable(v.id),
  }),
})
export type Environment = Readonly<{
  nodeVersion: string
  platform: string
  execution: 'local' | 'github_actions'
  workerRuntime: 'workerd' | 'not_executed'
  browserProjects: readonly string[]
  repository: string | null
  workflowRunId: string | null
  workflow: string | null
  runtimeFingerprint: string
}>
export const environmentRule = v.exact({
  nodeVersion: v.string,
  platform: v.string,
  execution: v.oneOf(['local', 'github_actions']),
  workerRuntime: v.oneOf(['workerd', 'not_executed']),
  browserProjects: v.list(v.id),
  repository: v.nullable(v.match(/^[\w.-]+\/[\w.-]+$/)),
  workflowRunId: v.nullable(v.match(/^\d+$/)),
  workflow: v.nullable(v.string),
  runtimeFingerprint: v.digest,
})
export type Report = Readonly<{
  schemaVersion: 1
  runId: string
  mode: 'check' | 'readiness' | 'migrations' | 'voice-live' | 'production-smoke'
  profile: Capability
  phase: 'predeploy' | 'enable' | null
  startedAt: string
  finishedAt: string
  codeSha: string | null
  dirty: boolean
  manifestDigest: string
  registryDigest: string
  inputFingerprint: string
  environment: Environment
  results: readonly Result[]
  warnings: readonly string[]
  exitCode: 0 | 1 | 2
  releaseReady: boolean
  predeployReady: boolean
  activationReady: boolean
  interrupted: boolean
  agentSnapshotDigest: string | null
  caseResults: readonly CaseResult[]
}>
export const reportRule = v.exact({
  schemaVersion: v.oneOf([1]),
  runId: v.uuid,
  mode: v.oneOf([
    'check',
    'readiness',
    'migrations',
    'voice-live',
    'production-smoke',
  ]),
  profile: v.oneOf(capabilities),
  phase: v.nullable(v.oneOf(['predeploy', 'enable'])),
  startedAt: v.utc,
  finishedAt: v.utc,
  codeSha: v.nullable(v.sha),
  dirty: v.boolean,
  manifestDigest: v.digest,
  registryDigest: v.digest,
  inputFingerprint: v.digest,
  environment: environmentRule,
  results: v.list(resultRule, 1),
  warnings: v.list(v.id),
  exitCode: v.oneOf([0, 1, 2]),
  releaseReady: v.boolean,
  predeployReady: v.boolean,
  activationReady: v.boolean,
  interrupted: v.boolean,
  agentSnapshotDigest: v.nullable(v.digest),
  caseResults: v.list(caseResultRule),
})
export const resultStatus = (attempts: readonly Attempt[]): Status => {
  if (!attempts.length) return 'missing'
  if (
    attempts.some(
      (attempt) =>
        attempt.integrityFindings.length > 0 || attempt.outcome === 'cancelled',
    )
  )
    return 'failed'
  const subjects = [...new Set(attempts.map((attempt) => attempt.subjectId))]
  if (
    subjects.some(
      (subject) =>
        attempts.filter((attempt) => attempt.subjectId === subject).at(-1)
          ?.outcome === 'failed' ||
        (attempts.filter((attempt) => attempt.subjectId === subject).at(-1)
          ?.outcome === 'skipped' &&
          attempts.some(
            (attempt) =>
              attempt.subjectId === subject && attempt.outcome === 'failed',
          )),
    )
  )
    return 'failed'
  if (attempts.some((attempt) => attempt.outcome === 'skipped'))
    return 'missing'
  return attempts.some((attempt) => attempt.outcome === 'failed')
    ? 'flaky'
    : 'passed'
}
export const validateReport = (value: unknown, registry: Registry): Report => {
  const report = v.parse<Report>(value, reportRule)
  v.unique(report.results.map((result) => result.checkId))
  v.unique(report.caseResults.map((result) => result.id))
  v.unique(report.caseResults.map((result) => result.caseId))
  v.unique(
    report.results.flatMap((result) =>
      result.attempts.map((attempt) => attempt.id),
    ),
  )
  if (
    Date.parse(report.finishedAt) < Date.parse(report.startedAt) ||
    (report.exitCode === 0 && exitFor(report.mode, report.results) !== 0) ||
    (report.interrupted && (report.exitCode === 0 || report.releaseReady))
  )
    v.invalid()
  for (const result of report.results) {
    const check = registry.checks.find((check) => check.id === result.checkId)
    if (report.mode === 'check' && result.status === 'not_applicable')
      v.invalid()
    if (
      result.attempts.some(
        (attempt) =>
          Date.parse(attempt.startedAt) > Date.parse(report.finishedAt),
      )
    )
      v.invalid()
    if (
      result.caseResultIds.some(
        (id) => !report.caseResults.some((item) => item.id === id),
      )
    )
      v.invalid()
    if (
      !check ||
      check.evidenceKind !== result.evidenceKind ||
      JSON.stringify(check.specs) !== JSON.stringify(result.specs)
    )
      v.invalid()
    for (const subject of new Set(
      result.attempts.map((attempt) => attempt.subjectId),
    )) {
      const attempts = result.attempts.filter(
        (attempt) => attempt.subjectId === subject,
      )
      if (attempts.some((attempt, index) => attempt.index !== index))
        v.invalid()
    }
    if (
      (result.status === 'passed' || result.status === 'flaky') &&
      resultStatus(result.attempts) !== result.status
    )
      v.invalid()
  }
  if (
    report.releaseReady &&
    (report.mode !== 'readiness' ||
      report.dirty ||
      report.exitCode !== 0 ||
      report.results.some((result) =>
        ['missing', 'failed'].includes(result.status),
      ))
  )
    v.invalid()
  return report
}
export const profileClosure = (profile: Capability): readonly Capability[] => {
  switch (profile) {
    case 'foundation':
      return ['foundation']
    case 'preparation':
      return ['foundation', 'preparation']
    case 'campaign':
      return ['foundation', 'preparation', 'campaign']
    case 'voice':
      return ['foundation', 'preparation', 'campaign', 'voice']
    case 'pilot':
      return ['foundation', 'preparation', 'campaign', 'pilot']
  }
}
export const selectedCapabilities = (
  profile: Capability,
  requestedActivations: readonly Capability[],
): readonly Capability[] =>
  profile === 'pilot' && requestedActivations.includes('voice')
    ? [...profileClosure(profile), 'voice']
    : profileClosure(profile)
export const exitFor = (
  mode: Report['mode'],
  results: readonly Result[],
): 0 | 1 =>
  results.some(
    (result) =>
      result.status === 'failed' ||
      (mode !== 'check' && result.status === 'missing'),
  )
    ? 1
    : 0
