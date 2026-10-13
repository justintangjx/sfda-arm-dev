export type AccountRole = 'admin' | 'coach' | 'player'
export type Access = Readonly<{
  id: string
  displayName: string
  role: AccountRole
  enabled: boolean
  version: number
}>
export type AccountOperation = Readonly<{
  id: string
  kind: 'provision' | 'replace_link'
  parentId: string | null
  displayName: string
  role: 'coach' | 'player'
  targetId: string | null
  checkpoint:
    | 'planned'
    | 'auth_confirmed'
    | 'profile_created'
    | 'link_requested'
    | 'ready'
  status: 'active' | 'needs_reconciliation' | 'blocked'
  version: number
  safeError: string | null
  generation: number
  currentLinkOperationId: string | null
  emailAttemptState:
    'not_started' | 'started' | 'accepted' | 'unknown' | 'failed'
  createdAt: string
  updatedAt: string
  passwordSetupAt: string | null
  accessEnabled: boolean | null
}>
export type PasswordLinkKind = 'setup' | 'recovery'
// Setup sequences are 0005 generations; recovery sequences are shared head revisions.
export type PasswordLink = Readonly<{
  kind: PasswordLinkKind
  operationId: string
  sequence: number
  capability: string
  tokenHash: string
  type: 'invite' | 'recovery'
}>
export type RecoveryReason =
  | 'requested_by_account_owner'
  | 'link_missing_or_expired'
  | 'after_access_restoration'
export const recoveryReasons: Readonly<Record<RecoveryReason, string>> = {
  requested_by_account_owner: 'Requested by the account owner',
  link_missing_or_expired: 'Previous link missing or expired',
  after_access_restoration: 'After access restoration',
}
export type SetupStatus =
  | 'ready'
  | 'pending'
  | 'needs_reconciliation'
  | 'not_tracked'
  | 'not_applicable'
export type AccountSummary = Readonly<{
  id: string
  displayName: string
  role: AccountRole
  enabled: boolean
  version: number
  createdAt: string
  setupStatus: SetupStatus
  passwordInitialized: boolean
}>
export type RecoveryStatus =
  | 'reserved'
  | 'started'
  | 'accepted'
  | 'unknown'
  | 'failed'
  | 'password_changed'
export type RecoveryProgress = Readonly<{
  id: string
  targetId: string
  targetName: string
  targetRole: AccountRole
  source: 'self_service' | 'admin'
  requestedBy: string | null
  reason: RecoveryReason | null
  reasonLabel: string | null
  status: RecoveryStatus
  safeError: string | null
  current: boolean
  version: number
  createdAt: string
  updatedAt: string
}>
export type PasswordOutcome =
  | Readonly<{ kind: 'changed'; sessions: 'refresh_revoked' | 'unknown' }>
  | Readonly<{ kind: 'failed'; code: string }>
export const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
export const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
export const normalizeEmail = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const email = value.trim().toLowerCase()
  return email.length <= 254 &&
    !/\p{Cc}/u.test(email) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : undefined
}
export const validPassword = (value: unknown): value is string =>
  typeof value === 'string' &&
  Array.from(value).length >= 12 &&
  new TextEncoder().encode(value).byteLength <= 64 &&
  !/\p{Cc}/u.test(value)
