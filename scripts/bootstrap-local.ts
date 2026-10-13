import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  normalizeEmail,
  record,
  validPassword,
} from '../src/domain/accounts.ts'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
if (process.env.APP_ENV !== 'local')
  fail('Bootstrap requires APP_ENV=local. No account was created.')
if (
  !/^project_id = "sfda-arm-dev"$/m.test(
    readFileSync('supabase/config.toml', 'utf8'),
  )
)
  fail('Bootstrap requires this local project.')
const statusResult = spawnSync(
  'pnpm',
  ['exec', 'supabase', 'status', '-o', 'json'],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 },
)
if (statusResult.status !== 0) fail('Local Supabase is unavailable.')
let status: Record<string, unknown> | undefined
try {
  status = record(JSON.parse(statusResult.stdout))
} catch {
  fail('Local runtime status was invalid.')
}
if (
  !status ||
  !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
    String(status.API_URL),
  ) ||
  typeof status.DB_URL !== 'string' ||
  typeof status.SERVICE_ROLE_KEY !== 'string'
)
  fail('Bootstrap requires verified local Auth and database targets.')
const databaseUrl = new URL(status.DB_URL)
if (
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.port !== '54322'
)
  fail('Bootstrap database target is not local.')
const email = normalizeEmail(process.env.SFDA_BOOTSTRAP_EMAIL)
const name = process.env.SFDA_BOOTSTRAP_NAME?.trim() ?? 'Synthetic admin'
if (
  !email ||
  !/^synthetic-[0-9a-f-]+@example\.invalid$/.test(email) ||
  Array.from(name).length < 1 ||
  Array.from(name).length > 160
)
  fail(
    'Bootstrap requires a generated synthetic email and a valid display name.',
  )
const concealedPassword = async () => {
  if (process.env.SFDA_BOOTSTRAP_PASSWORD)
    return process.env.SFDA_BOOTSTRAP_PASSWORD
  if (!process.stdin.isTTY)
    fail(
      'Supply the password through an ephemeral runtime secret or a concealed terminal prompt.',
    )
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  })
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  })
  process.stdout.write('Temporary local admin password: ')
  try {
    return await new Promise<string>((resolve) => prompt.question('', resolve))
  } finally {
    prompt.close()
    process.stdout.write('\n')
  }
}
const password = await concealedPassword()
if (!validPassword(password))
  fail(
    'The local password must satisfy the approved length and character bounds.',
  )
const operator = createClient(String(status.API_URL), status.SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
const admins = await operator
  .from('profiles')
  .select('id')
  .eq('role', 'admin')
  .limit(1)
if (admins.error || admins.data.length)
  fail(
    'Bootstrap refused. An administrator already exists or cannot be inspected.',
  )
for (let page = 1; page <= 100; page++) {
  const users = await operator.auth.admin.listUsers({ page, perPage: 100 })
  if (users.error) fail('Existing local identities could not be inspected.')
  if (users.data.users.some((user) => normalizeEmail(user.email) === email))
    fail('Bootstrap refused an existing email. No account was adopted.')
  if (users.data.users.length < 100) break
  if (page === 100) fail('Local identity inspection exceeded its bound.')
}
const id = randomUUID()
const created = await operator.auth.admin.createUser({
  id,
  email,
  password,
  email_confirm: true,
  app_metadata: { sfda_local_bootstrap_id: id },
})
if (created.error || created.data.user?.id !== id)
  fail(
    'Local admin identity creation could not be confirmed. No profile was enabled.',
  )
const linked = await operator.rpc('bootstrap_local_admin', {
  profile_id: id,
  display_name: name,
})
if (linked.error)
  fail(
    'Local admin profile and audit could not be committed. No conflicting account was overwritten.',
  )
console.info(
  'The first synthetic local administrator is ready. No password or email was printed.',
)
