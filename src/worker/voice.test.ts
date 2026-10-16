import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicConfiguration } from '../domain/configuration'
import { isUuid } from '../domain/feedback'
import { handleVoiceRequest, voiceRoute } from './voice'
import {
  readVoiceManifest,
  readLocalVoiceRun,
  voiceAuthorisation,
} from './voice-configuration'
import { observeVoiceProvider, issueVoiceCredential } from './voice-provider'

const config: PublicConfiguration = {
  appEnv: 'local',
  appOrigin: 'http://127.0.0.1:5173',
  releaseId: 'local',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabasePublicKey: 'synthetic public',
  voiceEnabled: true,
}
const url = 'http://127.0.0.1:5173/api/voice/sessions'
const requestId = '11111111-1111-4111-8111-111111111111'
const request = (body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: {
      Origin: config.appOrigin,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
describe('voice boundaries without provider authority', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('recognizes fixed route labels and denies preview before Auth or provider work', async () => {
    expect(voiceRoute('GET', `${new URL(url).pathname}/${requestId}`)).toBe(
      'voice_read',
    )
    expect(
      voiceRoute('POST', `${new URL(url).pathname}/${requestId}/proposal`),
    ).toBe('voice_proposal')
    expect(
      voiceRoute('GET', `${new URL(url).pathname}/${requestId}/end`),
    ).toBeUndefined()
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const result = await handleVoiceRequest(
      request(),
      { ...config, appEnv: 'preview' },
      {},
      requestId,
    )
    expect(result.status).toBe(503)
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    expect(await result.json()).toEqual({
      code: 'VOICE_UNAVAILABLE',
      requestId,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects cross origin and missing bearer before remote work', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const env = { SUPABASE_ADMIN_KEY: 'synthetic admin' }
    expect(
      (
        await handleVoiceRequest(
          request({}, { Origin: 'https://foreign.invalid' }),
          config,
          env,
          requestId,
        )
      ).status,
    ).toBe(403)
    expect(
      (await handleVoiceRequest(request(), config, env, requestId)).status,
    ).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects an unconfigured manifest and browser supplied local authority', async () => {
    expect(
      readVoiceManifest({ schemaVersion: 1, status: 'unconfigured' }),
    ).toBeUndefined()
    expect(
      readLocalVoiceRun({ acknowledged: true }, Date.now()),
    ).toBeUndefined()
    expect(
      await voiceAuthorisation(
        config,
        { VOICE_LOCAL_RUN_RECORD: JSON.stringify({ acknowledged: true }) },
        {
          actorId: requestId,
          campaignId: requestId,
          playerId: requestId,
          startRequestId: requestId,
        },
      ),
    ).toBeUndefined()
    expect(isUuid(requestId)).toBe(true)
  })
  it('projects only authenticated execution metadata, ignoring transcript and analysis', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        conversation_id: 'conv_test',
        agent_id: 'agent_test',
        version_id: 'version_test',
        status: 'in-progress',
        transcript: [{ text: 'PRIVATE SYNTHETIC CONTENT' }],
        analysis: { text: 'PRIVATE' },
        metadata: { call_duration_secs: 10 },
      }),
    )
    const result = await observeVoiceProvider(
      'conv_test',
      'synthetic key',
      fetcher,
    )
    expect(result).toEqual({
      kind: 'observed',
      conversationId: 'conv_test',
      agentId: 'agent_test',
      versionId: 'version_test',
      status: 'in-progress',
      durationSeconds: 10,
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
  })
  it('never treats retention deletion or a lost issuance reply as a definitive end', async () => {
    expect(
      await observeVoiceProvider(
        'conv_test',
        'synthetic key',
        vi.fn(async () => new Response('', { status: 404 })),
      ),
    ).toEqual({ kind: 'missing' })
    const manifest = {
      agentId: 'agent_test',
      agentVersionId: 'version_test',
    } as Parameters<typeof issueVoiceCredential>[0]
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error('untrusted provider details')
    })
    expect(
      await issueVoiceCredential(manifest, 'synthetic key', fetcher),
    ).toEqual({ outcome: 'unknown' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0][0])).toContain(
      'version_id=version_test',
    )
  })
})
