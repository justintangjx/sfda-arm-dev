import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const command = process.argv[2]
const dockerDirectory = '/Applications/Docker.app/Contents/Resources/bin'
const environment = {
  ...process.env,
  PATH: existsSync(dockerDirectory)
    ? `${dockerDirectory}${delimiter}${process.env.PATH ?? ''}`
    : process.env.PATH,
}
const run = (args: readonly string[]) =>
  spawnSync('pnpm', ['exec', 'supabase', ...args], {
    env: environment,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
const assertProject = () => {
  const config = readFileSync('supabase/config.toml', 'utf8')
  if (!/^project_id = "sfda-arm-dev"$/m.test(config))
    fail('The local project identifier does not match. No operation was run.')
}
const localStatus = (): Record<string, unknown> => {
  const result = run(['status', '-o', 'json'])
  if (result.status !== 0)
    fail(
      'Local Supabase is unavailable. You can run pnpm db:start with Docker running.',
    )
  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch {
    fail('Local Supabase status was not valid JSON.')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('Local Supabase status was not an object.')
  return value as Record<string, unknown>
}
const assertLocal = (status: Record<string, unknown>) => {
  // Never accept environment overrides or a linked project for privileged checks.
  const url = status.API_URL
  if (url !== 'http://127.0.0.1:54321' && url !== 'http://localhost:54321')
    fail('The database test target must be this project’s local Supabase API.')
}

assertProject()
if (command === 'reset') {
  const status = localStatus()
  assertLocal(status)
  if (typeof status.SERVICE_ROLE_KEY !== 'string')
    fail('Local fixture key is unavailable.')
  const operator = createClient(
    String(status.API_URL),
    String(status.SERVICE_ROLE_KEY),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )
  // Refuse to reset any database containing an Auth account outside this fixture.
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await operator.auth.admin.listUsers({
      page,
      perPage: 100,
    })
    if (
      error ||
      data.users.some(
        (user) =>
          !/^synthetic-[0-9a-f-]+@example\.invalid$/.test(user.email ?? ''),
      )
    )
      fail(
        'Local reset refused. The database could contain accounts outside the synthetic fixture.',
      )
    if (data.users.length < 100) break
    if (page === 100)
      fail('Local reset refused. Fixture inspection exceeded its bound.')
  }
  if (run(['db', 'reset', '--local']).status !== 0)
    fail('Local synthetic reset failed.')
  console.info('Local synthetic database reset and migrations replayed.')
} else if (command === 'restart') {
  assertLocal(localStatus())
  if (run(['stop']).status !== 0) fail('Local Supabase did not stop.')
  if (run(['start']).status !== 0) fail('Local Supabase did not restart.')
  console.info('Local Supabase restarted with its updated configuration.')
} else if (command === 'start') {
  const result = run(['start'])
  if (result.status !== 0)
    fail(
      'Local Supabase did not start. You can inspect Docker and run pnpm exec supabase start for details.',
    )
  console.info(
    'Local Supabase is running. Connection keys were withheld from output.',
  )
} else if (command === 'apply' || command === 'types') {
  assertLocal(localStatus())
  const result = run(
    command === 'apply'
      ? ['migration', 'up', '--local']
      : [
          'gen',
          'types',
          '--lang',
          'typescript',
          '--local',
          '--schema',
          'public',
        ],
  )
  if (result.status !== 0)
    fail(`Local database ${command} failed. No provider output was printed.`)
  if (command === 'types') {
    if (!result.stdout.includes('export type Database'))
      fail('The generated database types were not recognised.')
    writeFileSync('src/domain/database.types.ts', result.stdout)
  }
  console.info(`Local database ${command} completed.`)
} else if (command === 'test') {
  const status = localStatus()
  assertLocal(status)
  if (
    typeof status.ANON_KEY !== 'string' ||
    typeof status.SERVICE_ROLE_KEY !== 'string'
  )
    fail('Local Supabase test keys are unavailable.')
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.database.config.ts'],
    {
      env: {
        ...environment,
        SFDA_TEST_SUPABASE_URL: String(status.API_URL),
        SFDA_TEST_SUPABASE_PUBLIC_KEY: String(status.ANON_KEY),
        SFDA_TEST_SUPABASE_ADMIN_KEY: String(status.SERVICE_ROLE_KEY),
      },
      stdio: 'inherit',
    },
  )
  process.exit(result.status ?? 1)
} else {
  fail('You can choose start, restart, reset, apply, types or test.')
}
