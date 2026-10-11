import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

const artifactRoot = resolve('.verification')
for (const path of [artifactRoot, join(artifactRoot, 'builds')]) {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error('UNSAFE_OUTPUT')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
    mkdirSync(path, { mode: 0o700 })
  }
  if (realpathSync(path) !== path) throw new Error('UNSAFE_OUTPUT')
}
const output = join(artifactRoot, 'builds', randomUUID())
mkdirSync(output, { mode: 0o700 })
const compile = spawnSync(
  'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.harness.json', '--outDir', output],
  { stdio: 'inherit' },
)
if (compile.status !== 0) process.exit(compile.status ?? 2)
const run = spawnSync(
  process.execPath,
  [join(output, 'cli.js'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, HARNESS_BIN_DIR: output },
  },
)
process.exit(run.status ?? 1)
