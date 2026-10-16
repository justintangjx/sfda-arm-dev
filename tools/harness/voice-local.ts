import { lstat, mkdir, readFile, readdir, rm, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atomicJson, hash } from './io.js'
import * as v from './validation.js'
export const validateVoicePricing = (
  value: unknown,
  reference: string,
  now: number,
) => {
  const pricing = v.parse<
    Readonly<{
      schemaVersion: 1
      id: string
      ownerReference: string
      reviewedAt: string
      plan: string
      voiceChargeBasis: string
      modelChargeBasis: string
    }>
  >(
    value,
    v.exact({
      schemaVersion: v.oneOf([1]),
      id: v.string,
      ownerReference: v.string,
      reviewedAt: v.utc,
      plan: v.string,
      voiceChargeBasis: v.string,
      modelChargeBasis: v.string,
    }),
  )
  if (
    pricing.id !== reference ||
    Date.parse(pricing.reviewedAt) > now ||
    now - Date.parse(pricing.reviewedAt) > 7 * 86400_000
  )
    v.invalid()
  return pricing
}

// Private local run records are written only by the trusted harness. They contain no tokens.
export type VoiceLocalRequest = Readonly<{
  schemaVersion: 1
  mode: 'compatibility' | 'application'
  issuerReference: string
  acknowledgementReference: string
  pricingReference: string
  reviewedInputFingerprint: string
  fixtureInstanceId: string
  appOrigin: 'http://127.0.0.1:5173'
  supabaseUrl: 'http://127.0.0.1:54321'
  agentId: string
  configurationFingerprint: string
  connectionAttempts: 1 | 2
  audioAssetPath: string | null
  audioAssetDigest: string | null
  audioRightsReference: string | null
  cases: readonly Readonly<{
    actorId: string
    campaignId: string
    playerId: string
    startRequestId: string
  }>[]
}>
const ref = v.match(/^[A-Za-z0-9._:-]{1,200}$/)
export const validateVoiceLocalRequest = (
  value: unknown,
): VoiceLocalRequest => {
  const request = v.parse<VoiceLocalRequest>(
    value,
    v.exact({
      schemaVersion: v.oneOf([1]),
      mode: v.oneOf(['compatibility', 'application']),
      issuerReference: ref,
      acknowledgementReference: ref,
      pricingReference: ref,
      reviewedInputFingerprint: v.digest,
      fixtureInstanceId: v.uuid,
      appOrigin: v.oneOf(['http://127.0.0.1:5173']),
      supabaseUrl: v.oneOf(['http://127.0.0.1:54321']),
      agentId: v.match(/^[A-Za-z0-9_-]{1,128}$/),
      configurationFingerprint: v.digest,
      connectionAttempts: v.oneOf([1, 2]),
      audioAssetPath: v.nullable(v.relativePath),
      audioAssetDigest: v.nullable(v.digest),
      audioRightsReference: v.nullable(ref),
      cases: v.list(
        v.exact({
          actorId: v.uuid,
          campaignId: v.uuid,
          playerId: v.uuid,
          startRequestId: v.uuid,
        }),
        0,
        10,
      ),
    }),
  )
  if (
    (request.mode === 'application' &&
      (!request.cases.length || request.connectionAttempts !== 1)) ||
    (request.mode === 'compatibility' && request.cases.length !== 0)
  )
    v.invalid()
  if (
    request.mode === 'compatibility' &&
    (!request.audioAssetPath?.startsWith('.local/voice-assets/') ||
      !request.audioAssetDigest ||
      !request.audioRightsReference)
  )
    v.invalid()
  v.unique(request.cases.map((c) => `${c.actorId}:${c.startRequestId}`))
  return request
}
const safePrivateDirectory = async (root: string) => {
  const physical = await realpath(root)
  const parent = join(physical, '.local')
  const directory = join(parent, 'voice-verification')
  for (const path of [parent, directory]) {
    const entry = await lstat(path).catch(() => undefined)
    if (entry?.isSymbolicLink() || (entry && !entry.isDirectory())) v.invalid()
    await mkdir(path, { recursive: true, mode: 0o700 })
    if ((await realpath(path)) !== path) v.invalid()
  }
  return directory
}
export const issueLocalVoiceRun = async (
  input: Readonly<{
    root: string
    runId: string
    request: VoiceLocalRequest
    costAcknowledged: boolean
    inputFingerprint: string
    runtimeFingerprint: string
    corpusFingerprint: string
    configurationFingerprint: string
    now: number
  }>,
) => {
  const request = validateVoiceLocalRequest(input.request)
  if (
    !input.costAcknowledged ||
    request.reviewedInputFingerprint !== input.inputFingerprint ||
    request.configurationFingerprint !== input.configurationFingerprint
  )
    v.invalid()
  v.uuid(input.runId)
  const directory = await safePrivateDirectory(input.root)
  const record = {
    schemaVersion: 1,
    runId: input.runId,
    mode: request.mode,
    issuerReference: request.issuerReference,
    acknowledgementReference: request.acknowledgementReference,
    pricingReference: request.pricingReference,
    issuedAt: new Date(input.now).toISOString(),
    expiresAt: new Date(input.now + 900_000).toISOString(),
    appOrigin: request.appOrigin,
    supabaseUrl: request.supabaseUrl,
    fixtureInstanceId: request.fixtureInstanceId,
    configurationFingerprint: input.configurationFingerprint,
    inputFingerprint: input.inputFingerprint,
    runtimeFingerprint: input.runtimeFingerprint,
    corpusFingerprint: input.corpusFingerprint,
    cases: request.cases,
  }
  await atomicJson(join(directory, `${input.runId}.json`), record)
  return { record, path: join(directory, `${input.runId}.json`) }
}
export const withVoiceProbeLock = async <T>(
  root: string,
  agentId: string,
  run: (checkpointPath: string) => Promise<T>,
) => {
  const directory = await safePrivateDirectory(root)
  const lock = join(directory, 'probe.lock')
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch {
    throw new Error('VOICE_PROBE_BUSY')
  }
  try {
    const checkpoint = join(directory, `checkpoint-${hash(agentId)}.json`)
    const inventory = join(directory, `inventory-${hash(agentId)}.json`)
    const registered = await lstat(inventory).catch(() => undefined)
    if (registered?.isSymbolicLink()) v.invalid()
    const prior = await lstat(checkpoint).catch(() => undefined)
    if (prior?.isSymbolicLink()) v.invalid()
    if (registered && !prior) throw new Error('VOICE_PROBE_CHECKPOINT_MISSING')
    if (prior) {
      const value = v.record(JSON.parse(await readFile(checkpoint, 'utf8')))
      if (value.closed !== true) throw new Error('VOICE_PROBE_UNCERTAIN')
    }
    if (!registered)
      await atomicJson(inventory, {
        schemaVersion: 1,
        agentDigest: hash(agentId),
      })
    // Commit dispatch intent before any external effect. Uncertainty survives crashes.
    await atomicJson(checkpoint, {
      schemaVersion: 1,
      agentDigest: hash(agentId),
      closed: false,
      dispatchAt: new Date().toISOString(),
      conversationId: null,
      outcome: 'DISPATCH_INTENT',
    })
    return await run(checkpoint)
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}
export const pruneLocalVoiceRuns = async (root: string, now: number) => {
  const directory = await safePrivateDirectory(root)
  for (const name of await readdir(directory)) {
    if (!/^(checkpoint-[a-f0-9]{64}|[a-f0-9-]{36})\.json$/.test(name)) continue
    const path = resolve(directory, name)
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile()) v.invalid()
    const value = v.record(JSON.parse(await readFile(path, 'utf8')))
    const time = name.startsWith('checkpoint-')
      ? value.closed === true
        ? value.closedAt
        : undefined
      : value.expiresAt
    if (typeof time === 'string' && Date.parse(time) <= now - 30 * 86400_000) {
      await rm(path)
      if (name.startsWith('checkpoint-'))
        await rm(join(directory, name.replace('checkpoint-', 'inventory-')), {
          force: true,
        })
    }
  }
}
