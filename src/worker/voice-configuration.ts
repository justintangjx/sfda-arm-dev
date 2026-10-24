import manifestValue from '../../verification/voice-config.json'
import demoActivationValue from '../../verification/demo-voice-activation.json'
import {
  demoActivationMatchesProduction,
  readDemoVoiceActivation,
} from '../domain/pilot-release'
import { isObject, isUuid } from '../domain/feedback'
import type { PublicConfiguration } from '../domain/configuration'
import { sha256 } from './account-http'

export interface VoiceBindings {
  SUPABASE_ADMIN_KEY?: unknown
  ELEVENLABS_API_KEY?: unknown
  ELEVENLABS_AGENT_ID?: unknown
  ELEVENLABS_AGENT_VERSION_ID?: unknown
  VOICE_CONFIG_FINGERPRINT?: unknown
  VOICE_ACTIVATION_EVIDENCE_ID?: unknown
  VOICE_LOCAL_RUN_RECORD?: unknown
  VOICE_REQUEST_LIMITER?: unknown
  VOICE_PROJECT_LIMITER?: unknown
}
export type VoiceManifest = Readonly<{
  schemaVersion: 1
  agentId: string
  agentVersionId: string
  credentialRule: 'hold_only' | 'terminal_consumes'
  captureRule: 'mute_stops_capture'
  dispatchToIssuanceSeconds: number
  redemptionSeconds: number
  limits: Readonly<{
    callCapSeconds: 300
    finishSeconds: 20
    coachDaily: 20
    sfdaDaily: 100
  }>
  providerConfiguration: Readonly<Record<string, unknown>>
  toolConfigurations: Readonly<Record<string, unknown>>
  noticeVersion: string
  compatibilityEvidenceId: string
  compatibilityUntil: string
  pricingReference: string
  runtimeOverridesEvidenceId: string
}>
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const reference = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value)
const bound = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= 3600