export const readAccess = (value: unknown): Access | undefined => {
  const item = record(value)
  if (
    !item ||
    !isUuid(item.id) ||
    typeof item.displayName !== 'string' ||
    !['admin', 'coach', 'player'].includes(String(item.role)) ||
    typeof item.enabled !== 'boolean' ||
    !isPositiveInteger(item.version)
  )
    return undefined
  return {
    id: item.id,
    displayName: item.displayName,
    role: item.role as AccountRole,
    enabled: item.enabled,
    version: item.version,
  }
}
export const readOperation = (value: unknown): AccountOperation | undefined => {
  const item = record(value)
  if (
    !item ||
    !isUuid(item.id) ||
    !['provision', 'replace_link'].includes(String(item.kind)) ||
    !(item.parentId === null || isUuid(item.parentId)) ||
    typeof item.displayName !== 'string' ||
    !['coach', 'player'].includes(String(item.role)) ||
    !(item.targetId === null || isUuid(item.targetId)) ||
    ![
      'planned',
      'auth_confirmed',
      'profile_created',
      'link_requested',
      'ready',
    ].includes(String(item.checkpoint)) ||
    !['active', 'needs_reconciliation', 'blocked'].includes(
      String(item.status),
    ) ||
    !isPositiveInteger(item.version) ||
    !isPositiveInteger(item.generation) ||
    !(item.safeError === null || typeof item.safeError === 'string') ||
    !(
      item.currentLinkOperationId === null ||
      isUuid(item.currentLinkOperationId)
    ) ||
    !['not_started', 'started', 'accepted', 'unknown', 'failed'].includes(
      String(item.emailAttemptState),
    ) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string' ||
    !(
      item.passwordSetupAt === null || typeof item.passwordSetupAt === 'string'
    ) ||
    !(item.accessEnabled === null || typeof item.accessEnabled === 'boolean')
  )
    return undefined
  return item as AccountOperation
}
// The only place that knows each link kind's page, API path and wire field names.
const linkWire = {
  setup: {
    page: '/auth/setup',
    api: '/api/accounts/setup-password',
    sequence: 'generation',
    capability: 'setupCapability',
    types: ['invite', 'recovery'],
  },
  recovery: {
    page: '/auth/recovery',
    api: '/api/accounts/recovery-password',
    sequence: 'revision',
    capability: 'capability',
    types: ['recovery'],
  },
} as const
export const passwordLinkKinds: readonly PasswordLinkKind[] = [
  'setup',
  'recovery',
]
export const passwordLinkPage = (kind: PasswordLinkKind) => linkWire[kind].page
export const passwordLinkApi = (kind: PasswordLinkKind) => linkWire[kind].api
const readLink = (
  kind: PasswordLinkKind,
  operationId: unknown,
  sequence: unknown,
  capability: unknown,
  tokenHash: unknown,
  type: unknown,
): PasswordLink | undefined => {
  const types: readonly string[] = linkWire[kind].types
  if (
    !isUuid(operationId) ||
    !isPositiveInteger(sequence) ||
    typeof capability !== 'string' ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(capability) ||
    typeof tokenHash !== 'string' ||
    tokenHash.length < 1 ||
    tokenHash.length > 1024 ||
    typeof type !== 'string' ||
    !types.includes(type)
  )
    return undefined
  return {
    kind,
    operationId,
    sequence,
    capability,
    tokenHash,
    type: type as PasswordLink['type'],
  }
}
export const passwordLinkUrl = (
  origin: string,
  kind: PasswordLinkKind,
  operationId: string,
  sequence: number,
  capability: string,
): URL => {
  const url = new URL(linkWire[kind].page, origin)
  url.searchParams.set('operationId', operationId)
  url.searchParams.set(linkWire[kind].sequence, String(sequence))
  url.searchParams.set(linkWire[kind].capability, capability)
  return url
}
export const readPasswordLinkUrl = (url: URL): PasswordLink | undefined => {
  const kind = passwordLinkKinds.find(
    (candidate) => linkWire[candidate].page === url.pathname,
  )
  if (!kind) return undefined
  const sequence = url.searchParams.get(linkWire[kind].sequence)
  return readLink(
    kind,
    url.searchParams.get('operationId'),
    sequence === null || !/^[1-9][0-9]{0,15}$/.test(sequence)
      ? undefined
      : Number(sequence),
    url.searchParams.get(linkWire[kind].capability),
    url.searchParams.get('token_hash'),
    url.searchParams.get('type'),
  )
}
export const passwordLinkBody = (link: PasswordLink, password: string) => ({
  operationId: link.operationId,
  [linkWire[link.kind].sequence]: link.sequence,
  [linkWire[link.kind].capability]: link.capability,
  tokenHash: link.tokenHash,
  type: link.type,
  password,
})
export const readPasswordLinkBody = (
  kind: PasswordLinkKind,
  value: unknown,
): Readonly<{ link: PasswordLink; password: string }> | undefined => {
  const item = record(value)
  const keys = [
    'operationId',
    linkWire[kind].sequence,
    linkWire[kind].capability,
    'tokenHash',
    'type',
    'password',
  ]
  if (
    !item ||
    Object.keys(item).length !== keys.length ||
    !keys.every((key) => key in item) ||
    !validPassword(item.password)
  )
    return undefined
  const link = readLink(
    kind,
    item.operationId,
    item[linkWire[kind].sequence],
    item[linkWire[kind].capability],
    item.tokenHash,
    item.type,
  )
  return link ? { link, password: item.password } : undefined
}
export const isRecoveryReason = (value: unknown): value is RecoveryReason =>
  typeof value === 'string' && value in recoveryReasons
export const readAccountSummary = (
  value: unknown,
): AccountSummary | undefined => {
  const item = record(value)
  const access = readAccess(item)
  if (
    !item ||
    !access ||
    typeof item.createdAt !== 'string' ||
    ![
      'ready',
      'pending',
      'needs_reconciliation',
      'not_tracked',
      'not_applicable',
    ].includes(String(item.setupStatus)) ||
    typeof item.passwordInitialized !== 'boolean'
  )
    return undefined
  return {
    ...access,
    createdAt: item.createdAt,
    setupStatus: item.setupStatus as SetupStatus,
    passwordInitialized: item.passwordInitialized,
  }
}
export const readRecoveryProgress = (
  value: unknown,
): RecoveryProgress | undefined => {
  const item = record(value)
  if (
    !item ||
    !isUuid(item.id) ||
    !isUuid(item.targetId) ||
    typeof item.targetName !== 'string' ||
    !['admin', 'coach', 'player'].includes(String(item.targetRole)) ||
    !['self_service', 'admin'].includes(String(item.source)) ||
    !(item.requestedBy === null || isUuid(item.requestedBy)) ||
    !(item.reason === null || isRecoveryReason(item.reason)) ||
    !(item.reasonLabel === null || typeof item.reasonLabel === 'string') ||
    ![
      'reserved',
      'started',
      'accepted',
      'unknown',
      'failed',
      'password_changed',
    ].includes(String(item.status)) ||
    !(item.safeError === null || typeof item.safeError === 'string') ||
    typeof item.current !== 'boolean' ||
    !isPositiveInteger(item.version) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  )
    return undefined
  return item as RecoveryProgress
}
