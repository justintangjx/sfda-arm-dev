import {
  isPositiveInteger,
  isRecoveryReason,
  isUuid,
  normalizeEmail,
  passwordLinkUrl,
  readRecoveryProgress,
  record,
} from '../domain/accounts.js'
import {
  authorize,
  client,
  currentAdmin,
  digestEmail,
  exactKeys,
  failure,
  invoke,
  newCapability,
  pageResponse,
  readPage,
  response,
  sha256,
  type AccountRuntime,
  type Client,
} from './account-http.js'

type Driver = Readonly<{
  operationId: string
  targetId: string
  revision: number
  emailFingerprint: string
  claimId: string
  version: number
}>
type SendOutcome =
  | 'accepted'
  | 'rejected'
  | 'unavailable'
  | 'identity_changed'
  | 'unknown'
  | 'superseded'
const readDriver = (value: unknown): Driver | undefined => {
  const item = record(value)
  return item &&
    isUuid(item.operationId) &&
    isUuid(item.targetId) &&
    isPositiveInteger(item.revision) &&
    typeof item.emailFingerprint === 'string' &&
    isUuid(item.claimId) &&
    isPositiveInteger(item.version)
    ? (item as Driver)
    : undefined
}

// One explicit send per operation: digest durable first, identity rechecked, one provider call, one observation.
const sendRecoveryLink = async (
  runtime: AccountRuntime,
  service: Client,
  driver: Driver,
  actorId: string | undefined,
): Promise<SendOutcome> => {
  const capability = newCapability()
  const started = await invoke(service, 'start_recovery_attempt', {
    operation_id: driver.operationId,
    claim_id: driver.claimId,
    expected_version: driver.version,
    capability_digest: await sha256(capability.bytes),
    ...(actorId ? { actor_id: actorId } : {}),
  })
  const attempt = record(started.ok ? started.value : undefined)
  if (!attempt) return 'unavailable'
  if (attempt.started !== true || !isUuid(attempt.attemptId))
    return 'superseded'
  const observe = async (outcome: Exclude<SendOutcome, 'superseded'>) => {
    await invoke(service, 'record_recovery_outcome', {
      operation_id: driver.operationId,
      claim_id: driver.claimId,
      attempt_id: String(attempt.attemptId),
      outcome,
    })
    return outcome
  }
  try {
    const identity = await service.auth.admin.getUserById(driver.targetId)
    const email = normalizeEmail(identity.data.user?.email)
    if (
      identity.error ||
      identity.data.user?.id !== driver.targetId ||
      !identity.data.user.email_confirmed_at ||
      !email ||
      (await digestEmail(email)) !== driver.emailFingerprint
    )
      return observe('identity_changed')
    const redirect = passwordLinkUrl(
      runtime.config.appOrigin,
      'recovery',
      driver.operationId,
      driver.revision,
      capability.encoded,
    )
    const sent = await client(
      runtime.config,
      runtime.config.supabasePublicKey,
    ).auth.resetPasswordForEmail(email, { redirectTo: redirect.href })
    return observe(
      !sent.error
        ? 'accepted'
        : !sent.error.status || sent.error.status >= 500
          ? 'unknown'
          : 'rejected',
    )
  } catch {
    return observe('unknown')
  }
}

const publicDispatch = async (
  runtime: AccountRuntime,
  requestId: string,
  fingerprint: string,
  targetId: string,
) => {
  const service = client(runtime.config, runtime.adminKey)
  const begun = await invoke(service, 'begin_public_recovery', {
    request_id: requestId,
    email_fingerprint: fingerprint,
    target_id: targetId,
  })
  const driver = readDriver(record(begun.ok ? begun.value : undefined)?.driver)
  if (driver) await sendRecoveryLink(runtime, service, driver, undefined)
}

// Every target specific branch ends in this same acknowledgment.
export const requestRecovery = async (
  runtime: AccountRuntime,
  body: Readonly<Record<string, unknown>>,
  requestId: string,
): Promise<Response> => {
  const email = normalizeEmail(body.email)
  if (
    !exactKeys(body, ['requestId', 'email']) ||
    !isUuid(body.requestId) ||
    !email
  )
    return failure('INVALID_INPUT', requestId)
  const fingerprint = await digestEmail(email)
  const found = await invoke(
    client(runtime.config, runtime.adminKey),
    'lookup_recovery_identity',
    { email_fingerprint: fingerprint },
  )
  if (!found.ok) return failure('PROVIDER_UNAVAILABLE', requestId)
  const targetId = record(found.value)?.targetId
  if (isUuid(targetId))
    runtime.defer(
      publicDispatch(
        runtime,
        String(body.requestId),
        fingerprint,
        targetId,
      ).catch(() => undefined),
    )
  return response({ outcome: 'check_email' }, 202)
}

