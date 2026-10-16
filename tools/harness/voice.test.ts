import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hash, atomicJson } from './io.js'
import {
  issueLocalVoiceRun,
  withVoiceProbeLock,
  validateVoiceLocalRequest,
  validateVoicePricing,
} from './voice-local.js'
import { validateCorpus, validateSpeechCorpus } from './eval.js'
import { parseOptions } from './cli.js'

const request = () => ({
  schemaVersion: 1 as const,
  mode: 'application' as const,
  issuerReference: 'maintainer-request',
  acknowledgementReference: 'explicit-cost-record',
  pricingReference: 'owner-pricing-record',
  reviewedInputFingerprint: hash('reviewed code'),
  configurationFingerprint: hash('reviewed configuration'),
  fixtureInstanceId: randomUUID(),
  appOrigin: 'http://127.0.0.1:5173' as const,
  supabaseUrl: 'http://127.0.0.1:54321' as const,
  agentId: 'agent_synthetic',
  connectionAttempts: 1 as const,
  audioAssetPath: null,
  audioAssetDigest: null,
  audioRightsReference: null,
  cases: [
    {
      actorId: randomUUID(),
      campaignId: randomUUID(),
      playerId: randomUUID(),
      startRequestId: randomUUID(),
    },
  ],
})
describe('trusted local voice bootstrap', () => {
  it('requires current owner pricing for the exact acknowledged record', () => {
    const now = Date.now()
    const pricing = {
      schemaVersion: 1,
      id: 'price-reference',
      ownerReference: 'owner-approval',
      reviewedAt: new Date(now).toISOString(),
      plan: 'Synthetic plan',
      voiceChargeBasis: 'Synthetic voice charge basis',
      modelChargeBasis: 'Synthetic model charge basis',
    }
    expect(validateVoicePricing(pricing, 'price-reference', now)).toEqual(
      pricing,
    )
    expect(() =>
      validateVoicePricing(pricing, 'different-record', now),
    ).toThrow()
    expect(() =>
      validateVoicePricing(pricing, 'price-reference', now + 8 * 86400_000),
    ).toThrow()
  })
  it('rejects browser acknowledgement, changed inputs and a production target', async () => {
    expect(() => validateVoiceLocalRequest({ acknowledged: true })).toThrow()
    expect(() =>
      validateVoiceLocalRequest({
        ...request(),
        appOrigin: 'https://production.invalid',
      }),
    ).toThrow()
    expect(() =>
      parseOptions([
        '--mode',
        'check',
        '--voice-request',
        '.local/voice-verification/request.json',
      ]),
    ).toThrow()
    const root = await mkdtemp(join(tmpdir(), 'voice-issuer-'))
    try {
      const input = {
        root,
        request: request(),
        runId: randomUUID(),
        costAcknowledged: false,
        inputFingerprint: hash('reviewed code'),
        configurationFingerprint: hash('reviewed configuration'),
        runtimeFingerprint: hash('runtime'),
        corpusFingerprint: hash('corpus'),
        now: Date.now(),
      }
      await expect(issueLocalVoiceRun(input)).rejects.toThrow()
      await expect(
        issueLocalVoiceRun({
          ...input,
          costAcknowledged: true,
          inputFingerprint: hash('changed code'),
        }),
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('writes a bounded private application record without credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-issuer-'))
    try {
      const issued = await issueLocalVoiceRun({
        root,
        request: request(),
        runId: randomUUID(),
        costAcknowledged: true,
        inputFingerprint: hash('reviewed code'),
        configurationFingerprint: hash('reviewed configuration'),
        runtimeFingerprint: hash('runtime'),
        corpusFingerprint: hash('corpus'),
        now: Date.now(),
      })
      expect(
        Date.parse(issued.record.expiresAt) -
          Date.parse(issued.record.issuedAt),
      ).toBe(900_000)
      expect(JSON.parse(await readFile(issued.path, 'utf8'))).toEqual(
        issued.record,
      )
      expect(Object.keys(issued.record)).not.toContain('token')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('keeps uncertain issuance blocked across runs and after checkpoint loss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'voice-probe-'))
    let checkpoint = ''
    try {
      await expect(
        withVoiceProbeLock(root, 'agent_test', async (path) => {
          checkpoint = path
          throw new Error('SIMULATED_CRASH')
        }),
      ).rejects.toThrow('SIMULATED_CRASH')
      await expect(
        withVoiceProbeLock(root, 'agent_test', async () => true),
      ).rejects.toThrow('VOICE_PROBE_UNCERTAIN')
      await rm(checkpoint)
      await expect(
        withVoiceProbeLock(root, 'agent_test', async () => true),
      ).rejects.toThrow('VOICE_PROBE_CHECKPOINT_MISSING')
      await atomicJson(checkpoint, {
        closed: true,
        closedAt: new Date().toISOString(),
      })
      expect(
        await withVoiceProbeLock(root, 'agent_test', async () => true),
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('keeps all twenty speech definitions tied to their clean text facts and leaves audio missing', async () => {
    const text = validateCorpus(
      JSON.parse(await readFile('verification/cases/voice-text.json', 'utf8')),
    )
    const speech = validateSpeechCorpus(
      JSON.parse(
        await readFile('verification/cases/voice-speech.json', 'utf8'),
      ),
      text,
    )
    expect(speech.cases).toHaveLength(20)
    expect(
      speech.cases.every((c) => 'assetDigest' in c && c.assetDigest === null),
    ).toBe(true)
  })
})
