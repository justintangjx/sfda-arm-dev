// Spec 0006 trusted administrator procedure. A separately invoked operator command, never a route or CI job.
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import {
  isUuid,
  normalizeEmail,
  record,
  validPassword,
} from '../src/domain/accounts.ts'

type Target = Readonly<{
  appEnv: 'local' | 'production'
  authUrl: string
  publicKey: string
  serviceKey: string
  databaseUrl: string
}>
type Checkpoint = Readonly<{
  operationId: string
  plannedId: string
  emailFingerprint: string
  role: 'admin'
  checkpoint: 'planned' | 'auth_confirmed' | 'login_verified' | 'ready'
}>

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const checkpoints = '.local/operator-operations'
const fingerprint = async (email: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')

const concealed = async (label: string) => {
  if (!process.stdin.isTTY)
    fail('A concealed terminal prompt is required. Nothing was changed.')
  const prompt = createInterface({
    input: process.stdin,
    output: new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    }),
    terminal: true,
  })
  process.stdout.write(label)
  try {
    return await new Promise<string>((resolve) => prompt.question('', resolve))
  } finally {
    prompt.close()
    process.stdout.write('\n')
  }
}
const typed = async (label: string) => {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    return await new Promise<string>((resolve) =>
      prompt.question(label, resolve),
    )
  } finally {
    prompt.close()
  }
}

