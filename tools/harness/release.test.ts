import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { hash } from './io.js'
import {
  validateRegistry,
  validateManifest,
  validateReport,
} from './contracts.js'
import type { Report } from './contracts.js'
import { attemptFor, resultFor } from './adapters.js'
import {
  readinessResults,
  selectReadinessChecks,
  compactSummary,
  validateCompact,
  reusableCompactResults,
} from './readiness.js'
import { validateCorpus } from './eval.js'
import { promotion, readMigrationHistory } from './migrations.js'
import type { HistoryClient } from './migrations.js'
import type pg from 'pg'
import { verifyApproval, verifyWorkflow, validateOwners } from './provenance.js'
import type { GitHubReader, ApprovalRef } from './provenance.js'

const registry = validateRegistry(
  JSON.parse(await readFile('verification/checks.json', 'utf8')),
)
const manifest = validateManifest(
  JSON.parse(await readFile('verification/release.json', 'utf8')),
  registry,
)
const corpusBytes = await readFile('verification/cases/voice-text.json')
const corpus = validateCorpus(JSON.parse(corpusBytes.toString('utf8')))
const digest = hash('fixture')
const sha = 'a'.repeat(40)
const now = '2026-10-11T00:00:00.000Z'
const current = {
  currentActivations: [] as const,
  verifiedDeactivations: [] as const,
  deployedSha: sha,
  configurationFingerprint: digest,
  voiceEnabled: false,
}
const state = (voice: boolean) => ({
  ...current,
  currentActivations: voice ? ['voice' as const] : [],
  voiceEnabled: voice,
})

