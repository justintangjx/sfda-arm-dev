import { describe, expect, it } from 'vitest'
import type { PublicConfiguration } from '../domain/configuration'
import {
  voiceAuthorisation,
  readVoiceManifest,
  voiceManifestFingerprint,
} from './voice-configuration'

const productionConfig: PublicConfiguration = {
  appEnv: 'production',
  appOrigin: 'https://app.example.dev',
  releaseId: 'a'.repeat(40),
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  supabasePublicKey: 'public',
  voiceEnabled: true,
}

const manifest = readVoiceManifest({
  schemaVersion: 1,
  agentId: 'agent_test',
  agentVersionId: 'version_test',
  credentialRule: 'hold_only',
  captureRule: 'mute_stops_capture',
  dispatchToIssuanceSeconds: 30,
  redemptionSeconds: 60,
  limits: {
    callCapSeconds: 300,
    finishSeconds: 20,
    coachDaily: 20,
    sfdaDaily: 100,
  },
  providerConfiguration: {},
  toolConfigurations: { prepare_feedback_proposal: {} },
  noticeVersion: 'notice-1',
  compatibilityEvidenceId: 'compat-1',
  compatibilityUntil: '2099-01-01T00:00:00.000Z',
  pricingReference: 'price-1',
  runtimeOverridesEvidenceId: 'runtime-1',
})

describe('voiceAuthorisation production demo activation', () => {
  it('returns production_activation when demo record and secrets align', async () => {
    if (!manifest) throw new Error('fixture manifest')
    const fingerprint = await voiceManifestFingerprint(manifest)
    const demo = {
      schemaVersion: 1,
      activationId: '11111111-1111-4111-8111-111111111111',
      approvedOrigin: productionConfig.appOrigin,
      approvedReleaseId: productionConfig.releaseId,
      voiceConfigFingerprint: fingerprint,
      approvedAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-10-15T00:00:00.000Z',
      approverReference: 'ticket-1',
      maxDemoCoaches: 10,
      syntheticRosterNote: 'Synthetic demo coaches only',
      elevenLabsPlanReference: 'pricing-1',
    }
    const gate = await voiceAuthorisation(
      productionConfig,
      {
        ELEVENLABS_API_KEY: 'key',
        ELEVENLABS_AGENT_ID: manifest.agentId,
        ELEVENLABS_AGENT_VERSION_ID: manifest.agentVersionId,
        VOICE_CONFIG_FINGERPRINT: fingerprint,
        VOICE_ACTIVATION_EVIDENCE_ID: demo.activationId,
      },
      {
        actorId: '22222222-2222-4222-8222-222222222222',
        campaignId: '33333333-3333-4333-8333-333333333333',
        playerId: '44444444-4444-4444-8444-444444444444',
        startRequestId: '55555555-5555-4555-8555-555555555555',
      },
      Date.parse('2026-10-10T00:00:00.000Z'),
      manifest,
      demo,
    )
    expect(gate?.authorisation).toEqual({
      kind: 'production_activation',
      evidenceId: demo.activationId,
      until: demo.expiresAt,
    })
    expect(gate?.run).toBeUndefined()
  })
})
