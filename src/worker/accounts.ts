import {
  isPositiveInteger,
  isUuid,
  normalizeEmail,
  passwordLinkUrl,
  record,
} from '../domain/accounts.js'
import type { PublicConfiguration } from '../domain/configuration.ts'
import {
  authorize,
  client,
  currentAdmin,
  digestEmail,
  exactKeys,
  fail,
  failure,
  invoke,
  newCapability,
  pageResponse,
  readBody,
  readPage,
  response,
  sha256,
  success,
  type AccountRuntime,
  type Actor,
  type Functions,
  type LiveConfiguration,
  type Result,
} from './account-http.js'
import { completePassword } from './password-links.js'
import {
  accountDetail,
  listRecoveryOperations,
  lookupAccount,
  readRecoveryOperation,
  requestAdminRecovery,
  requestRecovery,
} from './recovery.js'
import {
  openAccounts,
  type AccountBindings,
  type RouteClass,
} from './release.js'

type PrivateOperation = Readonly<{
  id: string
  parentId: string | undefined
  plannedId: string
  emailFingerprint: string
  checkpoint: string
  attemptState: string
  generation: number
  version: number
  claimId: string | undefined
  attemptId: string | undefined
  attemptGeneration: number | undefined
}>
const privateOperation = (value: unknown): PrivateOperation | undefined => {
  const item = record(value)
  if (
    !item ||
    !isUuid(item.id) ||
    !isUuid(item.planned_auth_id) ||
    typeof item.email_fingerprint !== 'string' ||
    typeof item.checkpoint !== 'string' ||
    typeof item.email_attempt_state !== 'string' ||
    !isPositiveInteger(item.setup_generation) ||
    !isPositiveInteger(item.version) ||
    !(item.claim_id === null || isUuid(item.claim_id)) ||
    !(item.parent_id === null || isUuid(item.parent_id)) ||
    !(item.email_attempt_id === null || isUuid(item.email_attempt_id)) ||
    !(
      item.email_attempt_generation === null ||
      isPositiveInteger(item.email_attempt_generation)
    )
  )
    return undefined
  return {
    id: item.id,
    parentId: item.parent_id ?? undefined,
    plannedId: item.planned_auth_id,
    emailFingerprint: item.email_fingerprint,
    checkpoint: item.checkpoint,
    attemptState: item.email_attempt_state,
    generation: item.setup_generation,
    version: item.version,
    claimId: item.claim_id ?? undefined,
    attemptId: item.email_attempt_id ?? undefined,
    attemptGeneration: item.email_attempt_generation ?? undefined,
  }
}
const drive = async (
  actor: Actor,
  operationId: string,
  email: string | undefined,
  config: LiveConfiguration,
): Promise<Result<true>> => {
  let operation: PrivateOperation | undefined
  const load = async (): Promise<Result<true>> => {
    const result = await invoke(actor.service, 'get_worker_account_setup', {
      operation_id: operationId,
      actor_id: actor.id,
    })
    if (!result.ok) return result
    operation = privateOperation(result.value)
    return operation ? success(true) : fail('RECONCILIATION_REQUIRED')
  }
  const renew = async (): Promise<Result<true>> => {
    const access = await currentAdmin(actor)
    if (!access.ok) return access
    if (!operation?.claimId) return fail('OPERATION_BUSY')
    const result = await invoke(actor.service, 'renew_account_setup_claim', {
      operation_id: operation.id,
      actor_id: actor.id,
      claim_id: operation.claimId,
      expected_version: operation.version,
    })
    if (!result.ok) return result
    operation = privateOperation(result.value)
    return operation ? success(true) : fail('RECONCILIATION_REQUIRED')
  }
  const step = async (
    name: string,
    fields: Partial<Functions['record_account_setup_step']['Args']> = {},
  ): Promise<Result<true>> => {
    const fresh = await renew()
    if (!fresh.ok) return fresh
    if (!operation?.claimId) return fail('OPERATION_BUSY')
    const result = await invoke(actor.service, 'record_account_setup_step', {
      operation_id: operation.id,
      actor_id: actor.id,
      claim_id: operation.claimId,
      expected_version: operation.version,
      step: name,
      ...fields,
    })
    if (!result.ok) return result
    operation = privateOperation(result.value)
    return operation ? success(true) : fail('RECONCILIATION_REQUIRED')
  }
  const loaded = await load()
  if (!loaded.ok || !operation) return loaded
  if (operation.checkpoint === 'ready') return success(true)
  const fresh = await renew()
  if (!fresh.ok) return fresh
  const rootId = operation.parentId ?? operation.id
  let authUser = await actor.service.auth.admin.getUserById(operation.plannedId)
  if (
    authUser.error &&
    operation.checkpoint === 'planned' &&
    !operation.parentId &&
    authUser.error.code === 'user_not_found'
  ) {
    if (!email || (await digestEmail(email)) !== operation.emailFingerprint)
      return fail('INVALID_INPUT')
    const creating = await renew()
    if (!creating.ok) return creating
    authUser = await actor.service.auth.admin.createUser({
      id: operation.plannedId,
      email,
      email_confirm: false,
      app_metadata: { sfda_setup_operation_id: rootId },
    })
  }
  if (authUser.error || !authUser.data.user) {
    await step('blocked', { safe_code: 'PROVIDER_UNAVAILABLE' })
    return fail('PROVIDER_UNAVAILABLE')
  }
  const target = authUser.data.user
  const targetEmail = normalizeEmail(target.email)
  if (
    target.id !== operation.plannedId ||
    target.app_metadata.sfda_setup_operation_id !== rootId ||
    !targetEmail ||
    (await digestEmail(targetEmail)) !== operation.emailFingerprint
  ) {
    await step('blocked', { safe_code: 'RECONCILIATION_REQUIRED' })
    return fail('RECONCILIATION_REQUIRED')
  }
  if (operation.checkpoint === 'planned' && !operation.parentId) {
    const recorded = await step('auth_confirmed')
    if (!recorded.ok) return recorded
  }
  if (operation.checkpoint === 'auth_confirmed') {
    const creatingProfile = await renew()
    if (!creatingProfile.ok) return creatingProfile
    const profile = await invoke(actor.user, 'create_account_setup_profile', {
      operation_id: operation.id,
      expected_version: operation.version,
    })
    if (!profile.ok) return profile
    const refreshed = await load()
    if (!refreshed.ok) return refreshed
  }
  if (!operation) return fail('RECONCILIATION_REQUIRED')
  if (operation.attemptState === 'not_started') {
    const sending = await renew()
    if (!sending.ok) return sending
    const verifiedIdentity = await actor.service.auth.admin.getUserById(
      operation.plannedId,
    )
    const verifiedEmail = normalizeEmail(verifiedIdentity.data.user?.email)
    if (
      verifiedIdentity.error ||
      verifiedIdentity.data.user?.app_metadata.sfda_setup_operation_id !==
        rootId ||
      !verifiedEmail ||
      (await digestEmail(verifiedEmail)) !== operation.emailFingerprint
    )
      return fail('RECONCILIATION_REQUIRED')
    const capability = newCapability()
    const started = await step('email_started', {
      capability_digest: await sha256(capability.bytes),
    })
    if (!started.ok) return started
    const dispatching = await renew()
    if (!dispatching.ok) return dispatching
    const redirect = passwordLinkUrl(
      config.appOrigin,
      'setup',
      operation.id,
      operation.generation,
      capability.encoded,
    )
    let accepted = false
    let unknown = false
    try {
      if (verifiedIdentity.data.user?.email_confirmed_at) {
        const result = await client(
          config,
          config.supabasePublicKey,
        ).auth.resetPasswordForEmail(verifiedEmail, {
          redirectTo: redirect.href,
        })
        accepted = !result.error
        unknown = Boolean(
          result.error && (!result.error.status || result.error.status >= 500),
        )
        if (accepted) {
          const observing = await renew()
          if (!observing.ok) return fail('OUTCOME_UNKNOWN')
          const recheck = await actor.service.auth.admin.getUserById(
            operation.plannedId,
          )
          accepted =
            !recheck.error &&
            recheck.data.user?.app_metadata.sfda_setup_operation_id ===
              rootId &&
            normalizeEmail(recheck.data.user?.email) === verifiedEmail
          unknown = !accepted
        }
      } else {
        const result = await actor.service.auth.admin.inviteUserByEmail(
          verifiedEmail,
          { redirectTo: redirect.href },
        )
        accepted = !result.error && result.data.user?.id === operation.plannedId
        unknown = Boolean(
          result.error && (!result.error.status || result.error.status >= 500),
        )
      }
    } catch {
      unknown = true
    }
    const observed = await step(
      accepted ? 'email_accepted' : unknown ? 'email_unknown' : 'email_failed',
      {
        attempt_id: operation.attemptId,
        attempt_generation: operation.attemptGeneration,
      },
    )
    if (!observed.ok) return fail('OUTCOME_UNKNOWN')
    if (!accepted)
      return fail(unknown ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE')
  }
  if (
    operation.attemptState === 'started' ||
    operation.attemptState === 'unknown' ||
    operation.attemptState === 'failed'
  )
    return fail('OUTCOME_UNKNOWN')
  if (operation.attemptState === 'accepted') {
    const completing = await renew()
    if (!completing.ok) return completing
    const completed = await invoke(actor.user, 'complete_account_setup', {
      operation_id: operation.id,
      expected_version: operation.version,
    })
    if (!completed.ok) return completed
  }
  return success(true)
}

type Context = Readonly<{
  runtime: AccountRuntime
  request: Request
  url: URL
  id: string
  body: Readonly<Record<string, unknown>>
  requestId: string
}>
type Route = Readonly<{
  label: string
  method: 'GET' | 'POST'
  path: RegExp
  limit: RouteClass
  handle: (context: Context) => Promise<Response>
}>

// 0005 provisioning, Resume and setup replacement share one intent then drive sequence.
const setupRoute =
  (kind: 'create' | 'resume' | 'replace') =>
  async ({ runtime, request, id, body, requestId }: Context) => {
    const actor = await authorize(request, runtime)
    if (!actor.ok) return failure(actor.code, requestId)
    if (!isUuid(body.mutationId)) return failure('INVALID_INPUT', requestId)
    let intent: Result<unknown>
    let email: string | undefined
    if (kind === 'create') {
      email = normalizeEmail(body.email)
      const name =
        typeof body.displayName === 'string' ? body.displayName.trim() : ''
      if (
        !exactKeys(body, ['mutationId', 'email', 'displayName', 'role']) ||
        !email ||
        Array.from(name).length < 1 ||
        Array.from(name).length > 160 ||
        (body.role !== 'coach' && body.role !== 'player')
      )
        return failure('INVALID_INPUT', requestId)
      const fingerprint = await digestEmail(email)
      intent = await invoke(actor.value.user, 'begin_account_setup', {
        mutation_id: body.mutationId,
        display_name: name,
        role: body.role,
        email_fingerprint: fingerprint,
      })
      if (
        !intent.ok &&
        (intent.code === 'EMAIL_EXISTS' || intent.code === 'SETUP_EXISTS')
      ) {
        const access = await currentAdmin(actor.value)
        if (!access.ok) return failure(access.code, requestId)
        const lookup = await invoke(
          actor.value.service,
          'lookup_setup_auth_identity',
          { email_fingerprint: fingerprint },
        )
        if (!lookup.ok) return failure(lookup.code, requestId)
        const found = record(lookup.value)
        const conflict =
          intent.code === 'SETUP_EXISTS'
            ? {
                kind: 'existing_operation',
                operationId: found?.operationId,
                version: found?.operationVersion,
              }
            : found?.profile
              ? { kind: 'existing_profile', profile: found.profile }
              : { kind: 'auth_identity_unlinked' }
        return failure(intent.code, requestId, { conflict })
      }
    } else if (!isPositiveInteger(body.expectedVersion))
      return failure('INVALID_INPUT', requestId)
    else if (kind === 'resume') {
      if (
        !exactKeys(body, ['mutationId', 'expectedVersion', 'email']) ||
        (body.email !== undefined && !normalizeEmail(body.email))
      )
        return failure('INVALID_INPUT', requestId)
      email = normalizeEmail(body.email)
      intent = await invoke(actor.value.user, 'claim_account_setup', {
        operation_id: id,
        mutation_id: body.mutationId,
        expected_version: body.expectedVersion,
      })
    } else {
      if (!exactKeys(body, ['mutationId', 'expectedVersion']))
        return failure('INVALID_INPUT', requestId)
      intent = await invoke(actor.value.user, 'begin_setup_link_replacement', {
        parent_id: id,
        mutation_id: body.mutationId,
        expected_version: body.expectedVersion,
      })
    }
    if (!intent.ok) return failure(intent.code, requestId)
    const committed = record(intent.value)
    const operationId = record(committed?.operation)?.id
    if (!isUuid(operationId))
      return failure('RECONCILIATION_REQUIRED', requestId)
    let driving: Result<true> = success(true)
    if (committed?.outcome === 'committed') {
      try {
        driving = await drive(actor.value, operationId, email, runtime.config)
      } catch {
        driving = fail('PROVIDER_UNAVAILABLE')
      }
    }
    const progress = await invoke(
      actor.value.user,
      'get_account_setup_progress',
      { operation_id: operationId },
    )
    if (!progress.ok) return failure(progress.code, requestId, { operationId })
    const operation = record(progress.value)
    if (
      !driving.ok &&
      !['OUTCOME_UNKNOWN', 'PROVIDER_UNAVAILABLE', 'EMAIL_COOLDOWN'].includes(
        driving.code,
      )
    )
      return failure(driving.code, requestId, { operationId })
    return response(
      {
        operation: progress.value,
        outcome: committed?.outcome,
        ...(!driving.ok ? { code: driving.code, requestId } : {}),
      },
      operation?.checkpoint === 'ready'
        ? committed?.outcome === 'already_committed' || kind !== 'create'
          ? 200
          : 201
        : 202,
    )
  }

const listSetupOperations = async ({
  runtime,
  request,
  url,
  requestId,
}: Context) => {
  const page = readPage(url)
  if (!page.ok) return failure(page.code, requestId)
  const actor = await authorize(request, runtime)
  if (!actor.ok) return failure(actor.code, requestId)
  const result = await invoke(
    actor.value.user,
    'list_account_setup_operations',
    {
      page_size: page.value.pageSize,
      page_cursor: page.value
        .cursor as Functions['list_account_setup_operations']['Args']['page_cursor'],
    },
  )
  return result.ok
    ? pageResponse(result.value)
    : failure(result.code, requestId)
}
const readSetupOperation = async ({
  runtime,
  request,
  id,
  requestId,
}: Context) => {
  const actor = await authorize(request, runtime)
  if (!actor.ok) return failure(actor.code, requestId)
  const result = await invoke(actor.value.user, 'get_account_setup_progress', {
    operation_id: id,
  })
  return result.ok ? response(result.value) : failure(result.code, requestId)
}

// The only account route list: fixed log label, request class and handler together.
const routes: readonly Route[] = [
  {
    label: 'account_setup_password',
    method: 'POST',
    path: /^\/api\/accounts\/setup-password$/,
    limit: 'proof',
    handle: (c) => completePassword(c.runtime, 'setup', c.body, c.requestId),
  },
  {
    label: 'recovery_password',
    method: 'POST',
    path: /^\/api\/accounts\/recovery-password$/,
    limit: 'proof',
    handle: (c) => completePassword(c.runtime, 'recovery', c.body, c.requestId),
  },
  {
    label: 'recovery_request',
    method: 'POST',
    path: /^\/api\/accounts\/recovery$/,
    limit: 'email',
    handle: (c) => requestRecovery(c.runtime, c.body, c.requestId),
  },
  {
    label: 'account_create',
    method: 'POST',
    path: /^\/api\/admin\/accounts$/,
    limit: 'email',
    handle: setupRoute('create'),
  },
  {
    label: 'account_lookup',
    method: 'POST',
    path: /^\/api\/admin\/accounts\/lookup$/,
    limit: 'write',
    handle: (c) => lookupAccount(c.runtime, c.request, c.body, c.requestId),
  },
  {
    label: 'account_detail',
    method: 'GET',
    path: /^\/api\/admin\/accounts\/([^/]+)$/,
    limit: 'read',
    handle: (c) => accountDetail(c.runtime, c.request, c.id, c.requestId),
  },
  {
    label: 'admin_recovery_request',
    method: 'POST',
    path: /^\/api\/admin\/accounts\/([^/]+)\/recovery$/,
    limit: 'email',
    handle: (c) =>
      requestAdminRecovery(c.runtime, c.request, c.id, c.body, c.requestId),
  },
  {
    label: 'account_operations_list',
    method: 'GET',
    path: /^\/api\/admin\/account-operations$/,
    limit: 'read',
    handle: listSetupOperations,
  },
  {
    label: 'account_operation_read',
    method: 'GET',
    path: /^\/api\/admin\/account-operations\/([^/]+)$/,
    limit: 'read',
    handle: readSetupOperation,
  },
  {
    label: 'account_resume',
    method: 'POST',
    path: /^\/api\/admin\/account-operations\/([^/]+)\/resume$/,
    limit: 'email',
    handle: setupRoute('resume'),
  },
  {
    label: 'account_setup_link',
    method: 'POST',
    path: /^\/api\/admin\/account-operations\/([^/]+)\/setup-link$/,
    limit: 'email',
    handle: setupRoute('replace'),
  },
  {
    label: 'recovery_operations_list',
    method: 'GET',
    path: /^\/api\/admin\/recovery-operations$/,
    limit: 'read',
    handle: (c) =>
      listRecoveryOperations(c.runtime, c.request, c.url, c.requestId),
  },
  {
    label: 'recovery_operation_read',
    method: 'GET',
    path: /^\/api\/admin\/recovery-operations\/([^/]+)$/,
    limit: 'read',
    handle: (c) =>
      readRecoveryOperation(c.runtime, c.request, c.id, c.requestId),
  },
]
const match = (method: string, path: string) =>
  routes
    .map((route) => ({ route, found: route.path.exec(path) }))
    .find(
      ({ route, found }) =>
        found &&
        route.method === method &&
        (found[1] === undefined || isUuid(found[1])),
    )

export const accountRoute = (
  method: string,
  path: string,
): string | undefined => match(method, path)?.route.label

export const handleAccountRequest = async (
  request: Request,
  config: PublicConfiguration,
  bindings: AccountBindings,
  requestId: string,
  defer: AccountRuntime['defer'] = (work) => void work,
): Promise<Response> => {
  const url = new URL(request.url)
  const matched = match(request.method, url.pathname)
  if (!matched) return failure('NOT_FOUND', requestId)
  const runtime = await openAccounts(
    request,
    config,
    bindings,
    matched.route.limit,
    defer,
  )
  if (!runtime.ok) return failure(runtime.code, requestId)
  const input =
    request.method === 'POST'
      ? await readBody(request)
      : success({} as Record<string, unknown>)
  if (!input.ok) return failure(input.code, requestId)
  return matched.route.handle({
    runtime: runtime.value,
    request,
    url,
    id: matched.found?.[1] ?? '',
    body: input.value,
    requestId,
  })
}
