import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../../domain/database.ts'
import {
  validateMutationResult,
  type MutationResult,
} from '../../domain/feedback.ts'

export const mutationActions = [
  'create_profile',
  'update_profile_name',
  'set_profile_access',
  'create_competition',
  'update_competition',
  'create_campaign',
  'update_campaign_metadata',
  'set_campaign_coach',
  'set_campaign_player',
  'advance_campaign_stage',
  'save_feedback_draft',
  'discard_feedback_draft',
  'submit_feedback',
  'waive_final_obligation',
  'correct_feedback',
] as const
export type MutationAction = (typeof mutationActions)[number]
type Functions = ApplicationDatabase['public']['Functions']
export type PendingMutation<Action extends MutationAction> = Readonly<{
  action: Action
  inputs: Readonly<Functions[Action]['Args']>
}>
export const prepareMutation = <Action extends MutationAction>(
  action: Action,
  inputs: Omit<Functions[Action]['Args'], 'mutation_id'>,
): PendingMutation<Action> => ({
  action,
  // Copy the complete snapshot once. Every retry uses this same request and ID.
  inputs: structuredClone({
    ...inputs,
    mutation_id: crypto.randomUUID(),
  }) as Functions[Action]['Args'],
})
const errorCodes = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_INPUT',
  'AUTH_USER_MISSING',
  'PROFILE_EXISTS',
  'NAME_CONFLICT',
  'PAIR_CONFLICT',
  'STAGE_LOCKED',
  'STAGE_CLOSED',
  'STAGE_CONFLICT',
  'VERSION_CONFLICT',
  'DRAFT_EXISTS',
  'ALREADY_SUBMITTED',
  'OBLIGATION_WAIVED',
  'ALREADY_WAIVED',
  'OUTSTANDING_FINALS',
  'IDEMPOTENCY_CONFLICT',
  'IMMUTABLE_RECORD',
  'DATABASE_ERROR',
] as const
export type DataErrorCode =
  (typeof errorCodes)[number] | 'NETWORK_ERROR' | 'INVALID_RESPONSE'
export type MutationResponse =
  | Readonly<{ ok: true; value: MutationResult }>
  | Readonly<{ ok: false; code: DataErrorCode; requestId: string }>
const safeCode = (value: string): DataErrorCode =>
  errorCodes.find((code) => code === value) ?? 'DATABASE_ERROR'
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export const executeMutation = async <Action extends MutationAction>(
  client: SupabaseClient<ApplicationDatabase>,
  request: PendingMutation<Action>,
  wait: (milliseconds: number) => Promise<void> = delay,
): Promise<MutationResponse> => {
  const snapshot = structuredClone(request.inputs) as Functions[Action]['Args']
  const requestId = snapshot.mutation_id
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Readonly<{
      data: unknown
      error: Readonly<{ code: string; message: string }> | null
    }>
    try {
      response = await client.rpc(request.action, snapshot)
    } catch (error: unknown) {
      if (error instanceof TypeError && attempt < 2) {
        await wait(attempt === 0 ? 250 : 500)
        continue
      }
      return {
        ok: false,
        code: error instanceof TypeError ? 'NETWORK_ERROR' : 'DATABASE_ERROR',
        requestId,
      }
    }
    const { data, error } = response
    if (!error) {
      const result = validateMutationResult(data)
      if (!result.ok || result.value.mutationId !== requestId)
        return { ok: false, code: 'INVALID_RESPONSE', requestId }
      return { ok: true, value: result.value }
    }
    const networkFailure = error.code === ''
    const transient =
      networkFailure || error.code === '40P01' || error.code === '40001'
    if (transient && attempt < 2) {
      await wait(attempt === 0 ? 250 : 500)
      continue
    }
    return {
      ok: false,
      code: networkFailure ? 'NETWORK_ERROR' : safeCode(error.message),
      requestId,
    }
  }
  return { ok: false, code: 'NETWORK_ERROR', requestId }
}
