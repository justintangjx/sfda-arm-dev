import {
  isEmptyProposal,
  parseToolArguments,
  type VoiceSessionView,
} from '../../domain/voice'
import {
  voiceContextMatches,
  type VoiceContextBinding,
} from '../../domain/feedback'
import type { Proposal } from '../coach/editor'
import type { VoiceApi } from './api'

export type VoiceTransport = Readonly<{
  start: (
    token: string,
    connected: (id: string) => void,
    disconnected: () => void,
    error: () => void,
    message: (text: string) => void,
    speaking: (speaking: boolean) => void,
    tool: (fields: unknown) => Promise<string>,
  ) => void
  end: () => void
  mute: () => void
  requestProposal: () => void
}>
export type VoiceControllerState = Readonly<{
  phase:
    | 'idle'
    | 'requesting_microphone'
    | 'listening'
    | 'assistant_speaking'
    | 'processing'
    | 'proposal_ready'
    | 'cancelled'
    | 'failed'
  session: VoiceSessionView | undefined
  proposal: Proposal | undefined
  caption: string
  message: string
  blocking: boolean
  remainingSeconds: number | undefined
}>
const initial: VoiceControllerState = {
  phase: 'idle',
  session: undefined,
  proposal: undefined,
  caption: '',
  message: '',
  blocking: false,
  remainingSeconds: undefined,
}

