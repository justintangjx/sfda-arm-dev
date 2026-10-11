import { randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Capability, Report, Result } from './contracts.js'
import {
  capabilities,
  exitFor,
  selectedCapabilities,
  validateManifest,
  validateRegistry,
  validateReport,
} from './contracts.js'
import {
  executeCheck,
  resultFor,
  attemptFor,
  browserProjects,
} from './adapters.js'
import {
  atomicJson,
  checkoutIdentity,
  fingerprint,
  hash,
  json,
  safeRunDirectory,
} from './io.js'
import { forbiddenCredentials } from './process.js'
import { validateCorpus } from './eval.js'
import { compactSummary, readinessResults } from './readiness.js'
import { evidenceRule, loadTrustedResults } from './evidence.js'
import type { Evidence } from './evidence.js'
import { githubReader, validateOwners } from './provenance.js'
import {
  assertMigrationTarget,
  targetRule,
  validateMigrationSources,
} from './migrations.js'
import type { ProductionTarget } from './migrations.js'
import { productionTargetAdapter } from './future-adapters.js'
import * as v from './validation.js'

type Options = Readonly<{
  mode: Report['mode']
  profile: Capability
  phase: Report['phase']
  checks: readonly string[] | undefined
  output: string | undefined
  manifest: string
  evidence: string | undefined
  targetSha: string | undefined
  live: boolean
  maxCases: number
  cases: readonly string[] | undefined
  costAcknowledged: boolean
}>
export const parseOptions = (args: readonly string[]): Options => {
  const values = new Map<string, string>()
  const toggles = new Set<string>()
  const allowed = [
    '--mode',
    '--profile',
    '--phase',
    '--checks',
    '--output',
    '--manifest',
    '--evidence',
    '--target-sha',
    '--max-cases',
    '--cases',
  ]
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (key === '--live' || key === '--acknowledge-cost') {
      if (toggles.has(key)) v.invalid()
      toggles.add(key)
      continue
    }
    if (!allowed.includes(key) || values.has(key)) v.invalid()
    const value = args[++index]
    if (!value || value.startsWith('--')) v.invalid()
    values.set(key, value)
  }
  const mode = values.get('--mode') ?? 'check'
  const profile =
    values.get('--profile') ??
    (mode === 'voice-live'
      ? 'voice'
      : mode === 'production-smoke'
        ? 'pilot'
        : 'foundation')
  const phase = values.get('--phase') ?? null
  v.oneOf([
    'check',
    'readiness',
    'migrations',
    'voice-live',
    'production-smoke',
  ])(mode)
  v.oneOf(capabilities)(profile)
  if (mode === 'readiness') {
    v.oneOf(['predeploy', 'enable'])(phase)
    if (!values.get('--evidence')) v.invalid()
  } else if (
    phase !== null ||
    values.has('--evidence') ||
    values.has('--target-sha')
  )
    v.invalid()
  const checks = values.get('--checks')?.split(',')
  if (checks) {
    if (mode !== 'check') v.invalid()
    for (const id of checks) v.id(id)
    v.unique(checks)
  }
  const live = toggles.has('--live')
  if (live !== ['voice-live', 'production-smoke'].includes(mode)) v.invalid()
  if (
    (mode === 'voice-live' && profile !== 'voice') ||
    (mode === 'production-smoke' && profile !== 'pilot')
  )
    v.invalid()
  const maxCases = Number(values.get('--max-cases') ?? 10)
  v.integer(1, 10)(maxCases)
  const cases = values.get('--cases')?.split(',')
  if (cases) {
    for (const id of cases) v.id(id)
    v.unique(cases)
    if (cases.length > maxCases) v.invalid()
  }
  if (
    mode !== 'voice-live' &&
    (values.has('--max-cases') ||
      values.has('--cases') ||
      toggles.has('--acknowledge-cost'))
  )
    v.invalid()
  for (const key of ['--output', '--manifest', '--evidence'])
    if (values.has(key)) v.relativePath(values.get(key))
  if (values.has('--target-sha')) v.sha(values.get('--target-sha'))
  return {
    mode: mode as Options['mode'],
    profile: profile as Capability,
    phase: phase as Report['phase'],
    checks,
    output: values.get('--output'),
    manifest: values.get('--manifest') ?? 'verification/release.json',
    evidence: values.get('--evidence'),
    targetSha: values.get('--target-sha'),
    live,
    maxCases,
    cases,
    costAcknowledged: toggles.has('--acknowledge-cost'),
  }
}
const validateCoverage = async (root: string) => {
  const coverage = v.record(
    await json(join(root, 'verification/database-coverage.json')),
  )
  const mappingRule = v.exact({
    checkId: v.oneOf(['database_preparation', 'database_campaign']),
    path: v.relativePath,
    testName: v.string,
    criteria: v.list(v.match(/^AC-[1-9][0-9]*$/), 1),
  })
  v.exact({
    schemaVersion: v.oneOf([1]),
    spec: v.relativePath,
    roles: v.list(v.id, 7, 7),
    mappings: v.list(mappingRule, 1),
    scenarios: v.list(v.exact({ id: v.id, checkIds: v.list(v.id, 1) }), 11, 11),
  })(coverage)
  const roles = coverage.roles as readonly string[]
  if (
    JSON.stringify([...roles].sort()) !==
    JSON.stringify(
      [
        'anonymous',
        'player',
        'author',
        'other_coach',
        'former_coach',
        'disabled_caller',
        'admin',
      ].sort(),
    )
  )
    v.invalid()
  v.unique(
    (coverage.scenarios as readonly { id: string }[]).map(
      (scenario) => scenario.id,
    ),
  )
  for (const scenario of coverage.scenarios as readonly {
    checkIds: readonly string[]
  }[]) {
    v.unique(scenario.checkIds)
    if (
      scenario.checkIds.some(
        (id) =>
          ![
            'database_preparation',
            'database_campaign',
            'voice_simulation',
          ].includes(id),
      )
    )
      v.invalid()
  }
  const mapped = new Set<string>()
  for (const item of coverage.mappings as readonly Record<string, unknown>[]) {
    const source = await readFile(join(root, String(item.path)), 'utf8')
    if (!source.includes(String(item.testName))) v.invalid()
    for (const criterion of item.criteria as readonly string[])
      mapped.add(criterion)
  }
  if (
    Array.from({ length: 16 }, (_, index) => `AC-${index + 1}`).some(
      (criterion) => !mapped.has(criterion),
    )
  )
    v.invalid()
}
const main = async () => {
  const root = process.cwd()
  const options = parseOptions(process.argv.slice(2))
  const env = process.env
  if (env.HARNESS_BIN_DIR) {
    const directory = resolve(env.HARNESS_BIN_DIR)
    if (
      !directory.startsWith(`${join(root, '.verification/builds')}/`) ||
      (await realpath(directory)) !== directory
    )
      v.invalid()
  }
  if (
    (options.mode === 'check' || env.GITHUB_EVENT_NAME === 'pull_request') &&
    forbiddenCredentials(env)
  )
    v.invalid()
  if (
    ['voice-live', 'production-smoke', 'migrations'].includes(options.mode) &&
    env.GITHUB_EVENT_NAME === 'pull_request'
  )
    v.invalid()
  if (
    ['voice-live', 'production-smoke'].includes(options.mode) &&
    env.APP_ENV === 'preview'
  )
    v.invalid()
  if (
    options.mode === 'check' &&
    options.profile !== 'foundation' &&
    env.APP_ENV === 'production'
  )
    v.invalid()
  const registryBytes = await readFile(join(root, 'verification/checks.json'))
  const manifestBytes = await readFile(join(root, options.manifest))
  const corpusBytes = await readFile(
    join(root, 'verification/cases/voice-text.json'),
  )
  const registry = validateRegistry(JSON.parse(registryBytes.toString('utf8')))
  for (const check of registry.checks)
    for (const mapping of check.specs) {
      const source = await readFile(join(root, mapping.path), 'utf8')
      if (
        mapping.criteria.some(
          (criterion) => !source.includes(`**${criterion}**`),
        )
      )
        v.invalid()
    }
  const manifest = validateManifest(
    JSON.parse(manifestBytes.toString('utf8')),
    registry,
  )
  const corpus = validateCorpus(JSON.parse(corpusBytes.toString('utf8')))
  const owners = validateOwners(
    await json(join(root, 'verification/owners.json')),
  )
  await validateCoverage(root)
  await validateMigrationSources(root, manifest)
  const capabilitySelection = selectedCapabilities(
    options.profile,
    manifest.requestedActivations,
  )
  const selected = registry.checks.filter((check) =>
    check.capabilities.some((capability) =>
      capabilitySelection.includes(capability),
    ),
  )
  if (options.checks?.some((id) => !selected.some((check) => check.id === id)))
    v.invalid()
  const identity = checkoutIdentity(root)
  if (env.GITHUB_ACTIONS === 'true' && identity.codeSha !== env.GITHUB_SHA)
    v.invalid()
  if (options.targetSha && options.targetSha !== identity.codeSha) v.invalid()
  const inputFingerprint = await fingerprint(root, manifest.inputPaths)
  const runtimeFingerprint = hash(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      files: await fingerprint(root, [
        'wrangler.jsonc',
        'pnpm-lock.yaml',
        'vite.config.ts',
        'playwright.config.ts',
        'tsconfig.harness.json',
      ]),
    }),
  )
  const runId = randomUUID()
  const runDirectory = await safeRunDirectory(root, runId, options.output)
  const startedAt = new Date().toISOString()
  const controller = new AbortController()
  let interrupted = false
  const cancel = () => {
    interrupted = true
    controller.abort()
  }
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  const overallTimeout = setTimeout(cancel, 1800000)
  const results: Result[] = []
  let invalidRun = false
  const reader = githubReader(env.GITHUB_TOKEN)
  try {
    if (options.mode === 'check') {
      for (const check of selected.filter(
        (check) => !options.checks || options.checks.includes(check.id),
      )) {
        if (controller.signal.aborted) {
          results.push(resultFor(check, 'failed', 'RUN_CANCELLED'))
          continue
        }
        console.log(`Checking ${check.id}`)
        const result = await executeCheck(check, {
          root,
          runDirectory,
          env,
          signal: controller.signal,
        })
        results.push(result)
        console.log(`${check.id}: ${result.status} (${result.reasonCode})`)
      }
    } else if (options.mode === 'readiness') {
      const evidence = v.parse<Evidence>(
        await json(join(root, options.evidence!)),
        evidenceRule,
      )
      let trustedResults: readonly Result[] = []
      if (identity.codeSha && !identity.dirty) {
        try {
          trustedResults = await loadTrustedResults({
            evidence,
            root,
            registry,
            corpus,
            corpusDigest: hash(corpusBytes),
            candidate: {
              sha: identity.codeSha,
              registryDigest: hash(registryBytes),
              manifestDigest: hash(manifestBytes),
              inputFingerprint,
              runtimeFingerprint,
            },
            now: new Date().toISOString(),
            owners,
            reader,
            token: env.GITHUB_TOKEN,
          })
        } catch (error) {
          if (error instanceof Error && error.message === 'INVALID_CONTRACT')
            throw error
        }
      }
      const current = await productionTargetAdapter?.currentState()
      results.push(
        ...readinessResults({
          registry,
          manifest,
          phase: options.phase!,
          current,
          trustedResults,
        }),
      )
      if (identity.dirty || !identity.codeSha) {
        const check = registry.checks.find(
          (check) => check.id === 'activation_state',
        )!
        const index = results.findIndex((result) => result.checkId === check.id)
        results[index] = resultFor(check, 'missing', 'CLEAN_CANDIDATE_REQUIRED')
      }
    } else if (options.mode === 'migrations') {
      const check = registry.checks.find(
        (check) => check.id === 'migration_history',
      )!
      let targetValue: unknown
      try {
        targetValue = await json(
          join(root, 'verification/production-target.json'),
        )
      } catch {
        /* Provisioning remains future work. */
      }
      if (
        !targetValue &&
        Object.entries(env).some(
          ([name, value]) =>
            value &&
            (name.startsWith('MIGRATION_READ_') ||
              name === 'PRODUCTION_TARGET_ALIAS'),
        )
      )
        v.invalid()
      if (!targetValue)
        results.push(
          resultFor(check, 'missing', 'PRODUCTION_TARGET_UNAVAILABLE'),
        )
      else if (
        !reader ||
        !env.GITHUB_RUN_ID ||
        !identity.codeSha ||
        identity.dirty
      )
        results.push(resultFor(check, 'missing', 'TRUSTED_PROMOTION_REQUIRED'))
      else {
        // The real promotion workflow must supply the coordinated lock. Until
        // that adapter exists, a standalone CLI cannot claim a promotion read.
        const target = v.parse<ProductionTarget>(targetValue, targetRule)
        assertMigrationTarget(target, env)
        results.push(
          resultFor(check, 'missing', 'PROMOTION_LOCK_ADAPTER_UNAVAILABLE'),
        )
      }
    } else if (options.mode === 'voice-live') {
      const cases =
        options.cases ??
        corpus.cases.slice(0, options.maxCases).map((item) => item.id)
      if (cases.some((id) => !corpus.cases.some((item) => item.id === id)))
        v.invalid()
      console.log(`Selected synthetic cases: ${cases.join(', ')}`)
      for (const id of ['voice_live', 'voice_audio'])
        results.push(
          resultFor(
            registry.checks.find((check) => check.id === id)!,
            'missing',
            options.costAcknowledged
              ? 'LIVE_ADAPTER_UNAVAILABLE'
              : 'COST_ACKNOWLEDGEMENT_REQUIRED',
          ),
        )
    } else
      results.push(
        resultFor(
          registry.checks.find((check) => check.id === 'production_smoke')!,
          'missing',
          'SMOKE_ADAPTER_UNAVAILABLE',
        ),
      )
  } catch (error) {
    invalidRun = error instanceof Error && error.message === 'INVALID_CONTRACT'
    const check = registry.checks.find(
      (check) => !results.some((result) => result.checkId === check.id),
    )!
    results.push(
      resultFor(
        check,
        'failed',
        invalidRun ? 'INVALID_REQUEST' : 'EXECUTION_FAILED',
        [
          attemptFor(
            check.id,
            controller.signal.aborted ? 'cancelled' : 'failed',
            'EXECUTION_FAILED',
            startedAt,
            Date.now() - Date.parse(startedAt),
          ),
        ],
      ),
    )
  } finally {
    clearTimeout(overallTimeout)
  }
  if (!results.length) v.invalid()
  const exitCode = invalidRun
    ? 2
    : interrupted
      ? 1
      : exitFor(options.mode, results)
  const releaseReady = options.mode === 'readiness' && exitCode === 0
  const report: Report = {
    schemaVersion: 1,
    runId,
    mode: options.mode,
    profile: options.profile,
    phase: options.phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...identity,
    manifestDigest: hash(manifestBytes),
    registryDigest: hash(registryBytes),
    inputFingerprint,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      execution: env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local',
      workerRuntime: results.some(
        (result) => result.execution.runtime === 'workerd',
      )
        ? 'workerd'
        : 'not_executed',
      browserProjects: results.some(
        (result) => result.execution.runtime === 'workerd',
      )
        ? browserProjects
        : [],
      repository: env.GITHUB_REPOSITORY ?? null,
      workflowRunId: env.GITHUB_RUN_ID ?? null,
      workflow: env.GITHUB_WORKFLOW ?? null,
      runtimeFingerprint,
    },
    results,
    warnings: results
      .filter((result) => ['missing', 'flaky'].includes(result.status))
      .map((result) => result.checkId),
    exitCode,
    releaseReady,
    predeployReady: releaseReady && options.phase === 'predeploy',
    activationReady: releaseReady && options.phase === 'enable',
    interrupted,
    agentSnapshotDigest: null,
    caseResults: [],
  }
  validateReport(report, registry)
  await atomicJson(join(runDirectory, 'report.json'), report)
  const reportBytes = await readFile(join(runDirectory, 'report.json'))
  await atomicJson(
    join(runDirectory, 'compact-summary.json'),
    compactSummary(report, hash(reportBytes), corpus, hash(corpusBytes)),
  )
  const counts = Object.fromEntries(
    ['passed', 'flaky', 'failed', 'missing', 'not_applicable'].map((status) => [
      status,
      results.filter((result) => result.status === status).length,
    ]),
  )
  const summary = `${JSON.stringify(counts)}\nreleaseReady: ${releaseReady}\npredeployReady: ${report.predeployReady}\nactivationReady: ${report.activationReady}\nReport: ${relative(root, join(runDirectory, 'report.json'))}\n`
  await writeFile(join(runDirectory, 'summary.txt'), summary, {
    flag: 'wx',
    mode: 0o600,
  })
  console.log(summary)
  if (env.GITHUB_STEP_SUMMARY)
    await writeFile(env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' })
  if (interrupted && !report.interrupted) {
    const cancelled = {
      ...report,
      interrupted: true,
      exitCode: 1,
      releaseReady: false,
      predeployReady: false,
      activationReady: false,
    } as const
    await atomicJson(join(runDirectory, 'report.json'), cancelled)
    await atomicJson(
      join(runDirectory, 'compact-summary.json'),
      compactSummary(
        cancelled,
        hash(await readFile(join(runDirectory, 'report.json'))),
        corpus,
        hash(corpusBytes),
      ),
    )
  }
  process.off('SIGINT', cancel)
  process.off('SIGTERM', cancel)
  process.exitCode = interrupted ? 1 : exitCode
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error('INVALID_REQUEST, no passing report was written.')
    process.exitCode = 2
  })
}
