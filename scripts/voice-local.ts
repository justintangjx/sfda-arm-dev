import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { record } from '../src/domain/accounts.ts'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
const id = process.env.SFDA_VOICE_RUN_ID
if (!id || !/^[a-f0-9-]{36}$/.test(id))
  fail(
    'You can supply the run ID issued by the trusted voice verification runner.',
  )
const root = realpathSync('.')
const path = join(root, '.local', 'voice-verification', `${id}.json`)
if (
  !existsSync(path) ||
  lstatSync(path).isSymbolicLink() ||
  realpathSync(path) !== path
)
  fail('The private run record is unavailable.')
const run = record(JSON.parse(readFileSync(path, 'utf8')))
const now = Date.now()
if (
  !run ||
  run.schemaVersion !== 1 ||
  run.runId !== id ||
  run.mode !== 'application' ||
  run.appOrigin !== 'http://127.0.0.1:5173' ||
  run.supabaseUrl !== 'http://127.0.0.1:54321' ||
  typeof run.issuedAt !== 'string' ||
  typeof run.expiresAt !== 'string' ||
  Date.parse(run.issuedAt) > now ||
  Date.parse(run.expiresAt) <= now ||
  Date.parse(run.expiresAt) - Date.parse(run.issuedAt) > 900_000 ||
  !Array.isArray(run.cases) ||
  !run.cases.length ||
  run.cases.length > 10
)
  fail('The local run record does not authorise an application session.')
const buildRoot = resolve('.verification', 'builds')
for (const directory of [resolve('.verification'), buildRoot]) {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink())
    fail('The verification output path is unsafe.')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
}
const output = join(buildRoot, randomUUID())
const compiled = spawnSync(
  'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.harness.json', '--outDir', output],
  { stdio: 'inherit' },
)
if (compiled.status !== 0)
  fail('The trusted fingerprint tooling could not compile.')
const io = (await import(pathToFileURL(join(output, 'io.js')).href)) as {
  hash: (value: string | Uint8Array) => string
  fingerprint: (root: string, paths: readonly string[]) => Promise<string>
}
const release = record(
  JSON.parse(readFileSync('verification/release.json', 'utf8')),
)
if (
  !release ||
  !Array.isArray(release.inputPaths) ||
  !release.inputPaths.every((p) => typeof p === 'string')
)
  fail('The reviewed input paths are unavailable.')
const runtime = io.hash(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    files: await io.fingerprint(root, [
      'wrangler.jsonc',
      'pnpm-lock.yaml',
      'vite.config.ts',
      'playwright.config.ts',
      'tsconfig.harness.json',
    ]),
  }),
)
if (
  runtime !== run.runtimeFingerprint ||
  (await io.fingerprint(root, release.inputPaths)) !== run.inputFingerprint ||
  io.hash(readFileSync('verification/cases/voice-text.json')) !==
    run.corpusFingerprint
)
  fail('The application, runtime or corpus changed after this run was issued.')
const variablesPath = '.dev.vars'
const original = existsSync(variablesPath)
  ? readFileSync(variablesPath, 'utf8')
  : ''
if (/^VOICE_LOCAL_RUN_RECORD=/m.test(original))
  fail(
    'An installed voice run already exists. No local settings were replaced.',
  )
const temporary = `${original}${original.endsWith('\n') ? '' : '\n'}VOICE_ENABLED=true\nVOICE_LOCAL_RUN_RECORD='${JSON.stringify(run)}'\n`
writeFileSync(variablesPath, temporary, { mode: 0o600 })
try {
  console.info(
    'Synthetic voice verification is enabled for the issued cases until the private run expires. Provider keys were withheld.',
  )
  const server = spawnSync('pnpm', ['dev'], {
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_ENV: undefined },
  })
  process.exitCode = server.status ?? 1
} finally {
  // Do not overwrite an external edit made while the development server was running.
  if (readFileSync(variablesPath, 'utf8') === temporary)
    writeFileSync(variablesPath, original, { mode: 0o600 })
}
