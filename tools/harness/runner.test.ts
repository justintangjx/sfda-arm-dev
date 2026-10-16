import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  cp,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeAll, describe, expect, it } from 'vitest'
import { subprocess, safeEnvironment } from './process.js'
import { safeRunDirectory, hash } from './io.js'
import { parseOptions } from './cli.js'
import {
  resultStatus,
  validateRegistry,
  validateManifest,
  validateReport,
  selectedCapabilities,
} from './contracts.js'
import { validateRunnerOutput } from './adapters.js'

const root = process.cwd()
let compiled: string
beforeAll(async () => {
  compiled = join(root, '.verification/self-tests', randomUUID())
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsc', '-p', 'tsconfig.harness.json', '--outDir', compiled],
    { cwd: root, encoding: 'utf8', timeout: 30000 },
  )
  expect(result.status, result.stdout + result.stderr).toBe(0)
})
const registry = validateRegistry(
  JSON.parse(await readFile(join(root, 'verification/checks.json'), 'utf8')),
)
const types = registry.checks.find((check) => check.id === 'types')!
const unit = registry.checks.find((check) => check.id === 'unit')!
const fixtureRoot = async (exitCode: number) => {
  const target = await mkdtemp(join(tmpdir(), 'sfda-harness-'))
  await cp(join(root, 'verification'), join(target, 'verification'), {
    recursive: true,
  })
  await mkdir(join(target, 'supabase/tests'), { recursive: true })
  for (const name of [
    '0002-fresh-data-model-access-rules',
    '0003-verification-harness-eval-contract',
    '0005-first-real-coach-feedback-path',
    '0006-account-roster-operations',
    '0007-campaign-player-workspace',
    '0008-conversational-voice-feedback',
  ]) {
    await mkdir(join(target, 'docs/specs', name), { recursive: true })
    await cp(
      join(root, 'docs/specs', name, 'index.md'),
      join(target, 'docs/specs', name, 'index.md'),
    )
  }
  for (const file of ['preparation.test.ts', 'final-lifecycle.test.ts'])
    await cp(
      join(root, 'supabase/tests', file),
      join(target, 'supabase/tests', file),
    )
  for (const file of [
    'wrangler.jsonc',
    'pnpm-lock.yaml',
    'vite.config.ts',
    'playwright.config.ts',
    'tsconfig.harness.json',
    'package.json',
  ])
    await cp(join(root, file), join(target, file))
  const manifest = JSON.parse(
    await readFile(join(target, 'verification/release.json'), 'utf8'),
  ) as Record<string, unknown>
  await writeFile(
    join(target, 'verification/release.json'),
    JSON.stringify({ ...manifest, inputPaths: ['package.json'] }),
  )
  const bin = join(target, 'bin')
  await mkdir(bin)
  await writeFile(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node\nprocess.exit(${exitCode})\n`,
    { mode: 0o700 },
  )
  return {
    target,
    env: {
      ...safeEnvironment(process.env),
      PATH: `${bin}:${process.env.PATH}`,
    },
  }
}
const cli = (target: string, env: NodeJS.ProcessEnv, args: readonly string[]) =>
  spawnSync(process.execPath, [join(compiled, 'cli.js'), ...args], {
    cwd: target,
    env,
    encoding: 'utf8',
    timeout: 30000,
  })
const latestReport = async (target: string) => {
  const runs = await readdir(join(target, '.verification/runs'))
  return validateReport(
    JSON.parse(
      await readFile(
        join(target, '.verification/runs', runs.at(-1)!, 'report.json'),
        'utf8',
      ),
    ),
    registry,
  )
}

describe('compiled harness and real processes', () => {
  it('reports workspace database mappings as missing when local execution is unavailable', async () => {
    const { target, env } = await fixtureRoot(0)
    const run = cli(target, env, [
      '--profile',
      'preparation',
      '--checks',
      'database_preparation',
    ])
    expect(run.status, run.stdout + run.stderr).toBe(0)
    const report = await latestReport(target)
    expect(report.results[0]).toMatchObject({
      status: 'missing',
      evidenceKind: 'local_database',
      execution: { runtime: 'unavailable', databaseTarget: null },
    })
    expect(report.results[0]?.specs).toContainEqual({
      path: 'docs/specs/0007-campaign-player-workspace/index.md',
      criteria: expect.arrayContaining(['AC-2', 'AC-3', 'AC-6', 'AC-9']),
    })
    expect(report.releaseReady).toBe(false)
  })
  it('runs a real child, writes a report and never confuses advisory success with readiness', async () => {
    const { target, env } = await fixtureRoot(0)
    const run = cli(target, env, [
      '--mode',
      'check',
      '--profile',
      'foundation',
      '--checks',
      'types',
    ])
    expect(run.status, run.stdout + run.stderr).toBe(0)
    const report = await latestReport(target)
    expect(report.results[0]).toMatchObject({
      status: 'passed',
      execution: { runtime: 'node' },
    })
    expect(report.results[0]?.attempts).toHaveLength(1)
    expect(report.releaseReady).toBe(false)
    expect(report.environment.workerRuntime).toBe('not_executed')
    expect(run.stdout).toContain('releaseReady: false')
  })
  it('fails on real child failure and keeps safe output even if the child writes secret shaped text', async () => {
    const { target, env } = await fixtureRoot(7)
    await writeFile(
      join(target, 'bin/pnpm'),
      '#!/usr/bin/env node\nconsole.error("private fixture sentinel");process.exit(7)\n',
      { mode: 0o700 },
    )
    const run = cli(target, env, ['--checks', 'types'])
    expect(run.status).toBe(1)
    const report = await latestReport(target)
    expect(report.results[0]?.status).toBe('failed')
    expect(JSON.stringify(report) + run.stdout + run.stderr).not.toContain(
      'private fixture sentinel',
    )
  })
  it('gives missing local evidence advisory success and strict readiness failure', async () => {
    const advisory = await fixtureRoot(0)
    expect(
      cli(advisory.target, advisory.env, [
        '--profile',
        'preparation',
        '--checks',
        'database_preparation',
      ]).status,
    ).toBe(0)
    expect((await latestReport(advisory.target)).results[0]?.status).toBe(
      'missing',
    )
    const strict = await fixtureRoot(0)
    await writeFile(
      join(strict.target, 'verification/evidence.json'),
      JSON.stringify({
        schemaVersion: 1,
        reports: [],
        retained: [],
        approvals: [],
      }),
    )
    expect(
      cli(strict.target, strict.env, [
        '--mode',
        'readiness',
        '--phase',
        'predeploy',
        '--evidence',
        'verification/evidence.json',
      ]).status,
    ).toBe(1)
    expect((await latestReport(strict.target)).releaseReady).toBe(false)
  })
  it('rejects unsafe credentials, remote local targets, traversal and malformed evidence before a pass', async () => {
    const { target, env } = await fixtureRoot(0)
    expect(
      cli(target, { ...env, SUPABASE_ADMIN_KEY: 'fixture_value' }, [
        '--checks',
        'types',
      ]).status,
    ).toBe(2)
    expect(
      cli(target, { ...env, ELEVENLABS_API_KEY: 'fixture_value' }, [
        '--checks',
        'types',
      ]).status,
    ).toBe(2)
    expect(
      cli(
        target,
        { ...env, APP_ENV: 'local', SUPABASE_URL: 'https://remote.invalid' },
        ['--profile', 'preparation', '--checks', 'database_preparation'],
      ).status,
    ).toBe(2)
    expect(
      cli(target, { ...env, MIGRATION_READ_HOST: 'unknown.fixture.invalid' }, [
        '--mode',
        'migrations',
      ]).status,
    ).toBe(2)
    expect(cli(target, env, ['--output', '../outside']).status).toBe(2)
    await writeFile(join(target, 'verification/invalid.json'), '{}')
    expect(
      cli(target, env, [
        '--mode',
        'readiness',
        '--phase',
        'enable',
        '--evidence',
        'verification/invalid.json',
      ]).status,
    ).toBe(2)
  })
  it('bounds a hanging child and records cancellation', async () => {
    const input = {
      command: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'],
      cwd: root,
      env: safeEnvironment(process.env),
      capture: false,
    }
    const timed = await subprocess({
      ...input,
      timeoutMs: 50,
      signal: new AbortController().signal,
    })
    expect(timed.reasonCode).toBe('PROCESS_TIMEOUT')
    const controller = new AbortController()
    const running = subprocess({
      ...input,
      timeoutMs: 5000,
      signal: controller.signal,
    })
    controller.abort()
    expect((await running).reasonCode).toBe('PROCESS_CANCELLED')
  })
  it('persists an interrupted CLI run as failed and terminates its owned child', async () => {
    const { target, env } = await fixtureRoot(0)
    await writeFile(
      join(target, 'bin/pnpm'),
      '#!/usr/bin/env node\nsetInterval(()=>{},1000)\n',
      { mode: 0o700 },
    )
    const child = spawn(
      process.execPath,
      [join(compiled, 'cli.js'), '--checks', 'types'],
      { cwd: target, env, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let cancelled = false
    child.stdout.on('data', (bytes: Buffer) => {
      if (!cancelled && bytes.toString().includes('Checking types')) {
        cancelled = true
        child.kill('SIGTERM')
      }
    })
    const code = await new Promise<number | null>((resolve) =>
      child.on('close', resolve),
    )
    expect(code).toBe(1)
    expect(await latestReport(target)).toMatchObject({
      interrupted: true,
      exitCode: 1,
      releaseReady: false,
    })
  })
  it('captures actual Vitest native retry history without multiplying retries', async () => {
    const fixture = join(root, '.verification/native-retry', randomUUID())
    await mkdir(fixture, { recursive: true })
    await writeFile(
      join(fixture, 'vitest.config.ts'),
      `export default {test:{include:['retry.test.ts'],environment:'node',setupFiles:[${JSON.stringify(join(compiled, 'vitest-attempt-setup.js'))}]}}\n`,
    )
    await writeFile(
      join(fixture, 'retry.test.ts'),
      "import {test,expect} from 'vitest';let attempts=0;test('retry fixture',()=>{attempts++;if(attempts===1)throw new Error('private fixture sentinel');expect(attempts).toBe(2)})\n",
    )
    const output = join(fixture, 'attempts.json')
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--root',
        fixture,
        '--config',
        join(fixture, 'vitest.config.ts'),
        '--retry',
        '2',
        '--maxWorkers',
        '1',
        '--reporter',
        join(compiled, 'vitest-reporter.js'),
      ],
      {
        cwd: root,
        env: { ...safeEnvironment(process.env), HARNESS_ATTEMPTS_FILE: output },
        encoding: 'utf8',
        timeout: 30000,
      },
    )
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const report = validateRunnerOutput(
      JSON.parse(await readFile(output, 'utf8')),
      unit,
    )
    expect(report.attempts.map((attempt) => attempt.outcome)).toEqual([
      'failed',
      'passed',
    ])
    expect(resultStatus(report.attempts)).toBe('flaky')
    const summary = await readFile(`${output}.failure-summary.txt`, 'utf8')
    expect(summary).toContain('retry fixture')
    expect(summary).toContain('retry.test.ts')
    expect(summary).toContain('attempt 1, ASSERTIONS_FAILED')
    expect(summary).not.toContain('private fixture sentinel')
    expect(() =>
      validateRunnerOutput({ ...report, attempts: [report.attempts[1]] }, unit),
    ).toThrow()
  })
  it('writes named Playwright failures for every project and retry without exception payloads', async () => {
    const fixture = join(root, '.verification/browser-reporter', randomUUID())
    await mkdir(fixture, { recursive: true })
    const browser = registry.checks.find((check) => check.id === 'browser')!
    await writeFile(
      join(fixture, 'playwright.config.ts'),
      `export default {testDir:'.',retries:2,projects:${JSON.stringify(['chromium_desktop', 'chromium_mobile', 'webkit_desktop', 'webkit_mobile'].map((name) => ({ name })))}}\n`,
    )
    await writeFile(
      join(fixture, 'failure.spec.ts'),
      "import {test,expect} from '@playwright/test';test('synthetic browser failure',()=>{expect('private fixture sentinel').toBe('expected')})\n",
    )
    const output = join(fixture, 'attempts.json')
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        join(fixture, 'playwright.config.ts'),
        '--workers',
        '1',
        '--reporter',
        join(compiled, 'playwright-reporter.js'),
      ],
      {
        cwd: fixture,
        env: { ...safeEnvironment(process.env), HARNESS_ATTEMPTS_FILE: output },
        encoding: 'utf8',
        timeout: 30000,
      },
    )
    expect(result.status, result.stdout + result.stderr).toBe(1)
    const report = validateRunnerOutput(
      JSON.parse(await readFile(output, 'utf8')),
      browser,
    )
    expect(report.attempts).toHaveLength(12)
    const summary = await readFile(`${output}.failure-summary.txt`, 'utf8')
    expect(summary).toContain('synthetic browser failure')
    expect(summary).toContain('failure.spec.ts:1')
    for (const project of report.browserProjects)
      expect(summary).toContain(project)
    expect(summary).toContain('attempt 3, ASSERTIONS_FAILED')
    expect(summary).not.toContain('private fixture sentinel')
  })
  it('rejects symlink output and never overwrites a run', async () => {
    const target = await mkdtemp(join(tmpdir(), 'sfda-output-'))
    const runId = randomUUID()
    await safeRunDirectory(target, runId, undefined)
    await expect(safeRunDirectory(target, runId, undefined)).rejects.toThrow()
    await symlink(tmpdir(), join(target, '.verification/escape'))
    await expect(
      safeRunDirectory(target, randomUUID(), '.verification/escape'),
    ).rejects.toThrow()
  })
})
describe('definition and argument boundaries', () => {
  it('maps every workspace criterion while keeping fixture and live evidence separate', () => {
    const path = 'docs/specs/0007-campaign-player-workspace/index.md'
    for (const profile of ['preparation', 'campaign'] as const) {
      const capabilities = selectedCapabilities(profile, [])
      const checks = registry.checks.filter((check) =>
        check.capabilities.some((capability) =>
          capabilities.includes(capability),
        ),
      )
      const criteria = new Set(
        checks.flatMap((check) =>
          check.specs
            .filter((mapping) => mapping.path === path)
            .flatMap((mapping) => mapping.criteria),
        ),
      )
      expect([...criteria].sort()).toEqual(
        Array.from({ length: 12 }, (_, index) => `AC-${index + 1}`).sort(),
      )
      for (const [id, evidenceKind] of [
        ['browser', 'fixture_browser'],
        ['database_preparation', 'local_database'],
        ['browser_preparation', 'local_database'],
        ['preparation_accessibility', 'human'],
      ] as const) {
        const check = checks.find((item) => item.id === id)
        expect(check?.evidenceKind).toBe(evidenceKind)
        expect(check?.specs.some((mapping) => mapping.path === path)).toBe(true)
      }
    }
  })
  it('rejects unknown fields, duplicate IDs, unsupported versions and evidence relabeling', () => {
    expect(() => validateRegistry({ ...registry, surprise: true })).toThrow()
    expect(() => validateRegistry({ ...registry, schemaVersion: 2 })).toThrow()
    expect(() =>
      validateRegistry({ ...registry, checks: [types, types] }),
    ).toThrow()
    expect(() =>
      validateRegistry({
        ...registry,
        checks: [{ ...types, evidenceKind: 'local_database' }],
      }),
    ).toThrow()
    expect(() =>
      validateReport(
        { schemaVersion: 1, results: [], releaseReady: true },
        registry,
      ),
    ).toThrow()
    expect(() => validateManifest({ schemaVersion: 1 }, registry)).toThrow()
  })
  it('does not permit readiness filters or implicit paid runs', () => {
    expect(selectedCapabilities('pilot', ['voice'])).toContain('voice')
    expect(selectedCapabilities('pilot', [])).not.toContain('voice')
    expect(() =>
      parseOptions([
        '--mode',
        'readiness',
        '--phase',
        'enable',
        '--evidence',
        'verification/evidence.json',
        '--checks',
        'types',
      ]),
    ).toThrow()
    expect(() => parseOptions(['--mode', 'voice-live'])).toThrow()
    expect(() =>
      parseOptions(['--mode', 'voice-live', '--live', '--max-cases', '11']),
    ).toThrow()
    expect(hash('fixture')).toHaveLength(64)
  })
})