export const readVoiceManifest = (
  value: unknown,
): VoiceManifest | undefined => {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !id(value.agentId) ||
    !id(value.agentVersionId) ||
    !['hold_only', 'terminal_consumes'].includes(
      String(value.credentialRule),
    ) ||
    value.captureRule !== 'mute_stops_capture' ||
    !bound(value.dispatchToIssuanceSeconds) ||
    !bound(value.redemptionSeconds) ||
    !isObject(value.limits) ||
    value.limits.callCapSeconds !== 300 ||
    value.limits.finishSeconds !== 20 ||
    value.limits.coachDaily !== 20 ||
    value.limits.sfdaDaily !== 100 ||
    !isObject(value.providerConfiguration) ||
    !isObject(value.toolConfigurations) ||
    Object.keys(value.toolConfigurations).length !== 1 ||
    !reference(value.noticeVersion) ||
    !reference(value.compatibilityEvidenceId) ||
    typeof value.compatibilityUntil !== 'string' ||
    !reference(value.pricingReference) ||
    !reference(value.runtimeOverridesEvidenceId) ||
    !Number.isFinite(Date.parse(value.compatibilityUntil))
  )
    return undefined
  return value as VoiceManifest
}
// Sorted JSON is the reviewed configuration identity. Secrets are never included.
export const canonicalVoiceJson = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(canonicalVoiceJson).join(',')}]`
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalVoiceJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export const voiceManifestFingerprint = (manifest: VoiceManifest) =>
  sha256(new TextEncoder().encode(canonicalVoiceJson(manifest)))
export const databaseVoiceConfig = (
  manifest: VoiceManifest,
  fingerprint: string,
) => ({
  fingerprint,
  agentId: manifest.agentId,
  agentVersionId: manifest.agentVersionId,
  credentialRule: manifest.credentialRule,
  captureRule: manifest.captureRule,
  dispatchToIssuanceSeconds: manifest.dispatchToIssuanceSeconds,
  redemptionSeconds: manifest.redemptionSeconds,
  limits: manifest.limits,
})
export type VoiceStartTarget = Readonly<{
  actorId: string
  campaignId: string
  playerId: string
  startRequestId: string
}>
export type LocalVoiceRun = Readonly<{
  schemaVersion: 1
  runId: string
  mode: 'application' | 'compatibility'
  issuerReference: string
  acknowledgementReference: string
  pricingReference: string
  issuedAt: string
  expiresAt: string
  appOrigin: string
  supabaseUrl: string
  fixtureInstanceId: string
  configurationFingerprint: string
  runtimeFingerprint: string
  corpusFingerprint: string
  cases: readonly VoiceStartTarget[]
}>
export const readLocalVoiceRun = (
  value: unknown,
  now: number,
): LocalVoiceRun | undefined => {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !isUuid(value.runId) ||
    !['application', 'compatibility'].includes(String(value.mode)) ||
    !reference(value.issuerReference) ||
    !reference(value.acknowledgementReference) ||
    !reference(value.pricingReference) ||
    typeof value.issuedAt !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    Date.parse(value.issuedAt) > now ||
    Date.parse(value.expiresAt) <= now ||
    !(Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 0) ||
    Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 900_000 ||
    value.appOrigin !== 'http://127.0.0.1:5173' ||
    value.supabaseUrl !== 'http://127.0.0.1:54321' ||
    !isUuid(value.fixtureInstanceId) ||
    ![
      value.configurationFingerprint,
      value.runtimeFingerprint,
      value.corpusFingerprint,
    ].every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) ||
    !Array.isArray(value.cases) ||
    value.cases.length > 10 ||
    !value.cases.every(
      (v) =>
        isObject(v) &&
        [v.actorId, v.campaignId, v.playerId, v.startRequestId].every(isUuid) &&
        Object.keys(v).length === 4,
    )
  )
    return undefined
  return value as LocalVoiceRun
}
export type VoiceAuthorisationGate = Readonly<{
  manifest: VoiceManifest
  fingerprint: string
  authorisation: Readonly<{
    kind: 'local_verification' | 'production_activation'
    evidenceId: string
    until: string
    localRun?: Readonly<{ cases: readonly VoiceStartTarget[] }>
  }>
  apiKey: string
  run?: LocalVoiceRun
}>

export const voiceAuthorisation = async (
  config: PublicConfiguration,
  env: VoiceBindings,
  target: VoiceStartTarget,
  now = Date.now(),
  manifestInput: unknown = manifestValue,
  demoActivationInput: unknown = demoActivationValue,
): Promise<VoiceAuthorisationGate | undefined> => {
  if (!config.voiceEnabled || config.appEnv === 'preview') return undefined
  const manifest = readVoiceManifest(manifestInput)
  if (
    !manifest ||
    Date.parse(manifest.compatibilityUntil) <= now ||
    env.ELEVENLABS_AGENT_ID !== manifest.agentId ||
    env.ELEVENLABS_AGENT_VERSION_ID !== manifest.agentVersionId ||
    typeof env.ELEVENLABS_API_KEY !== 'string' ||
    !env.ELEVENLABS_API_KEY.trim()
  )
    return undefined
  const fingerprint = await voiceManifestFingerprint(manifest)
  if (fingerprint !== env.VOICE_CONFIG_FINGERPRINT) return undefined
  if (config.appEnv === 'production') {
    const record = readDemoVoiceActivation(demoActivationInput)
    const evidenceId =
      typeof env.VOICE_ACTIVATION_EVIDENCE_ID === 'string'
        ? env.VOICE_ACTIVATION_EVIDENCE_ID.trim()
        : ''
    if (
      !record ||
      !isUuid(evidenceId) ||
      !demoActivationMatchesProduction(record, {
        appOrigin: config.appOrigin,
        releaseId: config.releaseId,
        configurationFingerprint: fingerprint,
        evidenceId,
        now,
      })
    )
      return undefined
    return {
      manifest,
      fingerprint,
      authorisation: {
        kind: 'production_activation',
        evidenceId: record.activationId,
        until: record.expiresAt,
      },
      apiKey: env.ELEVENLABS_API_KEY,
    }
  }
  if (config.appEnv !== 'local') return undefined
  let input: unknown
  try {
    input =
      typeof env.VOICE_LOCAL_RUN_RECORD === 'string'
        ? JSON.parse(env.VOICE_LOCAL_RUN_RECORD)
        : undefined
  } catch {
    return undefined
  }
  const run = readLocalVoiceRun(input, now)
  if (
    !run ||
    run.mode !== 'application' ||
    run.configurationFingerprint !== fingerprint ||
    run.appOrigin !== config.appOrigin ||
    run.supabaseUrl !== config.supabaseUrl ||
    !run.cases.some((c) =>
      Object.entries(target).every(
        ([key, value]) => c[key as keyof VoiceStartTarget] === value,
      ),
    )
  )
    return undefined
  return {
    manifest,
    fingerprint,
    run,
    authorisation: {
      kind: 'local_verification',
      evidenceId: run.runId,
      until: run.expiresAt,
      localRun: { cases: run.cases },
    },
    apiKey: env.ELEVENLABS_API_KEY,
  }
}
