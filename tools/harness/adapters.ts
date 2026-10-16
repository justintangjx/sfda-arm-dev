import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, mkdir, rm } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium, webkit } from '@playwright/test'
import type { Attempt, Check, Result } from './contracts.js'
import { attemptRule, resultStatus } from './contracts.js'
import { json, hash } from './io.js'
import { subprocess, safeEnvironment } from './process.js'
import * as v from './validation.js'

export const browserProjects = [
  'chromium_desktop',
  'chromium_mobile',
  'webkit_desktop',
  'webkit_mobile',
] as const
export const resultFor = (
  check: Check,
  status: Result['status'],
  reasonCode: string,
  attempts: readonly Attempt[] = [],
): Result => ({
  checkId: check.id,
  evidenceKind: check.evidenceKind,
  specs: check.specs,
  status,
  reasonCode,
  attempts,
  caseResultIds: [],
  execution: {
    runtime: attempts.length ? 'node' : 'unavailable',
    browserProjects: [],
    databaseTarget:
      attempts.length &&
      [
        'database_preparation',
        'database_campaign',
        'database_accounts',
        'database_voice',
        'browser_preparation',
      ].includes(check.id)
        ? 'sfda_arm_dev_local'
        : null,
  },
})
export const attemptFor = (
  subject: string,
  outcome: Attempt['outcome'],
  reasonCode: string,
  startedAt: string,
  durationMs: number,
): Attempt => ({
  id: randomUUID(),
  subjectId: hash(subject),
  index: 0,
  startedAt,
  durationMs,
  outcome,
  reasonCode,
  integrityFindings: [],
})
const runnerRule = v.exact({
  schemaVersion: v.oneOf([1]),
  attempts: v.list(attemptRule),
  browserProjects: v.list(v.id),
})
type RunnerOutput = Readonly<{
  schemaVersion: 1
  attempts: readonly Attempt[]
  browserProjects: readonly string[]
}>
export const validateRunnerOutput = (
  value: unknown,
  check: Check,
): RunnerOutput => {
  const output = v.parse<RunnerOutput>(value, runnerRule)
  v.unique(output.attempts.map((attempt) => attempt.id))
  for (const subject of new Set(
    output.attempts.map((attempt) => attempt.subjectId),
  )) {
    if (
      output.attempts
        .filter((attempt) => attempt.subjectId === subject)
        .some((attempt, index) => attempt.index !== index)
    )
      v.invalid()
  }
  if (
    ['browser', 'browser_preparation'].includes(check.adapterId) &&
    JSON.stringify([...output.browserProjects].sort()) !==
      JSON.stringify([...browserProjects].sort())
  )
    v.invalid()
  if (
    !['browser', 'browser_preparation'].includes(check.adapterId) &&
    output.browserProjects.length
  )
    v.invalid()
  return output
}
type Context = Readonly<{
  root: string
  runDirectory: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
}>
const localDatabaseEnvironment = async (
  context: Context,
): Promise<NodeJS.ProcessEnv | undefined> => {
  if (context.env.APP_ENV !== 'local') return undefined
  if (
    context.env.SUPABASE_URL &&
    !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
      context.env.SUPABASE_URL,
    )
  )
    v.invalid()
  const config = await readFile(
    join(context.root, 'supabase/config.toml'),
    'utf8',
  )
  if (
    !/^project_id = "sfda-arm-dev"$/m.test(config) ||
    !/\[api\][\s\S]*?^port = 54321$/m.test(config) ||
    !/\[db\][\s\S]*?^port = 54322$/m.test(config)
  )
    v.invalid()
  const env = safeEnvironment(context.env)
  const dockerPath = '/Applications/Docker.app/Contents/Resources/bin'
  if (existsSync(dockerPath))
    env.PATH = `${dockerPath}${delimiter}${env.PATH ?? ''}`
  const status = await subprocess({
    command: 'pnpm',
    args: ['exec', 'supabase', 'status', '-o', 'json'],
    cwd: context.root,
    env,
    signal: context.signal,
    timeoutMs: 15000,
    capture: true,
  })
  if (
    status.reasonCode === 'PROCESS_CANCELLED' ||
    status.reasonCode === 'PROCESS_TIMEOUT'
  )
    throw new Error(status.reasonCode)
  if (status.exitCode !== 0) return undefined
  let value: Record<string, unknown>
  try {
    value = v.record(JSON.parse(status.stdout))
  } catch {
    v.invalid()
  }
  if (
    !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
      String(value.API_URL),
    ) ||
    ![
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      'postgresql://postgres:postgres@localhost:54322/postgres',
    ].includes(String(value.DB_URL))
  )
    v.invalid()
  if (
    typeof value.ANON_KEY !== 'string' ||
    typeof value.SERVICE_ROLE_KEY !== 'string'
  )
    return undefined
  const client = createClient(String(value.API_URL), value.SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(10000)]),
        }),
    },
  })
  for (let page = 1; page <= 100; page++) {
    const users = await client.auth.admin.listUsers({ page, perPage: 100 })
    if (users.error) throw new Error('LOCAL_INSPECTION_FAILED')
    if (
      users.data.users.some(
        (user) =>
          !/^synthetic-[0-9a-f-]+@example\.invalid$/.test(user.email ?? ''),
      )
    )
      v.invalid()
    if (users.data.users.length < 100)
      return {
        ...env,
        APP_ENV: 'local',
        SFDA_TEST_SUPABASE_URL: String(value.API_URL),
        SFDA_TEST_SUPABASE_PUBLIC_KEY: value.ANON_KEY,
        SFDA_TEST_SUPABASE_ADMIN_KEY: value.SERVICE_ROLE_KEY,
        ...(typeof (value.MAILPIT_URL ?? value.INBUCKET_URL) === 'string'
          ? {
              SFDA_TEST_SUPABASE_MAIL_URL: String(
                value.MAILPIT_URL ?? value.INBUCKET_URL,
              ),
            }
          : {}),
      }
  }
  v.invalid()
}
export const executeCheck = async (
  check: Check,
  context: Context,
): Promise<Result> => {
  const output = join(context.runDirectory, `${check.id}.attempts.json`)
  let env: NodeJS.ProcessEnv = {
    ...safeEnvironment(context.env),
    HARNESS_ATTEMPTS_FILE: output,
  }
  let args: readonly string[]
  let runner = false
  let releaseLock: (() => Promise<void>) | undefined
  const binDirectory =
    context.env.HARNESS_BIN_DIR ?? join(context.root, '.verification/bin')
  const reporter = join(binDirectory, 'vitest-reporter.js')
  const config = join(binDirectory, 'vitest-harness.config.js')
  switch (check.adapterId) {
    case 'types':
      args = ['typecheck']
      break
    case 'build':
      args = ['build']
      break
    case 'lint':
      args = ['lint']
      break
    case 'format':
      args = ['format:check']
      break
    case 'unit':
      args = [
        'exec',
        'vitest',
        'run',
        'src',
        '--retry',
        '2',
        '--testTimeout',
        '60000',
        '--reporter',
        reporter,
      ]
      runner = true
      break
    case 'harness':
      args = [
        'exec',
        'vitest',
        'run',
        'tools/harness',
        '--retry',
        '2',
        '--testTimeout',
        '60000',
        '--reporter',
        reporter,
      ]
      runner = true
      break
    case 'voice_simulation':
      args = [
        'exec',
        'vitest',
        'run',
        'src/domain/feedback.test.ts',
        'src/domain/voice.test.ts',
        'src/app/voice/controller.test.ts',
        'src/worker/voice.test.ts',
        '--retry',
        '2',
        '--testTimeout',
        '60000',
        '--reporter',
        reporter,
      ]
      runner = true
      break
    case 'browser':
    case 'browser_preparation': {
      const chromiumPath =
        context.env.PLAYWRIGHT_BROWSER_CHANNEL === 'chrome'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : chromium.executablePath()
      if (!existsSync(chromiumPath) || !existsSync(webkit.executablePath()))
        return resultFor(check, 'missing', 'BROWSER_UNAVAILABLE')
      if (check.adapterId === 'browser_preparation') {
        const localEnv = await localDatabaseEnvironment(context)
        if (!localEnv || !localEnv.SFDA_TEST_SUPABASE_MAIL_URL)
          return resultFor(check, 'missing', 'LOCAL_DATABASE_UNAVAILABLE')
        if (
          !context.env.SFDA_LIVE_ADMIN_EMAIL ||
          !context.env.SFDA_LIVE_ADMIN_PASSWORD
        )
          return resultFor(
            check,
            'missing',
            'LOCAL_BOOTSTRAP_CREDENTIALS_MISSING',
          )
        env = {
          ...localEnv,
          HARNESS_ATTEMPTS_FILE: output,
          SFDA_LIVE_ADMIN_EMAIL: context.env.SFDA_LIVE_ADMIN_EMAIL,
          SFDA_LIVE_ADMIN_PASSWORD: context.env.SFDA_LIVE_ADMIN_PASSWORD,
        }
        args = [
          'e2e:live',
          '--reporter',
          join(binDirectory, 'playwright-reporter.js'),
        ]
        runner = true
        break
      }
      args = [
        'exec',
        'playwright',
        'test',
        '--reporter',
        join(binDirectory, 'playwright-reporter.js'),
      ]
      runner = true
      break
    }
    case 'database_preparation':
    case 'database_voice':
    case 'database_accounts':
    case 'database_campaign': {
      const lock = join(context.root, '.verification/local-database.lock')
      try {
        await mkdir(lock)
      } catch {
        return resultFor(check, 'missing', 'LOCAL_DATABASE_BUSY')
      }
      releaseLock = () => rm(lock, { recursive: true })
      try {
        const localEnv = await localDatabaseEnvironment(context)
        if (!localEnv) {
          await releaseLock()
          return resultFor(check, 'missing', 'LOCAL_DATABASE_UNAVAILABLE')
        }
        env = {
          ...localEnv,
          HARNESS_ATTEMPTS_FILE: output,
          HARNESS_DATABASE: 'true',
        }
      } catch (error) {
        await releaseLock()
        throw error
      }
      args = [
        'exec',
        'vitest',
        'run',
        '--config',
        config,
        ...(check.adapterId === 'database_preparation'
          ? [
              'supabase/tests/preparation.test.ts',
              'supabase/tests/coach-workspace.test.ts',
              'supabase/tests/coach-workspace-regression.test.ts',
            ]
          : check.adapterId === 'database_voice'
            ? ['supabase/tests/voice-sessions.test.ts']
            : check.adapterId === 'database_accounts'
              ? [
                  'supabase/tests/account-setup.test.ts',
                  'supabase/tests/auth-compatibility.test.ts',
                  'supabase/tests/worker-accounts.test.ts',
                  'supabase/tests/live-adapter.test.ts',
                  'supabase/tests/account-operations.test.ts',
                  'supabase/tests/worker-recovery.test.ts',
                ]
              : ['supabase/tests/final-lifecycle.test.ts']),
        '--retry',
        '2',
        '--testTimeout',
        '120000',
        '--reporter',
        reporter,
      ]
      runner = true
      break
    }
    default:
      return resultFor(check, 'missing', 'ADAPTER_UNAVAILABLE')
  }
  const startedAt = new Date().toISOString()
  if (
    runner &&
    !['browser', 'browser_preparation'].includes(check.adapterId) &&
    !args.includes('--config')
  )
    args = [...args, '--config', config]
  let processResult
  try {
    processResult = await subprocess({
      command: 'pnpm',
      args,
      cwd: context.root,
      env,
      timeoutMs: check.timeoutSeconds * 1000,
      signal: context.signal,
    })
  } finally {
    await releaseLock?.()
  }
  const processAttempt = attemptFor(
    check.id,
    processResult.exitCode === 0 && processResult.reasonCode === 'PROCESS_OK'
      ? 'passed'
      : processResult.reasonCode === 'PROCESS_CANCELLED'
        ? 'cancelled'
        : 'failed',
    processResult.reasonCode,
    startedAt,
    processResult.durationMs,
  )
  if (!runner)
    return resultFor(
      check,
      processResult.exitCode === 0 && processResult.reasonCode === 'PROCESS_OK'
        ? 'passed'
        : 'failed',
      processResult.reasonCode,
      [processAttempt],
    )
  let outputValue: RunnerOutput
  try {
    outputValue = validateRunnerOutput(await json(output), check)
  } catch {
    return resultFor(check, 'failed', 'RUNNER_OUTPUT_INVALID', [
      processAttempt.outcome === 'passed'
        ? {
            ...processAttempt,
            outcome: 'failed',
            reasonCode: 'RUNNER_OUTPUT_INVALID',
          }
        : processAttempt,
    ])
  }
  const attempts = outputValue.attempts
  if (processResult.exitCode !== 0 || processResult.reasonCode !== 'PROCESS_OK')
    return resultFor(check, 'failed', processResult.reasonCode, [
      ...attempts,
      processAttempt,
    ])
  if (!attempts.length) return resultFor(check, 'missing', 'EMPTY_SUITE')
  const status = resultStatus(attempts)
  const result = resultFor(
    check,
    status,
    status === 'missing'
      ? 'SKIPPED_REQUIRED_TEST'
      : status === 'flaky'
        ? 'PASSED_AFTER_RETRY'
        : status === 'failed'
          ? 'ASSERTIONS_FAILED'
          : 'ASSERTIONS_PASSED',
    attempts,
  )
  return ['browser', 'browser_preparation'].includes(check.adapterId)
    ? {
        ...result,
        execution: {
          runtime: 'workerd',
          browserProjects: outputValue.browserProjects,
          databaseTarget:
            check.adapterId === 'browser_preparation'
              ? 'sfda_arm_dev_local'
              : null,
        },
      }
    : result
}
