import { describe, expect, it, vi } from 'vitest'
import { createVoiceController, type VoiceTransport } from './controller'
import type { VoiceApi } from './api'
import type { VoiceReply, VoiceSessionView } from '../../domain/voice'

const actor = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const binding = {
  callerId: actor,
  campaignId: '33333333-3333-4333-8333-333333333333',
  playerId: '44444444-4444-4444-8444-444444444444',
  kind: 'preparation' as const,
  campaignVersion: 1,
  callerAccessVersion: 1,
  coachMembershipVersion: 1,
  playerMembershipVersion: 1,
}
const session: VoiceSessionView = {
  id: sessionId,
  startRequestId: actor,
  version: 1,
  status: 'authorising',
  localOutcome: 'open',
  providerState: 'unknown',
  failureCode: null,
  binding,
  connectedAt: null,
  endedAt: null,
  holdUntil: null,
  callCapSeconds: 300,
  warningSeconds: 30,
  callRemainingMs: null,
  finishRemainingMs: null,
  proposalId: null,
  proposalEligible: false,
  revoked: false,
  finishMode: 'mute_and_request',
}
const reply = (value: VoiceSessionView = session): VoiceReply => ({
  session: value,
  code: undefined,
  requestId: actor,
  token: 'synthetic token',
  conversationId: 'conv_synthetic',
  quotaResetAt: undefined,
  outstandingSessionId: undefined,
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const fixture = () => {
  let connected: (id: string) => void = () => {}
  let disconnected: () => void = () => {}
  let tool: (args: unknown) => Promise<string> = async () => ''
  let clock = 0
  const transport: VoiceTransport = {
    start: vi.fn(
      (
        _token,
        onConnect,
        onDisconnect,
        _error,
        _message,
        _speaking,
        onTool,
      ) => {
        connected = onConnect
        disconnected = onDisconnect
        tool = onTool
      },
    ),
    end: vi.fn(),
    mute: vi.fn(),
    requestProposal: vi.fn(),
  }
  const api: VoiceApi = {
    request: vi.fn(async (path) =>
      reply(
        path.endsWith('connected')
          ? {
              ...session,
              status: 'active',
              connectedAt: '2026-10-14T00:00:00Z',
              callRemainingMs: 300_000,
            }
          : path.endsWith('finish')
            ? {
                ...session,
                status: 'finishing',
                finishRemainingMs: 20_000,
                callRemainingMs: 280_000,
              }
            : session,
      ),
    ),
    current: vi.fn(async () => ({ ok: true as const, id: undefined })),
    validate: vi.fn(async () => session),
    proposal: vi.fn(async (_id, proposalId) => ({
      session: { ...session, proposalId, proposalEligible: true },
      fields: {
        observations: 'Supported synthetic fact',
        strengths: '',
        developmentFocus: '',
      },
    })),
  }
  const controller = createVoiceController(api, transport, binding, () => clock)
  const connect = async () => {
    await controller.start()
    connected('conv_synthetic')
    await Promise.resolve()
    await Promise.resolve()
  }
  return {
    api,
    transport,
    controller,
    connect,
    disconnect: () => disconnected(),
    deliver: (args: unknown) => tool(args),
    advance: (ms: number) => {
      clock += ms
      controller.tick()
    },
  }
}
describe('actor and context owned voice controller', () => {
  it('cancels the eventual reserved row when cancellation races start', async () => {
    const f = fixture()
    const waiting = deferred<VoiceReply>()
    vi.mocked(f.api.request).mockImplementationOnce(() => waiting.promise)
    const start = f.controller.start()
    f.controller.cancel()
    waiting.resolve(reply())
    await start
    expect(f.transport.start).not.toHaveBeenCalled()
    expect(f.api.request).toHaveBeenCalledWith(`/${sessionId}/end`, {
      reason: 'cancelled',
    })
    expect(f.controller.getSnapshot().proposal).toBeUndefined()
  })
  it('releases capture before processing and never files tool content', async () => {
    const f = fixture()
    await f.connect()
    expect(f.controller.getSnapshot().phase).toBe('listening')
    const waiting = deferred<VoiceReply>()
    vi.mocked(f.api.request).mockImplementationOnce(() => waiting.promise)
    const finish = f.controller.finish()
    expect(f.transport.mute).toHaveBeenCalledOnce()
    expect(f.transport.requestProposal).not.toHaveBeenCalled()
    waiting.resolve(
      reply({ ...session, status: 'finishing', finishRemainingMs: 20_000 }),
    )
    await finish
    expect(f.transport.requestProposal).toHaveBeenCalledOnce()
    await f.deliver({ observations: 'Supported synthetic fact' })
    expect(f.controller.getSnapshot().phase).toBe('proposal_ready')
    expect(f.controller.getSnapshot().proposal?.sessionId).toBe(sessionId)
    expect(f.transport.end).toHaveBeenCalledOnce()
    f.disconnect()
    expect(f.controller.getSnapshot().proposal?.fields.observations).toBe(
      'Supported synthetic fact',
    )
    expect(
      vi
        .mocked(f.api.request)
        .mock.calls.every(
          ([path]) => !path.includes('submit') && !path.includes('save'),
        ),
    ).toBe(true)
  })
  it('ignores a proposal returned after background cancellation', async () => {
    const f = fixture()
    await f.connect()
    await f.controller.finish()
    const waiting = deferred<Awaited<ReturnType<VoiceApi['proposal']>>>()
    vi.mocked(f.api.proposal).mockImplementationOnce(() => waiting.promise)
    const delivery = f.deliver({ observations: 'Supported synthetic fact' })
    f.controller.background()
    waiting.resolve({
      session: { ...session, proposalEligible: true },
      fields: {
        observations: 'Late fact',
        strengths: '',
        developmentFocus: '',
      },
    })
    await delivery
    expect(f.controller.getSnapshot().proposal).toBeUndefined()
    expect(f.controller.getSnapshot().caption).toBe('')
    expect(f.api.request).toHaveBeenCalledWith(`/${sessionId}/end`, {
      reason: 'backgrounded',
    })
  })
  it('rejects context mismatch and unsolicited or malformed tool delivery', async () => {
    const f = fixture()
    await f.connect()
    await f.deliver({ observations: 'Early fact' })
    expect(f.api.proposal).not.toHaveBeenCalled()
    await f.controller.finish()
    await f.deliver({ rating: 5 })
    expect(f.api.proposal).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot().proposal).toBeUndefined()
  })
  it('warns at thirty seconds and closes at the cap without a restart', async () => {
    const f = fixture()
    await f.connect()
    f.advance(270_000)
    expect(f.controller.getSnapshot().remainingSeconds).toBe(30)
    expect(f.controller.getSnapshot().message).toContain('Thirty seconds')
    f.advance(30_000)
    expect(f.transport.end).toHaveBeenCalledOnce()
    expect(f.transport.start).toHaveBeenCalledOnce()
    expect(f.api.request).toHaveBeenCalledWith(`/${sessionId}/end`, {
      reason: 'timed_out',
    })
  })
  it('ends immediately when capture proof is unavailable', async () => {
    const f = fixture()
    vi.mocked(f.api.request).mockResolvedValueOnce(
      reply({ ...session, finishMode: 'end_immediately' }),
    )
    await f.controller.start()
    // The server refuses active finish without the reviewed capture contract.
    f.controller.cancel()
    expect(f.transport.requestProposal).not.toHaveBeenCalled()
    expect(f.transport.end).toHaveBeenCalledOnce()
  })
})
