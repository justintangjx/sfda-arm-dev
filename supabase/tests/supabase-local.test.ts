import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(
  new URL('../../scripts/supabase-local.ts', import.meta.url),
)
const syntheticStatus = {
  API_URL: 'http://127.0.0.1:54321',
  ANON_KEY: 'synthetic-public',
  SERVICE_ROLE_KEY: 'synthetic-admin',
}
const run = (
  command: string,
  overrides: Readonly<Record<string, string>> = {},
  project = 'sfda-arm-dev',
) => {
  const directory = mkdtempSync(join(tmpdir(), 'sfda-tool-test-'))
  try {
    mkdirSync(join(directory, 'supabase'))
    mkdirSync(join(directory, 'src', 'domain'), { recursive: true })
    writeFileSync(
      join(directory, 'supabase', 'config.toml'),
      `project_id = "${project}"\n`,
    )
    // Only the CLI process boundary is simulated. No Docker or real database is touched.
    writeFileSync(
      join(directory, 'pnpm'),
      `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[2] === 'status') {
  process.stdout.write(process.env.SFDA_FAKE_STATUS);
  process.exit(Number(process.env.SFDA_FAKE_STATUS_EXIT ?? '0'));
}
process.stdout.write(process.env.SFDA_FAKE_OUTPUT ?? 'synthetic-provider-output-withheld');
process.stderr.write('synthetic-provider-detail-withheld');
process.exit(Number(process.env.SFDA_FAKE_EXIT ?? '0'));
`,
      { mode: 0o700 },
    )
    const result = spawnSync(process.execPath, [script, command], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        SFDA_FAKE_STATUS: JSON.stringify(syntheticStatus),
        ...overrides,
      },
    })
    let calls: unknown[] = []
    try {
      calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((value) => JSON.parse(value) as unknown)
    } catch {
      /* The project guard may prevent any command. */
    }
    let generated: string | undefined
    try {
      generated = readFileSync(
        join(directory, 'src', 'domain', 'database.types.ts'),
        'utf8',
      )
    } catch {
      /* Most commands do not generate a file. */
    }
    return { ...result, calls, generated }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('local database CLI safety with simulated processes (covers: AC-15, AC-16)', () => {
  it('refuses a different project before invoking Supabase', () => {
    const result = run('apply', {}, 'another-project')
    expect(result.status).toBe(1)
    expect(result.calls).toEqual([])
  })
  it.each(['apply', 'types', 'test', 'reset', 'restart'])(
    'refuses a hosted API target for %s',
    (command) => {
      const result = run(command, {
        SFDA_FAKE_STATUS: JSON.stringify({
          ...syntheticStatus,
          API_URL: 'https://synthetic.example.invalid',
        }),
      })
      expect(result.status).toBe(1)
      expect(result.calls).toEqual([
        ['exec', 'supabase', 'status', '-o', 'json'],
      ])
      expect(result.stderr).toContain('local Supabase API')
      expect(result.stderr).not.toContain('synthetic-admin')
    },
  )
  it.each(['not json', 'null', '[]'])(
    'rejects malformed local status %#',
    (status) => {
      const result = run('apply', { SFDA_FAKE_STATUS: status })
      expect(result.status).toBe(1)
      expect(result.calls).toHaveLength(1)
    },
  )
  it('stops when local status is unavailable', () => {
    const result = run('apply', { SFDA_FAKE_STATUS_EXIT: '1' })
    expect(result.status).toBe(1)
    expect(result.calls).toHaveLength(1)
  })
  it('refuses database tests when local keys are absent', () => {
    const result = run('test', {
      SFDA_FAKE_STATUS: JSON.stringify({ API_URL: syntheticStatus.API_URL }),
    })
    expect(result.status).toBe(1)
    expect(result.calls).toHaveLength(1)
  })
  it('applies migrations only with the local flag and withholds provider output', () => {
    const result = run('apply')
    expect(result.status).toBe(0)
    expect(result.calls).toEqual([
      ['exec', 'supabase', 'status', '-o', 'json'],
      ['exec', 'supabase', 'migration', 'up', '--local'],
    ])
    expect(result.stdout).toContain('completed')
    expect(result.stdout + result.stderr).not.toContain('synthetic-provider')
  })
  it('reports a failed migration without printing provider details', () => {
    const result = run('apply', { SFDA_FAKE_EXIT: '1' })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).not.toContain('synthetic-provider')
  })
  it('rejects unrecognised generated types without writing a file', () => {
    const result = run('types')
    expect(result.status).toBe(1)
    expect(result.generated).toBeUndefined()
  })
  it('writes recognised types only from the local public schema', () => {
    const output = 'export type Database = { public: {} }\n'
    const result = run('types', { SFDA_FAKE_OUTPUT: output })
    expect(result.status).toBe(0)
    expect(result.calls[1]).toEqual([
      'exec',
      'supabase',
      'gen',
      'types',
      '--lang',
      'typescript',
      '--local',
      '--schema',
      'public',
    ])
    expect(result.generated).toBe(output)
  })
  it('starts local Supabase without printing connection keys', () => {
    const result = run('start')
    expect(result.status).toBe(0)
    expect(result.calls).toEqual([['exec', 'supabase', 'start']])
    expect(result.stdout + result.stderr).not.toContain('synthetic-provider')
  })
  it('refuses an unknown command without invoking Supabase', () => {
    const result = run('unknown')
    expect(result.status).toBe(1)
    expect(result.calls).toEqual([])
  })
})
