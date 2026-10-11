import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'
import type { Manifest } from './contracts.js'
import { hash } from './io.js'
import * as v from './validation.js'

export type ProductionTarget = Readonly<{
  schemaVersion: 1
  alias: string
  host: string
  port: number
  database: string
  caDigest: string
  appOrigin: string
}>
export const targetRule = v.exact({
  schemaVersion: v.oneOf([1]),
  alias: v.id,
  host: v.match(/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/),
  port: v.integer(1, 65535),
  database: v.match(/^[a-zA-Z0-9_]+$/),
  caDigest: v.digest,
  appOrigin: v.match(/^https:\/\/[a-zA-Z0-9.-]+$/),
})
export type MigrationResult = Readonly<{
  alias: string
  required: readonly string[]
  present: readonly string[]
  missing: readonly string[]
  status: 'passed' | 'failed'
  reasonCode: string
}>
export type HistoryClient = Readonly<{
  connect: () => Promise<void>
  query: (
    sql: string,
    values: readonly string[],
  ) => Promise<Readonly<{ rows: readonly unknown[] }>>
  end: () => Promise<void>
}>
export const assertMigrationTarget = (
  target: ProductionTarget,
  env: NodeJS.ProcessEnv,
) => {
  v.parse<ProductionTarget>(target, targetRule)
  if (
    env.PRODUCTION_TARGET_ALIAS !== target.alias ||
    env.MIGRATION_READ_HOST !== target.host ||
    Number(env.MIGRATION_READ_PORT) !== target.port ||
    env.MIGRATION_READ_DATABASE !== target.database ||
    !env.MIGRATION_READ_CA ||
    hash(env.MIGRATION_READ_CA) !== target.caDigest ||
    ['localhost', '127.0.0.1', '::1'].includes(target.host) ||
    !env.MIGRATION_READ_USER ||
    !env.MIGRATION_READ_PASSWORD ||
    env.MIGRATION_READ_USER === 'postgres'
  )
    v.invalid()
}
export const readMigrationHistory = async (
  target: ProductionTarget,
  env: NodeJS.ProcessEnv,
  manifest: Manifest,
  makeClient: (config: pg.ClientConfig) => HistoryClient = (config) => {
    const client = new pg.Client(config)
    return {
      connect: async () => {
        await client.connect()
      },
      query: (sql, values) => client.query(sql, [...values]),
      end: () => client.end(),
    }
  },
): Promise<MigrationResult> => {
  assertMigrationTarget(target, env)
  const port = Number(env.MIGRATION_READ_PORT)
  const required = manifest.migrations
    .map((migration) => migration.version)
    .sort()
  const client = makeClient({
    host: target.host,
    port,
    database: target.database,
    user: env.MIGRATION_READ_USER,
    password: env.MIGRATION_READ_PASSWORD,
    ssl: { ca: env.MIGRATION_READ_CA, rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 10000,
    application_name: 'sfda_migration_reader',
  })
  try {
    await client.connect()
    await client.query('BEGIN READ ONLY', [])
    const result = await client.query(
      'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version',
      [],
    )
    if (result.rows.length > 10000) v.invalid()
    const present = result.rows.map((row) => {
      const object = v.record(row)
      v.exact({ version: v.match(/^\d{14}$/) })(object)
      return String(object.version)
    })
    v.unique(present)
    await client.query('ROLLBACK', [])
    const missing = required.filter((version) => !present.includes(version))
    return {
      alias: target.alias,
      required,
      present,
      missing,
      status: missing.length ? 'failed' : 'passed',
      reasonCode: missing.length ? 'MIGRATION_MISSING' : 'MIGRATIONS_PRESENT',
    }
  } catch {
    return {
      alias: target.alias,
      required,
      present: [],
      missing: required,
      status: 'failed',
      reasonCode: 'MIGRATION_READ_FAILED',
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}
export const validateMigrationSources = async (
  root: string,
  manifest: Manifest,
) => {
  for (const migration of manifest.migrations) {
    const bytes = await readFile(join(root, migration.path))
    if (hash(bytes) !== migration.digest) v.invalid()
  }
}
// The future delivery workflow owns the real lock and publication operation.
// Neither database setup nor application fixtures are imported by this path.
export const promotion = async (
  input: Readonly<{
    candidate: string
    withLock: <T>(operation: () => Promise<T>) => Promise<T>
    currentMain: () => Promise<string>
    prerequisites: () => Promise<boolean>
    publish: () => Promise<void>
  }>,
): Promise<'published' | 'superseded' | 'blocked'> =>
  input.withLock(async () => {
    if ((await input.currentMain()) !== input.candidate) return 'superseded'
    if (!(await input.prerequisites())) return 'blocked'
    if (
      (await input.currentMain()) !== input.candidate ||
      !(await input.prerequisites())
    )
      return 'blocked'
    await input.publish()
    return 'published'
  })