const localTarget = (): Target => {
  const result = spawnSync(
    'pnpm',
    ['exec', 'supabase', 'status', '-o', 'json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  )
  if (result.status !== 0) fail('Local Supabase is unavailable.')
  let status: Record<string, unknown> | undefined
  try {
    status = record(JSON.parse(result.stdout))
  } catch {
    fail('Local runtime status was invalid.')
  }
  const loopback = (value: unknown) =>
    typeof value === 'string' &&
    ['127.0.0.1', 'localhost'].includes(new URL(value).hostname)
  if (
    !status ||
    !loopback(status.API_URL) ||
    !loopback(status.DB_URL) ||
    typeof status.ANON_KEY !== 'string' ||
    typeof status.SERVICE_ROLE_KEY !== 'string'
  )
    fail('The operator command requires verified loopback local targets.')
  return {
    appEnv: 'local',
    authUrl: String(status.API_URL),
    publicKey: status.ANON_KEY,
    serviceKey: status.SERVICE_ROLE_KEY,
    databaseUrl: String(status.DB_URL),
  }
}
const productionTarget = async (): Promise<Target> => {
  const reference = process.env.SFDA_OPERATOR_PROJECT_REF ?? ''
  const authUrl = process.env.SFDA_OPERATOR_AUTH_URL ?? ''
  const databaseUrl = process.env.SFDA_OPERATOR_DATABASE_URL ?? ''
  const publicKey = process.env.SFDA_OPERATOR_PUBLIC_KEY ?? ''
  const serviceKey = process.env.SFDA_OPERATOR_SERVICE_KEY ?? ''
  if (
    !/^[a-z0-9]{20}$/.test(reference) ||
    authUrl !== `https://${reference}.supabase.co` ||
    !databaseUrl.includes(reference) ||
    !publicKey ||
    !serviceKey
  )
    fail(
      'Production requires an expected project reference with matching Auth and database targets from the operator environment.',
    )
  if ((await typed('Type the project reference to continue: ')) !== reference)
    fail('The typed project reference did not match. Nothing was changed.')
  return { appEnv: 'production', authUrl, publicKey, serviceKey, databaseUrl }
}
const ownerCall = async (
  target: Target,
  text: string,
  values: readonly unknown[],
) => {
  const database = new Client({
    connectionString: target.databaseUrl,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  })
  try {
    await database.connect()
    const result = await database.query(text, [...values])
    return record(record(result.rows[0])?.result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    fail(
      /^[A-Z_]+$/.test(message)
        ? `The database refused the operation (${message}). No access was granted.`
        : 'The database call failed. Resume with the same operation after checking the target.',
    )
  } finally {
    await database.end()
  }
}
const saveCheckpoint = async (value: Checkpoint) => {
  await mkdir(checkpoints, { recursive: true, mode: 0o700 })
  await writeFile(
    `${checkpoints}/${value.operationId}.json`,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  )
}
const loadCheckpoint = async (operationId: string): Promise<Checkpoint> => {
  try {
    const value = record(
      JSON.parse(await readFile(`${checkpoints}/${operationId}.json`, 'utf8')),
    )
    if (
      value?.operationId === operationId &&
      isUuid(value.plannedId) &&
      typeof value.emailFingerprint === 'string' &&
      value.role === 'admin'
    )
      return value as Checkpoint
  } catch {
    /* Reported below without guessing an identity. */
  }
  fail(
    'The checkpoint is missing or invalid. Stop for trusted reconciliation; no identity was guessed.',
  )
}
const verifiedLogin = async (target: Target, email: string, id: string) => {
  const session = createClient(target.authUrl, target.publicKey, options)
  const signedIn = await session.auth.signInWithPassword({
    email,
    password: await concealed('Account owner password: '),
  })
  const matched =
    !signedIn.error &&
    signedIn.data.user?.id === id &&
    Boolean(signedIn.data.user.email_confirmed_at)
  await session.auth.signOut({ scope: 'local' }).catch(() => undefined)
  if (!matched)
    fail(
      'Normal login did not return the expected confirmed identity. No access was granted.',
    )
}

const [mode] = process.argv.slice(2)
const appEnv = process.env.APP_ENV
if (appEnv !== 'local' && appEnv !== 'production')
  fail('APP_ENV must be local or production. Preview is refused.')
if (mode !== 'establish' && mode !== 'verify')
  fail('You can choose establish or verify.')
const email = normalizeEmail(process.env.SFDA_OPERATOR_EMAIL)
if (!email) fail('SFDA_OPERATOR_EMAIL must be a valid email.')
const target = appEnv === 'local' ? localTarget() : await productionTarget()
const operator = createClient(target.authUrl, target.serviceKey, options)
const emailFingerprint = await fingerprint(email)

if (mode === 'verify') {
  const id = process.env.SFDA_OPERATOR_PROFILE_ID
  if (!isUuid(id))
    fail('SFDA_OPERATOR_PROFILE_ID must be the linked admin UUID.')
  await verifiedLogin(target, email, id)
  await ownerCall(
    target,
    'select private.operator_verify_admin($1) as result',
    [id],
  )
  console.info(
    'The existing administrator is verified. Password, role and access are unchanged.',
  )
  process.exit(0)
}

const name = process.env.SFDA_OPERATOR_NAME?.trim() ?? ''
const reason = process.env.SFDA_OPERATOR_REASON?.trim() ?? ''
if (!name || name.length > 160 || !reason || reason.length > 2000)
  fail(
    'A display name and a recorded ownership verification reason are required.',
  )
const resuming = process.env.SFDA_OPERATOR_OPERATION_ID
let checkpoint: Checkpoint
if (resuming) {
  if (!isUuid(resuming)) fail('The operation ID must be a UUID.')
  checkpoint = await loadCheckpoint(resuming)
  if (checkpoint.emailFingerprint !== emailFingerprint)
    fail('This email does not match the checkpoint. Nothing was changed.')
} else {
  for (let page = 1; page <= 100; page++) {
    const users = await operator.auth.admin.listUsers({ page, perPage: 100 })
    if (users.error) fail('Existing identities could not be inspected.')
    if (users.data.users.some((user) => normalizeEmail(user.email) === email))
      fail('An identity already uses this email. It is never adopted.')
    if (users.data.users.length < 100) break
    if (page === 100) fail('Identity inspection exceeded its bound.')
  }
  checkpoint = {
    operationId: crypto.randomUUID(),
    plannedId: crypto.randomUUID(),
    emailFingerprint,
    role: 'admin',
    checkpoint: 'planned',
  }
  await saveCheckpoint(checkpoint)
  console.info(`Operation ${checkpoint.operationId} planned.`)
}
const confirmIdentity = async () => {
  const found = await operator.auth.admin.getUserById(checkpoint.plannedId)
  const user = found.data.user
  return (
    !found.error &&
    user?.id === checkpoint.plannedId &&
    user.app_metadata.sfda_admin_bootstrap_operation_id ===
      checkpoint.operationId &&
    (await fingerprint(normalizeEmail(user.email) ?? '')) === emailFingerprint
  )
}
if (checkpoint.checkpoint === 'planned' && !(await confirmIdentity())) {
  const password = await concealed('Account owner chooses a password: ')
  if (!validPassword(password))
    fail('The password must satisfy the approved length and character bounds.')
  try {
    await operator.auth.admin.createUser({
      id: checkpoint.plannedId,
      email,
      password,
      email_confirm: true,
      app_metadata: {
        sfda_admin_bootstrap_operation_id: checkpoint.operationId,
      },
    })
  } catch {
    /* The planned identity is checked below; creation is never repeated blindly. */
  }
  if (!(await confirmIdentity()))
    fail(
      `Identity creation is unconfirmed. Resume operation ${checkpoint.operationId}; it will not create again or adopt by email.`,
    )
}
checkpoint = { ...checkpoint, checkpoint: 'auth_confirmed' }
await saveCheckpoint(checkpoint)
await verifiedLogin(target, email, checkpoint.plannedId)
checkpoint = { ...checkpoint, checkpoint: 'login_verified' }
await saveCheckpoint(checkpoint)
const committed = await ownerCall(
  target,
  'select private.operator_establish_admin($1, $2, $3, $4) as result',
  [checkpoint.operationId, checkpoint.plannedId, name, reason],
)
checkpoint = { ...checkpoint, checkpoint: 'ready' }
await saveCheckpoint(checkpoint)
console.info(
  committed?.outcome === 'already_committed'
    ? `Operation ${checkpoint.operationId} was already committed.`
    : `Operation ${checkpoint.operationId} established the administrator.`,
)
