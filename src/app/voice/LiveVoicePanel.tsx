import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
} from '@elevenlabs/react'
import {
  finishMessage,
  proposalToolName,
  providerContext,
} from '../../domain/voice'
import { voiceContextMatches } from '../../domain/feedback'
import { useCoach } from '../coach/runtime'
import { VoicePanel } from '../coach/components'
import {
  applyProposal,
  bindingFor,
  writable,
  type Editor,
  type TextField,
  type Proposal,
} from '../coach/editor'
import type { Workspace as WorkspaceValue } from '../coach/contracts'
import { createVoiceApi } from './api'
import { createVoiceController, type VoiceTransport } from './controller'

// The provider owns SDK capture. Unmounting it also releases SDK media resources.
export default function LiveVoicePanel(
  props: Readonly<{
    editor: Editor
    workspace: WorkspaceValue
    locked: boolean
    onBlocking: (value: boolean) => void
  }>,
) {
  const runtime = useCoach()
  if (
    !runtime.dataClient ||
    !runtime.configuration.voiceEnabled ||
    props.editor.context.kind !== 'preparation'
  )
    return null
  return (
    <ConversationProvider>
      <ConnectedVoicePanel {...props} />
    </ConversationProvider>
  )
}
function ConnectedVoicePanel({
  editor,
  workspace,
  locked,
  onBlocking,
}: Readonly<{
  editor: Editor
  workspace: WorkspaceValue
  locked: boolean
  onBlocking: (value: boolean) => void
}>) {
  const runtime = useCoach()
  const { startSession, endSession, sendUserMessage } =
    useConversationControls()
  const { setMuted } = useConversationInput()
  const binding = useMemo(
    () => bindingFor(runtime.actor, workspace, 'preparation'),
    [runtime.actor, workspace],
  )
  const api = useMemo(
    () => createVoiceApi(runtime.dataClient!),
    [runtime.dataClient],
  )
  const transport = useMemo<VoiceTransport>(
    () => ({
      start: (
        token,
        connected,
        disconnected,
        error,
        message,
        speaking,
        tool,
      ) => {
        setMuted(false)
        startSession({
          conversationToken: token,
          connectionType: 'webrtc',
          dynamicVariables: providerContext,
          clientTools: { [proposalToolName]: tool },
          onConnect: ({ conversationId }) => connected(conversationId),
          onDisconnect: disconnected,
          onError: error,
          onMessage: ({ message: text }) => message(text),
          onModeChange: ({ mode }) => speaking(mode === 'speaking'),
        })
      },
      end: endSession,
      mute: () => setMuted(true),
      requestProposal: () => sendUserMessage(finishMessage),
    }),
    [startSession, endSession, sendUserMessage, setMuted],
  )
  const controller = useMemo(
    () => createVoiceController(api, transport, binding),
    [api, transport, binding],
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  )
  const applying = useRef(false)
  const [applicationMessage, setApplicationMessage] = useState('')
  useEffect(() => {
    void controller.recover()
    const hidden = () => {
      if (document.visibilityState === 'hidden') controller.background()
    }
    const pagehide = () => controller.background()
    const focus = () => {
      void fetch('/api/config', { cache: 'no-store' })
        .then(async (response) => {
          const value: unknown = await response.json()
          if (
            !response.ok ||
            !value ||
            typeof value !== 'object' ||
            !('voiceEnabled' in value) ||
            value.voiceEnabled !== true
          )
            controller.cancel()
          await controller.refresh()
        })
        .catch(() => controller.cancel())
    }
    const tick = setInterval(controller.tick, 250)
    const reconcile = setInterval(() => {
      void controller.refresh()
    }, 5000)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', pagehide)
    window.addEventListener('focus', focus)
    return () => {
      clearInterval(tick)
      clearInterval(reconcile)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', pagehide)
      window.removeEventListener('focus', focus)
      controller.dispose()
      onBlocking(false)
    }
  }, [controller, onBlocking])
  useEffect(() => {
    onBlocking(state.blocking)
  }, [state.blocking, onBlocking])
  useEffect(() => {
    const ids = [
      ...new Set(
        Object.values(editor.provenance).flatMap((p) => p?.sessionIds ?? []),
      ),
    ]
    if (!ids.length) return
    let active = true
    const check = async () => {
      const results = await Promise.all(
        ids.map(async (id) => ({ id, session: await api.validate(id) })),
      )
      if (active)
        runtime.controller.invalidateVoiceSessions(
          results.filter((r) => !r.session?.proposalEligible).map((r) => r.id),
        )
    }
    void check()
    const timer = setInterval(() => {
      void check()
    }, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [editor.provenance, api, runtime.controller])
  useEffect(() => {
    if (locked && state.blocking) controller.cancel()
  }, [locked, state.blocking, controller])
  const apply = async (proposal: Proposal, fields: readonly TextField[]) => {
    if (!proposal.sessionId || applying.current) return
    applying.current = true
    const original = runtime.controller.getSnapshot().editor
    try {
      const checked = await api.validate(proposal.sessionId)
      const current = runtime.controller.getSnapshot()
      if (
        !checked ||
        !original ||
        current.editor !== original ||
        current.pending ||
        current.conflict ||
        current.editor.resumeRequired ||
        !voiceContextMatches(
          checked.binding,
          binding,
          writable(workspace, 'preparation'),
        )
      ) {
        setApplicationMessage(
          'The form or voice context changed. Review the current text before applying again.',
        )
        return
      }
      runtime.controller.updateEditor(
        applyProposal(current.editor, proposal, fields, binding, true),
      )
      setApplicationMessage(
        'Selected fields applied. Review the form before saving or submitting.',
      )
    } finally {
      applying.current = false
    }
  }
  return (
    <VoicePanel
      adapter={{
        evidence: 'live',
        state: state.phase,
        proposal: state.proposal,
        start: () => {
          void controller.start()
        },
        stop: () => {
          void controller.finish()
        },
        cancel: controller.cancel,
        caption: state.caption,
        message:
          state.phase === 'proposal_ready'
            ? applicationMessage || state.message
            : state.message,
        startUnavailable:
          state.blocking ||
          (state.session !== undefined && state.session.endedAt === null),
        remainingSeconds: state.remainingSeconds,
      }}
      editor={editor}
      locked={locked}
      apply={(proposal, fields) => {
        void apply(proposal, fields)
      }}
    />
  )
}
