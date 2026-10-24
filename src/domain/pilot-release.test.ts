import { describe, expect, it } from 'vitest'
import {
  demoActivationMatchesProduction,
  readDemoVoiceActivation,
  readHostingProductionTarget,
} from './pilot-release'

const activation = {
  schemaVersion: 1 as const,
  activationId: '11111111-1111-4111-8111-111111111111',
  approvedOrigin: 'https://app.example.dev',
  approvedReleaseId: 'a'.repeat(40),
  voiceConfigFingerprint: 'b'.repeat(64),
  approvedAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-10-15T00:00:00.000Z',
  approverReference: 'ticket-1',
  maxDemoCoaches: 10,
  syntheticRosterNote: 'Synthetic demo coaches only',
  elevenLabsPlanReference: 'pricing-1',
}

describe('pilot release contracts', () => {
  it('reads demo activation and matches production inputs', () => {
    expect(
      readDemoVoiceActivation({ schemaVersion: 1, status: 'inactive' }),
    ).toBeUndefined()
    expect(readDemoVoiceActivation(activation)).toEqual(activation)
    expect(
      demoActivationMatchesProduction(activation, {
        appOrigin: activation.approvedOrigin,
        releaseId: activation.approvedReleaseId,
        configurationFingerprint: activation.voiceConfigFingerprint,
        evidenceId: activation.activationId,
        now: Date.parse('2026-10-10T00:00:00.000Z'),
      }),
    ).toBe(true)
    expect(
      demoActivationMatchesProduction(activation, {
        appOrigin: activation.approvedOrigin,
        releaseId: activation.approvedReleaseId,
        configurationFingerprint: activation.voiceConfigFingerprint,
        evidenceId: activation.activationId,
        now: Date.parse('2026-10-20T00:00:00.000Z'),
      }),
    ).toBe(false)
  })

  it('reads hosting production target manifests', () => {
    expect(
      readHostingProductionTarget({
        schemaVersion: 1,
        workerName: 'sfda-arm-dev-production',
        appOrigin: 'https://app.example.dev',
        supabaseProjectRef: 'abcdefghijklmnopqrst',
        accountRequestLimiterNamespace: '0'.repeat(32),
        accountProjectLimiterNamespace: '1'.repeat(32),
        recordedAt: '2026-10-21T00:00:00.000Z',
        recordedBy: 'ops@example.com',
      }),
    ).toMatchObject({ workerName: 'sfda-arm-dev-production' })
  })
})
