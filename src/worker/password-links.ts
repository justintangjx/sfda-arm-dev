import {
  isUuid,
  readPasswordLinkBody,
  record,
  type PasswordLink,
  type PasswordLinkKind,
} from '../domain/accounts.js'
import {
  capabilityDigest,
  client,
  failure,
  invoke,
  response,
  type AccountRuntime,
  type Client,
  type Result,
} from './account-http.js'

// How each kind checks, records and revokes. The completion sequence below is shared.
const journals = {
  setup: {
    context: (service: Client, link: PasswordLink, digest: string) =>
      invoke(service, 'get_password_setup_context', {
        operation_id: link.operationId,
        generation: link.sequence,
        capability_digest: digest,
      }),
    changed: (
      service: Client,
      link: PasswordLink,
      digest: string,
      target: string,
    ) =>
      invoke(service, 'record_password_setup_result', {
        operation_id: link.operationId,
        generation: link.sequence,
        capability_digest: digest,
        target_id: target,
      }),
    revoked: (
      service: Client,
      link: PasswordLink,
      digest: string,
      target: string,
    ) =>
      invoke(service, 'record_setup_sessions_revoked', {
        operation_id: link.operationId,
        capability_digest: digest,
        target_id: target,
      }),
  },
  recovery: {
    context: (service: Client, link: PasswordLink, digest: string) =>
      invoke(service, 'get_recovery_password_context', {
        operation_id: link.operationId,
        revision: link.sequence,
        capability_digest: digest,
      }),
    changed: (
      service: Client,
      link: PasswordLink,
      digest: string,
      target: string,
    ) =>
      invoke(service, 'record_recovery_password_result', {
        operation_id: link.operationId,
        revision: link.sequence,
        capability_digest: digest,
        target_id: target,
        result: 'password_changed',
      }),
    revoked: (
      service: Client,
      link: PasswordLink,
      digest: string,
      target: string,
    ) =>
      invoke(service, 'record_recovery_password_result', {
        operation_id: link.operationId,
        revision: link.sequence,
        capability_digest: digest,
        target_id: target,
        result: 'refresh_revoked',
      }),
  },
} as const

type Stage =
  | Readonly<{ stage: 'rejected'; code: string }>
  | Readonly<{ stage: 'updating' }>
  | Readonly<{ stage: 'changed'; recorded: boolean }>
const target = (value: Result<unknown>): string | undefined =>
  value.ok && isUuid(record(value.value)?.targetId)
    ? String(record(value.value)?.targetId)
    : undefined

export const completePassword = async (
  runtime: AccountRuntime,
  kind: PasswordLinkKind,
  body: Readonly<Record<string, unknown>>,
  requestId: string,
): Promise<Response> => {
  const input = readPasswordLinkBody(kind, body)
  if (!input) return failure('INVALID_INPUT', requestId)
  const { link, password } = input
  const journal = journals[kind]
  const service = client(runtime.config, runtime.adminKey)
  const digest = await capabilityDigest(link.capability)
  // The application capability is checked before any provider proof is consumed.
  const context = await journal.context(service, link, digest)
  if (!context.ok) return failure(context.code, requestId)
  const targetId = target(context)
  if (!targetId) return failure('LINK_INVALID', requestId)
  const temporary = client(runtime.config, runtime.config.supabasePublicKey)
  let state: Stage = { stage: 'rejected', code: 'LINK_INVALID' }
  try {
    const verified = await temporary.auth.verifyOtp({
      token_hash: link.tokenHash,
      type: link.type,
    })
    if (
      !verified.error &&
      verified.data.user?.id === targetId &&
      verified.data.session
    ) {
      const current = await journal.context(service, link, digest)
      if (!current.ok) state = { stage: 'rejected', code: current.code }
      else if (target(current) === targetId) {
        state = { stage: 'updating' }
        const updated = await temporary.auth.updateUser({ password })
        if (!updated.error && updated.data.user?.id === targetId)
          state = {
            stage: 'changed',
            recorded: (await journal.changed(service, link, digest, targetId))
              .ok,
          }
      }
    }
  } catch {
    /* The stage reached so far decides what can be claimed. */
  }
  // Global signout follows any update attempt, even when bookkeeping failed.
  let revoked = false
  try {
    if (state.stage === 'rejected')
      await temporary.auth.signOut({ scope: 'local' })
    else revoked = !(await temporary.auth.signOut({ scope: 'global' })).error
  } catch {
    /* Temporary session state is discarded with this client regardless. */
  }
  if (state.stage === 'rejected') return failure(state.code, requestId)
  if (state.stage === 'updating') return failure('OUTCOME_UNKNOWN', requestId)
  const sessions =
    revoked &&
    state.recorded &&
    (await journal.revoked(service, link, digest, targetId)).ok
      ? 'refresh_revoked'
      : 'unknown'
  if (kind === 'setup')
    return state.recorded
      ? response({ outcome: 'password_set', sessions })
      : failure('OUTCOME_UNKNOWN', requestId)
  return response({ outcome: 'password_changed', sessions })
}
