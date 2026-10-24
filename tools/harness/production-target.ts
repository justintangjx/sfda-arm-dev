import type { ProductionTarget } from './migrations.js'
import { targetRule } from './migrations.js'
import * as v from './validation.js'

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

export type ProductionTargetFile = Readonly<
  HostingProductionTarget & {
    migrationReader?: ProductionTarget
  }
>

const reference = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value)
const httpsOrigin = (value: unknown): value is string =>
  typeof value === 'string' && /^https:\/\/[a-zA-Z0-9.-]+$/.test(value)
const projectRef = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]{20}$/.test(value)
const instant = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    v.utc(value)
    return true
  } catch {
    return false
  }
}
const uuid = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    v.uuid(value)
    return true
  } catch {
    return false
  }
}
const sha = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    v.sha(value)
    return true
  } catch {
    return false
  }
}
const digest = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    v.digest(value)
    return true
  } catch {
    return false
  }
}

const readHostingProductionTarget = (
  value: unknown,
): HostingProductionTarget | undefined => {
  const object = v.record(value)
  if (
    object.schemaVersion !== 1 ||
    typeof object.workerName !== 'string' ||
    !/^[a-z0-9-]{1,64}$/.test(object.workerName) ||
    !httpsOrigin(object.appOrigin) ||
    !projectRef(object.supabaseProjectRef) ||
    typeof object.accountRequestLimiterNamespace !== 'string' ||
    !/^[a-f0-9]{32}$/.test(object.accountRequestLimiterNamespace) ||
    typeof object.accountProjectLimiterNamespace !== 'string' ||
    !/^[a-f0-9]{32}$/.test(object.accountProjectLimiterNamespace) ||
    !instant(object.recordedAt) ||
    typeof object.recordedBy !== 'string' ||
    !object.recordedBy.trim() ||
    object.recordedBy.length > 200
  )
    return undefined
  const voiceRequest = object.voiceRequestLimiterNamespace
  const voiceProject = object.voiceProjectLimiterNamespace
  if (
    (voiceRequest === undefined) !== (voiceProject === undefined) ||
    (voiceRequest !== undefined &&
      (typeof voiceRequest !== 'string' ||
        !/^[a-f0-9]{32}$/.test(voiceRequest) ||
        typeof voiceProject !== 'string' ||
        !/^[a-f0-9]{32}$/.test(voiceProject)))
  )
    return undefined
  if (object.smtpProvider !== undefined) {
    const smtp = v.record(object.smtpProvider)
    if (
      typeof smtp.name !== 'string' ||
      !smtp.name.trim() ||
      typeof smtp.senderDomain !== 'string' ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(smtp.senderDomain) ||
      typeof smtp.hourlyQuota !== 'number' ||
      !Number.isInteger(smtp.hourlyQuota) ||
      smtp.hourlyQuota < 1
    )
      return undefined
  }
  if (
    object.migrationReaderRole !== undefined &&
    !reference(object.migrationReaderRole)
  )
    return undefined
  return object as HostingProductionTarget
}

const readDemoVoiceActivation = (
  value: unknown,
): DemoVoiceActivationRecord | undefined => {
  const object = v.record(value)
  if (
    object.schemaVersion !== 1 ||
    object.status === 'inactive' ||
    !uuid(object.activationId) ||
    !httpsOrigin(object.approvedOrigin) ||
    !sha(object.approvedReleaseId) ||
    !digest(object.voiceConfigFingerprint) ||
    !instant(object.expiresAt) ||
    !instant(object.approvedAt) ||
    !reference(object.approverReference) ||
    typeof object.maxDemoCoaches !== 'number' ||
    !Number.isInteger(object.maxDemoCoaches) ||
    object.maxDemoCoaches < 1 ||
    object.maxDemoCoaches > 1000 ||
    typeof object.syntheticRosterNote !== 'string' ||
    !object.syntheticRosterNote.trim() ||
    !reference(object.elevenLabsPlanReference) ||
    Date.parse(String(object.expiresAt)) <=
      Date.parse(String(object.approvedAt))
  )
    return undefined
  const maxDays = 30 * 86_400_000
  if (
    Date.parse(String(object.expiresAt)) -
      Date.parse(String(object.approvedAt)) >
    maxDays
  )
    return undefined
  return object as DemoVoiceActivationRecord
}

export const validateHostingProductionTarget = (
  value: unknown,
): HostingProductionTarget => {
  const manifest = readHostingProductionTarget(value)
  if (!manifest) v.invalid()
  return manifest
}

export const parseProductionTargetFile = (
  value: unknown,
): ProductionTargetFile | undefined => {
  const hosting = readHostingProductionTarget(value)
  if (!hosting) return undefined
  const object = v.record(value)
  let migrationReader: ProductionTarget | undefined
  if (object.migrationReader !== undefined) {
    migrationReader = v.parse<ProductionTarget>(
      object.migrationReader,
      targetRule,
    )
    if (migrationReader.appOrigin !== hosting.appOrigin) v.invalid()
  }
  return { ...hosting, migrationReader }
}

export const parseLegacyMigrationTarget = (
  value: unknown,
): ProductionTarget | undefined => {
  try {
    return v.parse<ProductionTarget>(value, targetRule)
  } catch {
    return undefined
  }
}

export const migrationReaderFromFile = (
  file: ProductionTargetFile,
): ProductionTarget | undefined => file.migrationReader

export const validateDemoVoiceActivationFile = (
  value: unknown,
): DemoVoiceActivationRecord | undefined => readDemoVoiceActivation(value)

export const assertDemoVoiceMatchesTarget = (
  demo: DemoVoiceActivationRecord,
  target: HostingProductionTarget,
  voiceFingerprint: string,
  releaseId: string,
) => {
  if (
    demo.approvedOrigin !== target.appOrigin ||
    demo.approvedReleaseId !== releaseId ||
    demo.voiceConfigFingerprint !== voiceFingerprint
  )
    v.invalid()
}
