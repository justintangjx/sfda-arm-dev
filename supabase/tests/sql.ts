import { spawnSync } from 'node:child_process'
import { Client } from 'pg'

const assertLocalTarget = () => {
  if (
    !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
      process.env.SFDA_TEST_SUPABASE_URL ?? '',
    )
  )
    throw new Error('Local SQL checks require the verified synthetic target.')
}

// Test only. A fixed local container is the sole privileged SQL target.
export const localSql = (sql: string): unknown => {
  assertLocalTarget()
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

// Test only. Parameterised owner access to the local container for fault injection.
export const ownerQuery = async (
  statements: readonly Readonly<{
    text: string
    values?: readonly unknown[]
  }>[],
): Promise<readonly unknown[]> => {
  assertLocalTarget()
  const database = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
  try {
    await database.connect()
    await database.query('begin')
    const rows: unknown[] = []
    for (const statement of statements)
      rows.push(
        ...(await database.query(statement.text, [...(statement.values ?? [])]))
          .rows,
      )
    await database.query('commit')
    return rows
  } catch {
    throw new Error('Synthetic owner query failed. Output was withheld.')
  } finally {
    await database.end()
  }
}

// Test only. Returns a stable database code for an expected owner failure, withholding any other output.
export const ownerRejection = async (
  text: string,
  values: readonly unknown[],
): Promise<string | undefined> => {
  assertLocalTarget()
  const database = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
  try {
    await database.connect()
    await database.query(text, [...values])
    return undefined
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    return /^[A-Z_]+$/.test(message) ? message : 'UNEXPECTED'
  } finally {
    await database.end()
  }
}

export const expireRecoveryClaim = (operationId: string) =>
  ownerQuery([
    { text: 'set local session_replication_role = replica' },
    {
      text: "update private.password_recovery_operations set claim_until = current_timestamp - interval '1 second' where id = $1",
      values: [operationId],
    },
  ])

// The guard never lets a cooldown shorten, so expiry bypasses triggers for this one row.
export const expireEmailCooldown = (profileId: string) =>
  ownerQuery([
    { text: 'set local session_replication_role = replica' },
    {
      text: "update private.account_password_state set next_email_allowed_at = current_timestamp - interval '1 second', version = version + 1, updated_at = current_timestamp where profile_id = $1",
      values: [profileId],
    },
  ])

export const markPasswordInitialized = (profileId: string) =>
  ownerQuery([
    {
      text: 'select private.link_initialize($1)',
      values: [profileId],
    },
  ])