it('keeps shipped voice checks required when disabled and cannot omit an existing activation', () => {
  const release = {
    ...manifest,
    shippedCapabilities: ['foundation', 'voice'] as const,
  }
  const disabled = selectReadinessChecks(
    registry,
    release,
    'predeploy',
    state(false),
  )
  expect(
    disabled.find(({ check }) => check.id === 'voice_simulation')?.applicable,
  ).toBe(true)
  expect(
    disabled.find(({ check }) => check.id === 'voice_audio')?.applicable,
  ).toBe(false)
  expect(
    selectReadinessChecks(registry, release, 'predeploy', state(true)).find(
      ({ check }) => check.id === 'voice_audio',
    )?.applicable,
  ).toBe(true)
  expect(() =>
    selectReadinessChecks(registry, manifest, 'predeploy', state(true)),
  ).toThrow()
  expect(
    readinessResults({
      registry,
      manifest,
      phase: 'predeploy',
      current: undefined,
      trustedResults: [],
    }).find((result) => result.checkId === 'activation_state')?.status,
  ).toBe('missing')
})
it('requires deployed smoke for data activation but not a disabled code candidate', () => {
  const release = {
    ...manifest,
    shippedCapabilities: ['foundation', 'campaign'] as const,
    requestedActivations: ['campaign'] as const,
  }
  expect(
    selectReadinessChecks(registry, release, 'predeploy', current).some(
      ({ check }) => check.id === 'production_smoke',
    ),
  ).toBe(false)
  expect(
    selectReadinessChecks(registry, release, 'enable', current).find(
      ({ check }) => check.id === 'production_smoke',
    )?.applicable,
  ).toBe(true)
})
it('rejects incomplete retained summaries and excludes human, live, smoke and migration reuse', () => {
  const check = registry.checks[0]!
  const result = resultFor(check, 'passed', 'ASSERTIONS_PASSED', [
    attemptFor(check.id, 'passed', 'ASSERTIONS_PASSED', now, 10),
  ])
  const report: Report = {
    schemaVersion: 1,
    runId: randomUUID(),
    mode: 'check',
    profile: 'foundation',
    phase: null,
    startedAt: now,
    finishedAt: now,
    codeSha: sha,
    dirty: false,
    manifestDigest: digest,
    registryDigest: digest,
    inputFingerprint: digest,
    environment: {
      nodeVersion: process.version,
      platform: 'linux',
      execution: 'github_actions',
      workerRuntime: 'not_executed',
      browserProjects: [],
      repository: 'fixture/repository',
      workflowRunId: '123',
      workflow: 'Checks',
      runtimeFingerprint: digest,
    },
    results: [result],
    warnings: [],
    exitCode: 0,
    releaseReady: false,
    predeployReady: false,
    activationReady: false,
    interrupted: false,
    agentSnapshotDigest: null,
    caseResults: [],
  }
  const summary = compactSummary(report, digest, corpus, hash(corpusBytes))
  expect(validateCompact(summary, registry, corpus, hash(corpusBytes))).toEqual(
    summary,
  )
  expect(reusableCompactResults(summary)).toEqual([result])
  expect(() =>
    validateCompact(
      { ...summary, missingCaseIds: [] },
      registry,
      corpus,
      hash(corpusBytes),
    ),
  ).toThrow()
  expect(() =>
    validateReport({ ...report, releaseReady: true }, registry),
  ).toThrow()
})
it('uses verified TLS and the fixed history query, tolerates extras and fails on unavailable history', async () => {
  const target = {
    schemaVersion: 1 as const,
    alias: 'fixture',
    host: 'db.fixture.invalid',
    port: 5432,
    database: 'postgres',
    caDigest: hash('approved_ca'),
    appOrigin: 'https://fixture.invalid',
  }
  const env = {
    PRODUCTION_TARGET_ALIAS: target.alias,
    MIGRATION_READ_HOST: target.host,
    MIGRATION_READ_PORT: '5432',
    MIGRATION_READ_DATABASE: 'postgres',
    MIGRATION_READ_USER: 'history_reader',
    MIGRATION_READ_PASSWORD: 'fixture_password',
    MIGRATION_READ_CA: 'approved_ca',
  }
  const release = {
    ...manifest,
    migrations: [
      {
        version: '20261009000100',
        path: 'supabase/migrations/20261009000100_preparation.sql',
        digest,
      },
    ],
  }
  const queries: string[] = []
  let config: pg.ClientConfig | undefined
  const client: HistoryClient = {
    connect: async () => {},
    query: async (sql) => {
      queries.push(sql)
      return {
        rows: sql.startsWith('SELECT')
          ? [{ version: '20261009000100' }, { version: '20261009000200' }]
          : [],
      }
    },
    end: async () => {},
  }
  expect(
    (
      await readMigrationHistory(target, env, release, (value) => {
        config = value
        return client
      })
    ).status,
  ).toBe('passed')
  expect(config).toMatchObject({
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 10000,
    ssl: { rejectUnauthorized: true },
  })
  expect(queries).toEqual([
    'BEGIN READ ONLY',
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version',
    'ROLLBACK',
  ])
  await expect(
    readMigrationHistory(
      target,
      { ...env, MIGRATION_READ_HOST: 'wrong.invalid' },
      release,
      () => client,
    ),
  ).rejects.toThrow()
  expect(
    (
      await readMigrationHistory(target, env, release, () => ({
        ...client,
        query: async () => {
          throw new Error('private database error')
        },
      }))
    ).reasonCode,
  ).toBe('MIGRATION_READ_FAILED')
})
it('holds the promotion lock, skips superseded work and rechecks before publication', async () => {
  let locked = false
  let publications = 0
  let reads = 0
  const input = {
    candidate: sha,
    withLock: async <T>(operation: () => Promise<T>) => {
      locked = true
      const result = await operation()
      locked = false
      return result
    },
    currentMain: async () => {
      expect(locked).toBe(true)
      return ++reads === 1 ? sha : 'b'.repeat(40)
    },
    prerequisites: async () => true,
    publish: async () => {
      publications++
    },
  }
  expect(await promotion(input)).toBe('blocked')
  expect(publications).toBe(0)
  expect(
    await promotion({ ...input, currentMain: async () => 'b'.repeat(40) }),
  ).toBe('superseded')
  expect(await promotion({ ...input, currentMain: async () => sha })).toBe(
    'published',
  )
})
it('authenticates digest signoff, rejects edited, revoked and general approvals', async () => {
  const owners = validateOwners({
    schemaVersion: 1,
    repository: 'fixture/repository',
    owner: ['fixture-owner'],
    pilot_coach: ['fixture-coach'],
    trustedWorkflowPath: '.github/workflows/checks.yml',
  })
  const payload = Buffer.from('immutable synthetic review')
  const body = JSON.stringify({
    schemaVersion: 1,
    decision: 'approve',
    reviewedCommit: sha,
    payloadPath: 'verification/reviews/fixture.json',
    payloadDigest: hash(payload),
  })
  const reference: ApprovalRef = {
    repository: owners.repository,
    pullRequest: 1,
    reviewId: 7,
    role: 'owner',
    reviewedCommit: sha,
    payloadPath: 'verification/reviews/fixture.json',
    payloadDigest: hash(payload),
    reviewBodyDigest: hash(body),
  }
  const approved = {
    id: 7,
    state: 'COMMENTED',
    commit_id: sha,
    body,
    user: { login: 'fixture-owner' },
    submitted_at: now,
  }
  const reader =
    (reviews: readonly unknown[], content = payload): GitHubReader =>
    async (path) =>
      path.includes('/reviews?')
        ? reviews
        : { encoding: 'base64', content: content.toString('base64') }
  expect(
    (await verifyApproval(reader([approved]), owners, reference))?.account,
  ).toBe('fixture-owner')
  expect(
    await verifyApproval(
      reader([{ ...approved, body: 'Approved' }]),
      owners,
      reference,
    ),
  ).toBeUndefined()
  expect(
    await verifyApproval(
      reader([{ ...approved, state: 'DISMISSED' }]),
      owners,
      reference,
    ),
  ).toBeUndefined()
  expect(
    await verifyApproval(
      reader([approved], Buffer.from('edited')),
      owners,
      reference,
    ),
  ).toBeUndefined()
  const revoke = { ...approved, id: 8, body: body.replace('approve', 'revoke') }
  expect(
    await verifyApproval(reader([approved, revoke]), owners, reference),
  ).toBeUndefined()
  expect(
    await verifyWorkflow(
      async () => ({
        repository: { full_name: owners.repository },
        head_sha: sha,
        path: owners.trustedWorkflowPath,
        status: 'completed',
        conclusion: 'failure',
        created_at: now,
        event: 'push',
      }),
      owners,
      '123',
      sha,
      now,
    ),
  ).toBe(false)
})
