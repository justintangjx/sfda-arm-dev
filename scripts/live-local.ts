import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { record } from '../src/domain/accounts.ts'
import { readAccess } from '../src/domain/accounts.ts'
import { createClient } from '@supabase/supabase-js'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'test')
  fail('You can choose dev or test for the local live runtime.')
if (
  !/^project_id = "sfda-arm-dev"$/m.test(
    readFileSync('supabase/config.toml', 'utf8'),
  )
)
  fail('The local project does not match.')
const result = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
})
if (result.status !== 0)
  fail('Local Supabase is unavailable. No credentials were printed.')
let status: Record<string, unknown> | undefined
try {
  status = record(JSON.parse(result.stdout))
} catch {
  fail('Local runtime status was invalid.')
}
if (
  !status ||
  status.API_URL !== 'http://127.0.0.1:54321' ||
  typeof status.ANON_KEY !== 'string' ||
  typeof status.SERVICE_ROLE_KEY !== 'string'
)
  fail('This runtime requires the verified local Supabase API.')
const bindings = {
  SUPABASE_URL: status.API_URL,
  SUPABASE_PUBLIC_KEY: status.ANON_KEY,
  SUPABASE_ADMIN_KEY: status.SERVICE_ROLE_KEY,
}
const existing = existsSync('.dev.vars')
  ? readFileSync('.dev.vars', 'utf8')
  : ''
const readBinding = (key: string) => {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(existing)
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2')
}
for (const [key, expected] of Object.entries(bindings)) {
  const actual = readBinding(key)
  if (actual && actual !== expected)
    fail(
      'Existing local Worker settings do not match CLI status. No file was overwritten.',
    )
}
const missing = Object.entries(bindings)
  .filter(([key]) => !readBinding(key))
  .map(([key, value]) => `${key}=${value}`)
if (missing.length)
  writeFileSync(
    '.dev.vars',
    `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`,
    { mode: 0o600 },
  )
console.info('Local Worker bindings are ready. Connection keys were withheld.')
if (mode === 'dev') {
  const server = spawnSync('pnpm', ['dev'], {
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_ENV: undefined },
  })
  process.exit(server.status ?? 1)
}
const mail = status.MAILPIT_URL ?? status.INBUCKET_URL
if (
  typeof mail !== 'string' ||
  !['http://127.0.0.1:54324', 'http://localhost:54324'].includes(mail)
)
  fail('Local mail capture is required for the live browser path.')
const suppliedAdmin = Boolean(
  process.env.SFDA_LIVE_ADMIN_EMAIL || process.env.SFDA_LIVE_ADMIN_PASSWORD,
)
if (
  suppliedAdmin &&
  (!process.env.SFDA_LIVE_ADMIN_EMAIL || !process.env.SFDA_LIVE_ADMIN_PASSWORD)
)
  fail('Both local admin inputs are required. No bootstrap was attempted.')
const email =
  process.env.SFDA_LIVE_ADMIN_EMAIL ??
  `synthetic-${randomUUID()}@example.invalid`
const password = process.env.SFDA_LIVE_ADMIN_PASSWORD ?? ` ${randomUUID()} `
const environment = {
  ...process.env,
  APP_ENV: 'local',
  CLOUDFLARE_ENV: undefined,
  SFDA_BOOTSTRAP_EMAIL: email,
  SFDA_BOOTSTRAP_PASSWORD: password,
  SFDA_BOOTSTRAP_NAME: 'Synthetic local operator',
  SFDA_TEST_SUPABASE_URL: status.API_URL,
  SFDA_TEST_SUPABASE_PUBLIC_KEY: status.ANON_KEY,
  SFDA_TEST_SUPABASE_ADMIN_KEY: status.SERVICE_ROLE_KEY,
  SFDA_TEST_SUPABASE_MAIL_URL: mail,
  SFDA_LIVE_ADMIN_EMAIL: email,
  SFDA_LIVE_ADMIN_PASSWORD: password,
}
if (suppliedAdmin) {
  const caller = createClient(status.API_URL, status.ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const signedIn = await caller.auth.signInWithPassword({ email, password })
  const access = signedIn.error
    ? undefined
    : readAccess((await caller.rpc('get_my_access')).data)
  const valid =
    access?.enabled &&
    access.role === 'admin' &&
    access.id === signedIn.data.user?.id &&
    signedIn.data.user?.app_metadata.sfda_local_bootstrap_id === access.id
  await caller.auth.signOut({ scope: 'local' })
  if (!valid)
    fail(
      'The supplied local bootstrap administrator could not be verified. No account was adopted.',
    )
} else {
  const bootstrap = spawnSync(
    process.execPath,
    ['scripts/bootstrap-local.ts'],
    { env: environment, stdio: 'inherit' },
  )
  if (bootstrap.status !== 0)
    fail(
      'The clean local bootstrap prerequisite failed. Live readiness remains unproven.',
    )
}
const browser = spawnSync(
  'pnpm',
  [
    'exec',
    'playwright',
    'test',
    '--config',
    'playwright.live.config.ts',
    ...process.argv.slice(3),
  ],
  { env: environment, stdio: 'inherit' },
)
process.exit(browser.status ?? 1)