export const requestAdminRecovery = async (
  runtime: AccountRuntime,
  request: Request,
  profileId: string,
  body: Readonly<Record<string, unknown>>,
  requestId: string,
): Promise<Response> => {
  if (
    !exactKeys(body, ['mutationId', 'expectedProfileVersion', 'reason']) ||
    !isUuid(body.mutationId) ||
    !isPositiveInteger(body.expectedProfileVersion) ||
    !isRecoveryReason(body.reason)
  )
    return failure('INVALID_INPUT', requestId)
  const actor = await authorize(request, runtime)
  if (!actor.ok) return failure(actor.code, requestId)
  const begun = await invoke(actor.value.user, 'begin_admin_recovery', {
    mutation_id: body.mutationId,
    profile_id: profileId,
    expected_profile_version: body.expectedProfileVersion,
    reason: body.reason,
  })
  if (!begun.ok) return failure(begun.code, requestId)
  const committed = record(begun.value)
  const operationId = record(committed?.operation)?.id
  if (!isUuid(operationId)) return failure('RECONCILIATION_REQUIRED', requestId)
  let sent: SendOutcome | undefined
  if (committed?.outcome === 'committed') {
    const access = await currentAdmin(actor.value)
    if (!access.ok) return failure(access.code, requestId, { operationId })
    const context = await invoke(
      actor.value.service,
      'get_worker_recovery_context',
      {
        operation_id: operationId,
        actor_id: actor.value.id,
      },
    )
    const driver = readDriver(context.ok ? context.value : undefined)
    sent = driver
      ? await sendRecoveryLink(
          runtime,
          actor.value.service,
          driver,
          actor.value.id,
        )
      : 'unavailable'
  }
  const progress = await invoke(
    actor.value.user,
    'admin_get_recovery_operation',
    {
      operation_id: operationId,
    },
  )
  const operation = readRecoveryProgress(
    progress.ok ? progress.value : undefined,
  )
  if (!operation)
    return failure('PROVIDER_UNAVAILABLE', requestId, { operationId })
  if (sent === undefined)
    return response({ outcome: 'already_committed', operation })
  return sent === 'accepted'
    ? response({ outcome: 'committed', operation }, 201)
    : response(
        {
          outcome: 'committed',
          operation,
          code:
            sent === 'unknown'
              ? 'OUTCOME_UNKNOWN'
              : sent === 'identity_changed'
                ? 'RECONCILIATION_REQUIRED'
                : 'PROVIDER_UNAVAILABLE',
          requestId,
        },
        202,
      )
}

export const lookupAccount = async (
  runtime: AccountRuntime,
  request: Request,
  body: Readonly<Record<string, unknown>>,
  requestId: string,
): Promise<Response> => {
  const email = normalizeEmail(body.email)
  if (!exactKeys(body, ['email']) || !email)
    return failure('INVALID_INPUT', requestId)
  const actor = await authorize(request, runtime)
  if (!actor.ok) return failure(actor.code, requestId)
  const found = await invoke(actor.value.user, 'admin_find_account', {
    email_fingerprint: await digestEmail(email),
  })
  if (!found.ok) return failure(found.code, requestId)
  const profile = record(found.value)?.profile
  return response(
    profile ? { outcome: 'found', profile } : { outcome: 'not_found' },
  )
}

export const accountDetail = async (
  runtime: AccountRuntime,
  request: Request,
  profileId: string,
  requestId: string,
): Promise<Response> => {
  const actor = await authorize(request, runtime)
  if (!actor.ok) return failure(actor.code, requestId)
  const detail = await invoke(actor.value.user, 'admin_get_account', {
    profile_id: profileId,
  })
  if (!detail.ok) return failure(detail.code, requestId)
  let loginEmail: string | null = null
  try {
    const identity = await actor.value.service.auth.admin.getUserById(profileId)
    if (identity.error) return failure('PROVIDER_UNAVAILABLE', requestId)
    loginEmail = identity.data.user.email_confirmed_at
      ? (normalizeEmail(identity.data.user.email) ?? null)
      : null
  } catch {
    return failure('PROVIDER_UNAVAILABLE', requestId)
  }
  // Privileged Auth detail is emitted only after access is rechecked.
  const access = await currentAdmin(actor.value)
  if (!access.ok) return failure(access.code, requestId)
  return response({ ...record(detail.value), loginEmail })
}

export const listRecoveryOperations = async (
  runtime: AccountRuntime,
  request: Request,
  url: URL,
  requestId: string,
): Promise<Response> => {
  const page = readPage(url)
  const target = url.searchParams.get('targetProfileId')
  if (!page.ok || (target !== null && !isUuid(target)))
    return failure('INVALID_INPUT', requestId)
  const actor = await authorize(request, runtime)
  if (!actor.ok) return failure(actor.code, requestId)
  const result = await invoke(
    actor.value.user,
    'admin_list_recovery_operations',
    {
      target_profile_id: target,
      page_size: page.value.pageSize,
      page_cursor: page.value.cursor,
    },
  )
  return result.ok
    ? pageResponse(result.value)
    : failure(result.code, requestId)
}

export const readRecoveryOperation = async (
  runtime: AccountRuntime,
  request: Request,
  operationId: string,
  requestId: string,
): Promise<Response> => {
  const actor = await authorize(request, runtime)
  if (!actor.ok) return failure(actor.code, requestId)
  const result = await invoke(
    actor.value.user,
    'admin_get_recovery_operation',
    {
      operation_id: operationId,
    },
  )
  return result.ok ? response(result.value) : failure(result.code, requestId)
}
