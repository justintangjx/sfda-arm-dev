import { spawnSync } from 'node:child_process'

// Test only. A fixed local container is the sole privileged SQL target.
export const localSql = (sql: string): unknown => {
  if (
    !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
      process.env.SFDA_TEST_SUPABASE_URL ?? '',
    )
  )
    throw new Error('Local SQL checks require the verified synthetic target.')
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_sfda-arm-dev',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    },
  )
  if (result.status !== 0)
    throw new Error('Local SQL evidence query failed. Output was withheld.')
  return JSON.parse(result.stdout.trim()) as unknown
}
