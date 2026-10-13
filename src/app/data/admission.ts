import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isUuid,
  readAccountSummary,
  record,
  type AccountSummary,
} from '../../domain/accounts'
import type { ApplicationDatabase } from '../../domain/database'
import type { Json } from '../../domain/database.types'
import type { DataResult } from '../coach/contracts'

const failure = (
  code: 'DATABASE_ERROR' | 'NETWORK_ERROR' | 'INVALID_RESPONSE',
): DataResult<never> => ({ ok: false, code, requestId: crypto.randomUUID() })

export const loadAdmissionCandidates = async (
  client: SupabaseClient<ApplicationDatabase>,
): Promise<DataResult<readonly AccountSummary[]>> => {
  let cursor: Json | null = null
  let accounts: readonly AccountSummary[] = []
  const seen = new Set<string>()
  try {
    do {
      const result = await client.rpc('admin_list_accounts', {
        name_query: null,
        role_filter: null,
        enabled_filter: true,
        page_cursor: cursor,
        page_size: 100,
      })
      if (result.error) return failure('DATABASE_ERROR')
      const page = record(result.data)
      if (!page || !Array.isArray(page.items))
        return failure('INVALID_RESPONSE')
      const parsed = page.items.map(readAccountSummary)
      if (parsed.some((item) => item === undefined))
        return failure('INVALID_RESPONSE')
      accounts = [...accounts, ...(parsed as AccountSummary[])]
      if (page.nextCursor === null) break
      const next = record(page.nextCursor)
      if (
        !next ||
        !isUuid(next.id) ||
        typeof next.createdAt !== 'string' ||
        parsed.length === 0
      )
        return failure('INVALID_RESPONSE')
      cursor = { createdAt: next.createdAt, id: next.id }
      const key = JSON.stringify(cursor)
      if (seen.has(key)) return failure('INVALID_RESPONSE')
      seen.add(key)
    } while (cursor !== null)
    return {
      ok: true,
      value: accounts.filter(
        (item) =>
          item.enabled &&
          (item.role === 'coach' || item.role === 'player') &&
          (item.setupStatus === 'ready' || item.setupStatus === 'not_tracked'),
      ),
    }
  } catch {
    return failure('NETWORK_ERROR')
  }
}