// One instance owns one context. Async callbacks close over their original generation.
export const createVoiceController = (
  api: VoiceApi,
  transport: VoiceTransport,
  binding: VoiceContextBinding,
  now: () => number = performance.now.bind(performance),
) => {
  let state = initial
  let generation = 0
  let liveGeneration: number | undefined
  let finishing = false
  let finishPromise: Promise<string> | undefined
  let callDeadline: number | undefined
  let finishDeadline: number | undefined
  let startRequestId: string | undefined
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = (next: VoiceControllerState) => {
    state = next
    if (!disposed) listeners.forEach((fn) => fn())
  }
  const current = (at: number) => at === generation && !disposed
  const remember = (session: VoiceSessionView) => {
    publish({
      ...state,
      session,
      blocking: session.localOutcome === 'open' && session.endedAt === null,
    })
    if (session.callRemainingMs !== null)
      callDeadline = Math.min(
        callDeadline ?? Infinity,
        now() + session.callRemainingMs,
      )
    if (session.finishRemainingMs !== null)
      finishDeadline = Math.min(
        finishDeadline ?? Infinity,
        now() + session.finishRemainingMs,
      )
  }
  const postEnd = async (
    session: VoiceSessionView,
    reason: string,
    at: number,
  ) => {
    const result = await api.request(`/${session.id}/end`, { reason })
    if (current(at) && result.session) remember(result.session)
  }
  const close = (
    reason: 'cancelled' | 'backgrounded' | 'failed' | 'timed_out' | 'finished',
  ) => {
    const at = ++generation
    liveGeneration = undefined
    finishing = false
    finishPromise = undefined
    transport.end()
    callDeadline = undefined
    finishDeadline = undefined
    const keep = !['cancelled', 'backgrounded'].includes(reason)
      ? state.proposal
      : undefined
    publish({
      ...state,
      caption: '',
      proposal: keep,
      blocking: false,
      remainingSeconds: undefined,
      phase: keep
        ? 'proposal_ready'
        : ['cancelled', 'backgrounded'].includes(reason)
          ? 'cancelled'
          : 'failed',
      message: keep
        ? 'Your proposal is ready for review. Nothing has been filed.'
        : 'The conversation ended. You can continue writing.',
    })
    if (state.session) void postEnd(state.session, reason, at)
  }
  const connected = async (
    conversationId: string,
    expectedId: string,
    at: number,
  ) => {
    if (!current(at) || liveGeneration !== at) {
      transport.end()
      return
    }
    const session = state.session
    if (!session || conversationId !== expectedId) {
      close('failed')
      return
    }
    callDeadline = Math.min(
      callDeadline ?? Infinity,
      now() + session.callCapSeconds * 1000,
    )
    const result = await api.request(`/${session.id}/connected`, {
      conversationId,
      expectedVersion: session.version,
    })
    if (!current(at)) return
    if (
      result.code ||
      !result.session ||
      result.session.status !== 'active' ||
      !voiceContextMatches(result.session.binding, binding, true)
    ) {
      close('failed')
      return
    }
    remember(result.session)
    publish({ ...state, phase: 'listening', message: '' })
  }
  const deliver = async (fields: unknown, at: number): Promise<string> => {
    if (
      !current(at) ||
      !finishing ||
      !state.session ||
      finishDeadline === undefined ||
      now() >= finishDeadline
    )
      return 'No proposal accepted.'
    const parsed = parseToolArguments(fields)
    if (!parsed.ok || isEmptyProposal(parsed.value)) {
      close('finished')
      return 'No supported proposal. The coach can continue writing.'
    }
    if (finishPromise) return finishPromise
    const session = state.session
    const proposalId = crypto.randomUUID()
    const work = async () => {
      const result = await api.proposal(session.id, proposalId, fields)
      if (!current(at) || !finishing || now() >= (finishDeadline ?? 0))
        return 'No proposal accepted.'
      if (
        !result ||
        !voiceContextMatches(result.session.binding, binding, true)
      ) {
        close('failed')
        return 'No proposal accepted.'
      }
      remember(result.session)
      publish({
        ...state,
        proposal: {
          id: proposalId,
          sessionId: session.id,
          binding: result.session.binding,
          fields: result.fields,
        },
      })
      close('finished')
      return 'The coach will review the proposal. Nothing was saved or submitted.'
    }
    finishPromise = work()
    return finishPromise
  }
  const refresh = async () => {
    const at = generation
    const known = state.session
    if (!known) return
    const result =
      known.endedAt !== null
        ? { session: await api.validate(known.id), code: undefined }
        : await api.request(`/${known.id}`)
    if (!current(at)) return
    if (
      !result.session ||
      result.code ||
      result.session.revoked ||
      !voiceContextMatches(result.session.binding, binding, true)
    ) {
      if (liveGeneration !== undefined) close('failed')
      publish({
        ...state,
        proposal: undefined,
        phase: 'failed',
        message:
          'Voice context could not be confirmed. Refresh before another conversation.',
      })
      return
    }
    remember(result.session)
    if (state.proposal && !result.session.proposalEligible)
      publish({ ...state, proposal: undefined })
    if (result.session.localOutcome !== 'open' && liveGeneration !== undefined)
      close('failed')
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    recover: async () => {
      const at = generation
      publish({ ...state, blocking: true })
      const found = await api.current()
      if (!current(at)) return
      if (!found.ok) {
        publish({
          ...state,
          blocking: true,
          message:
            'Voice status could not be confirmed. You can refresh to retry.',
        })
        return
      }
      if (found.id) {
        const result = await api.request(`/${found.id}`)
        if (!current(at)) return
        if (result.session) {
          // Temporary text cannot be recovered from session metadata.
          remember(result.session)
          publish({
            ...state,
            blocking: result.session.localOutcome === 'open',
            message:
              'An earlier conversation is still being reconciled. Cancel it before continuing.',
          })
          return
        }
        publish({
          ...state,
          blocking: true,
          message: 'Voice status could not be confirmed. Refresh to retry.',
        })
        return
      }
      publish({ ...state, blocking: false })
    },
    start: async () => {
      if (
        state.blocking ||
        disposed ||
        liveGeneration !== undefined ||
        (state.session && state.session.endedAt === null)
      )
        return
      const at = ++generation
      startRequestId = crypto.randomUUID()
      publish({ ...initial, phase: 'requesting_microphone', blocking: true })
      const result = await api.request('', {
        startRequestId,
        campaignId: binding.campaignId,
        playerId: binding.playerId,
        acknowledged: true,
      })
      if (!current(at)) {
        // Cancel while reserving still revokes the eventual row, even after unmount.
        if (result.session)
          await api.request(`/${result.session.id}/end`, {
            reason: 'cancelled',
          })
        return
      }
      if (result.session) remember(result.session)
      if (result.outstandingSessionId) {
        const busy = await api.request(`/${result.outstandingSessionId}`)
        if (!current(at)) return
        if (busy.session) remember(busy.session)
      }
      if (
        result.code ||
        !result.session ||
        !result.token ||
        !result.conversationId ||
        !voiceContextMatches(result.session.binding, binding, true)
      ) {
        publish({
          ...state,
          phase: 'failed',
          blocking: state.session?.localOutcome === 'open',
          message: result.quotaResetAt
            ? `Voice allowance resets at ${result.quotaResetAt}. You can continue writing.`
            : 'Voice could not start. You can continue writing. An unresolved call may need cancellation.',
        })
        return
      }
      liveGeneration = at
      try {
        transport.start(
          result.token,
          (id) => {
            void connected(id, result.conversationId!, at)
          },
          () => {
            if (current(at) && liveGeneration === at) close('failed')
          },
          () => {
            if (current(at)) close('failed')
          },
          (caption) => {
            if (current(at) && liveGeneration === at)
              publish({ ...state, caption })
          },
          (speaking) => {
            if (current(at) && state.session?.status === 'active' && !finishing)
              publish({
                ...state,
                phase: speaking ? 'assistant_speaking' : 'listening',
              })
          },
          (fields) => deliver(fields, at),
        )
      } catch {
        close('failed')
      }
    },
    finish: async () => {
      const at = generation
      const session = state.session
      if (
        !session ||
        liveGeneration !== at ||
        finishing ||
        session.status !== 'active'
      )
        return
      if (session.finishMode !== 'mute_and_request') {
        close('finished')
        return
      }
      // Capture stops before any asynchronous finish request. Live setup requires measured proof.
      transport.mute()
      finishing = true
      finishDeadline = Math.min(callDeadline ?? Infinity, now() + 20_000)
      publish({ ...state, phase: 'processing', caption: '' })
      const result = await api.request(`/${session.id}/finish`, {
        expectedVersion: session.version,
      })
      if (!current(at)) return
      if (
        result.code ||
        !result.session ||
        result.session.finishRemainingMs === null
      ) {
        close('failed')
        return
      }
      remember(result.session)
      if (now() >= (finishDeadline ?? 0)) {
        close('timed_out')
        return
      }
      transport.requestProposal()
    },
    cancel: () => close('cancelled'),
    background: () => close('backgrounded'),
    refresh,
    tick: () => {
      if (liveGeneration === undefined) return
      const deadline = finishing ? finishDeadline : callDeadline
      if (deadline !== undefined && now() >= deadline) {
        close('timed_out')
        return
      }
      if (callDeadline !== undefined) {
        const remainingSeconds = Math.max(
          0,
          Math.ceil((callDeadline - now()) / 1000),
        )
        publish({
          ...state,
          remainingSeconds,
          message:
            remainingSeconds <= 30
              ? 'Thirty seconds or less remain. Finish and review soon.'
              : state.message,
        })
      }
    },
    dispose: () => {
      close('cancelled')
      disposed = true
      listeners.clear()
    },
  }
}
export type VoiceController = ReturnType<typeof createVoiceController>
