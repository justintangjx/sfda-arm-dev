import { isObject } from './feedback.js'

export type DemoVoiceActivationRecord = Readonly<{
  schemaVersion: 1
  activationId: string
  approvedOrigin: string
  approvedReleaseId: string
  voiceConfigFingerprint: string
  expiresAt: string
  approvedAt: string
  approverReference: string
  maxDemoCoaches: number
  syntheticRosterNote: string
  elevenLabsPlanReference: string
}>

const reference = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value)
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const fingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    value,
  )
const instant = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  new Date(value).toISOString() === value
const httpsOrigin = (value: unknown): value is string =>
  typeof value === 'string' && /^https:\/\/[a-zA-Z0-9.-]+$/.test(value)
const projectRef = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]{20}$/.test(value)

export type HostingProductionTarget = Readonly<{
  schemaVersion: 1
  workerName: string
  appOrigin: string
  supabaseProjectRef: string
  accountRequestLimiterNamespace: string
  accountProjectLimiterNamespace: string
  voiceRequestLimiterNamespace?: string
  voiceProjectLimiterNamespace?: string
  smtpProvider?: Readonly<{
    name: string
    senderDomain: string
    hourlyQuota: number
  }>
  migrationReaderRole?: string
  recordedAt: string
  recordedBy: string
}>

export const readDemoVoiceActivation = (
  value: unknown,
): DemoVoiceActivationRecord | undefined => {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    value.status === 'inactive' ||
    !uuid(value.activationId) ||
    !httpsOrigin(value.approvedOrigin) ||
    !sha(value.approvedReleaseId) ||
    !fingerprint(value.voiceConfigFingerprint) ||
    !instant(value.expiresAt) ||
    !instant(value.approvedAt) ||
    !reference(value.approverReference) ||
    typeof value.maxDemoCoaches !== 'number' ||
    !Number.isInteger(value.maxDemoCoaches) ||
    value.maxDemoCoaches < 1 ||
    value.maxDemoCoaches > 1000 ||
    typeof value.syntheticRosterNote !== 'string' ||
    !value.syntheticRosterNote.trim() ||
    !reference(value.elevenLabsPlanReference) ||
    Date.parse(value.expiresAt) <= Date.parse(value.approvedAt)
  )
    return undefined
  const maxDays = 30 * 86_400_000
  if (Date.parse(value.expiresAt) - Date.parse(value.approvedAt) > maxDays)
    return undefined
  return value as DemoVoiceActivationRecord
}

export const demoActivationMatchesProduction = (
  record: DemoVoiceActivationRecord,
  input: Readonly<{
    appOrigin: string
    releaseId: string
    configurationFingerprint: string
    evidenceId: string
    now: number
  }>,
): boolean =>
  record.activationId === input.evidenceId &&
  record.approvedOrigin === input.appOrigin &&
  record.approvedReleaseId === input.releaseId &&
  record.voiceConfigFingerprint === input.configurationFingerprint &&
  Date.parse(record.expiresAt) > input.now

export const readHostingProductionTarget = (
  value: unknown,
): HostingProductionTarget | undefined => {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    typeof value.workerName !== 'string' ||
    !/^[a-z0-9-]{1,64}$/.test(value.workerName) ||
    !httpsOrigin(value.appOrigin) ||
    !projectRef(value.supabaseProjectRef) ||
    typeof value.accountRequestLimiterNamespace !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.accountRequestLimiterNamespace) ||
    typeof value.accountProjectLimiterNamespace !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.accountProjectLimiterNamespace) ||
    !instant(value.recordedAt) ||
    typeof value.recordedBy !== 'string' ||
    !value.recordedBy.trim() ||
    value.recordedBy.length > 200
  )
    return undefined
  const voiceRequest = value.voiceRequestLimiterNamespace
  const voiceProject = value.voiceProjectLimiterNamespace
  if (
    (voiceRequest === undefined) !== (voiceProject === undefined) ||
    (voiceRequest !== undefined &&
      (typeof voiceRequest !== 'string' ||
        !/^[a-f0-9]{32}$/.test(voiceRequest) ||
        typeof voiceProject !== 'string' ||
        !/^[a-f0-9]{32}$/.test(voiceProject)))
  )
    return undefined
  if (value.smtpProvider !== undefined) {
    if (
      !isObject(value.smtpProvider) ||
      typeof value.smtpProvider.name !== 'string' ||
      !value.smtpProvider.name.trim() ||
      typeof value.smtpProvider.senderDomain !== 'string' ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.smtpProvider.senderDomain) ||
      typeof value.smtpProvider.hourlyQuota !== 'number' ||
      !Number.isInteger(value.smtpProvider.hourlyQuota) ||
      value.smtpProvider.hourlyQuota < 1
    )
      return undefined
  }
  if (
    value.migrationReaderRole !== undefined &&
    (typeof value.migrationReaderRole !== 'string' ||
      !reference(value.migrationReaderRole))
  )
    return undefined
  return value as HostingProductionTarget
}
