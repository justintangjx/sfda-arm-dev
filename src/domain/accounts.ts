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
export type SetupProof = Readonly<{
  operationId: string
  generation: number
  setupCapability: string
  tokenHash: string
  type: 'invite' | 'recovery'
}>
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
export const readSetupProof = (value: unknown): SetupProof | undefined => {
  const item = record(value)
  if (
    !item ||
    !isUuid(item.operationId) ||
    !isPositiveInteger(item.generation) ||
    typeof item.setupCapability !== 'string' ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(item.setupCapability) ||
    typeof item.tokenHash !== 'string' ||
    item.tokenHash.length < 1 ||
    item.tokenHash.length > 1024 ||
    (item.type !== 'invite' && item.type !== 'recovery')
  )
    return undefined
  return {
    operationId: item.operationId,
    generation: item.generation,
    setupCapability: item.setupCapability,
    tokenHash: item.tokenHash,
    type: item.type,
  }
}
