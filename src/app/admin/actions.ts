import { useCallback, useEffect, useRef, useState } from 'react'
import { record } from '../../domain/accounts'
import type { MutationResponse } from '../data/mutations'
import { useRuntime } from '../coach/runtime'

const messages: Readonly<Record<string, string>> = {
  EMAIL_EXISTS:
    'This account already exists. You can find it in the account directory.',
  SETUP_EXISTS:
    'An account setup operation already reserves this email. You can resume that operation.',
  OPERATION_BUSY:
    'An account operation is running. You can refresh its progress shortly.',
  VERSION_CONFLICT:
    'This record changed. Your input is kept. Reload current values before trying again.',
  RECONCILIATION_REQUIRED:
    'This needs reconciliation. You can refresh its progress and resume it explicitly.',
  OUTCOME_UNKNOWN:
    'The outcome is unknown. Check current progress before beginning another action.',
  PROVIDER_UNAVAILABLE:
    'The account service is unavailable. You can inspect progress and try later.',
  FORBIDDEN: 'This action is no longer available to your account.',
  AUTH_REQUIRED: 'Your session ended. You can sign in again.',
  ACCOUNT_DISABLED: 'This account is disabled.',
  ACCOUNT_NOT_READY:
    'This account has not finished password setup, so a recovery link is unavailable.',
  ACCOUNT_SETUP_PENDING:
    'Account setup is not finished. Complete it through Resume first.',
  EMAIL_COOLDOWN:
    'A password email was requested in the last 60 seconds. You can try again shortly.',
  RATE_LIMITED: 'Too many requests. You can try again in a minute.',
  PAIR_CONFLICT:
    'This coach and player already belong to another campaign for this competition.',
  STAGE_LOCKED:
    'The current campaign stage does not allow this membership change.',
  STAGE_CLOSED: 'This campaign is closed.',
  NAME_CONFLICT: 'That name is already in use.',
  INVALID_INPUT: 'Check the highlighted values and try again.',
  NOT_FOUND: 'This record is unavailable.',
}
export const friendly = (code: unknown) =>
  typeof code === 'string'
    ? (messages[code] ??
      'The action could not be completed. You can refresh and check current records.')
    : 'The action could not be confirmed. You can check current progress.'
export const field = (form: FormData, name: string) =>
  String(form.get(name) ?? '').trim()

export type WorkerReply = Readonly<{
  ok: boolean
  status: number
  body: Readonly<Record<string, unknown>>
}>
export const useAdmin = () => {
  const runtime = useRuntime()
  if (!runtime.dataClient || runtime.access?.role !== 'admin')
    throw new Error('Admin access missing')
  return { ...runtime, client: runtime.dataClient, access: runtime.access }
}
// Returns a stable check, so callers can depend on it without reading a ref during render.
export const useAlive = () => {
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return useCallback(() => alive.current, [])
}
export const useWorkerApi = () => {
  const { client } = useAdmin()
  return useCallback(
    async (path: string, body: unknown = undefined): Promise<WorkerReply> => {
      const current = await client.auth.getSession()
      if (!current.data.session)
        return { ok: false, status: 401, body: { code: 'AUTH_REQUIRED' } }
      try {
        const result = await fetch(path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${current.data.session.access_token}`,
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: 'no-store',
        })
        const data: unknown = await result.json()
        return {
          ok: result.ok,
          status: result.status,
          body: record(data) ?? { code: 'PROVIDER_UNAVAILABLE' },
        }
      } catch {
        return { ok: false, status: 0, body: { code: 'OUTCOME_UNKNOWN' } }
      }
    },
    [client],
  )
}

// A frozen request: its UUID and payload are fixed once, so a check never sends a second effect.
export type Outcome =
  | Readonly<{ ok: true; notice: string; warning?: string }>
  | Readonly<{ ok: false; code: string; unknown: boolean }>
export type Attempt = Readonly<{
  requestId: string
  label: string
  send: () => Promise<Outcome>
}>
export const workerOutcome = (reply: WorkerReply, notice: string): Outcome => {
  const code = typeof reply.body.code === 'string' ? reply.body.code : undefined
  if (reply.ok)
    return reply.status === 202 && code
      ? { ok: true, notice, warning: code }
      : { ok: true, notice }
  return {
    ok: false,
    code: code ?? 'PROVIDER_UNAVAILABLE',
    unknown: reply.status === 0 || reply.status >= 500,
  }
}
export const rpcOutcome = (
  result: MutationResponse,
  notice: string,
): Outcome =>
  result.ok
    ? { ok: true, notice }
    : {
        ok: false,
        code: result.code,
        unknown: [
          'NETWORK_ERROR',
          'INVALID_RESPONSE',
          'DATABASE_ERROR',
        ].includes(result.code),
      }

export const useAdminAction = (refresh: () => Promise<void>) => {
  const { client, access } = useAdmin()
  const alive = useAlive()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [code, setCode] = useState<string | undefined>(undefined)
  const [unknown, setUnknown] = useState<Attempt | undefined>(undefined)
  const run = async (attempt: Attempt) => {
    if (busy || unknown) return false
    setBusy(true)
    setError('')
    setNotice('')
    setCode(undefined)
    const outcome = await attempt.send()
    if (!alive()) return false
    setBusy(false)
    if (outcome.ok) {
      setNotice(outcome.notice)
      if (outcome.warning) {
        setCode(outcome.warning)
        setError(friendly(outcome.warning))
      }
      await refresh()
      return true
    }
    setCode(outcome.code)
    setError(friendly(outcome.code))
    if (outcome.unknown) setUnknown(attempt)
    return false
  }
  const check = async () => {
    if (!unknown) return
    setBusy(true)
    const result = await client
      .from('mutation_receipts')
      .select('result_id')
      .eq('actor_id', access.id)
      .eq('mutation_id', unknown.requestId)
      .maybeSingle()
    if (!alive()) return
    setBusy(false)
    if (result.data) {
      setUnknown(undefined)
      setError('')
      setCode(undefined)
      setNotice(
        `${unknown.label} committed. Reference ${result.data.result_id}`,
      )
      await refresh()
    } else
      setError(
        'No committed receipt is visible yet. This does not prove rollback. You can check again, or discard this request and refresh before starting another.',
      )
  }
  const discard = () => {
    setUnknown(undefined)
    setError('')
    setCode(undefined)
  }
  return {
    busy,
    locked: busy || Boolean(unknown),
    error,
    notice,
    code,
    unknown,
    run,
    check,
    discard,
  }
}
export type AdminAction = ReturnType<typeof useAdminAction>

export const useDirtyForm = () => {
  const { setFormDirty } = useRuntime()
  useEffect(() => () => setFormDirty(false), [setFormDirty])
  return {
    onInput: () => setFormDirty(true),
    clean: () => setFormDirty(false),
  }
}
