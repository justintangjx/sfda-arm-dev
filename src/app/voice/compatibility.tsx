// Local Vite verification entry. The production build has only index.html as an entry.
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ConversationProvider, useConversation } from '@elevenlabs/react'
import {
  finishMessage,
  proposalToolName,
  providerContext,
} from '../../domain/voice'
import '../styles.css'

type ProbeState = {
  connected: boolean
  disconnected: boolean
  failed: boolean
  conversationId: string | undefined
  proposalReceived: boolean
}
const state: ProbeState = {
  connected: false,
  disconnected: false,
  failed: false,
  conversationId: undefined,
  proposalReceived: false,
}
const tracks: MediaStreamTrack[] = []
const capture = navigator.mediaDevices?.getUserMedia.bind(
  navigator.mediaDevices,
)
if (capture)
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await capture(constraints)
    tracks.push(...stream.getTracks())
    return stream
  }
const probeWindow = window as Window & {
  voiceCompatibility?: {
    start: (token: string) => void
    finish: () => void
    end: () => void
    snapshot: () => ProbeState & { trackCount: number; liveTracks: number }
  }
}
export function Probe() {
  const { startSession, endSession, setMuted, sendUserMessage } =
    useConversation({
      onConnect: ({ conversationId }) => {
        state.connected = true
        state.conversationId = conversationId
      },
      onDisconnect: () => {
        state.disconnected = true
      },
      onError: () => {
        state.failed = true
      },
      clientTools: {
        [proposalToolName]: () => {
          state.proposalReceived = true
          return 'Synthetic compatibility probe. Nothing filed.'
        },
      },
    })
  useEffect(() => {
    probeWindow.voiceCompatibility = {
      start: (token) => {
        state.connected = false
        state.disconnected = false
        state.failed = false
        state.proposalReceived = false
        state.conversationId = undefined
        setMuted(false)
        startSession({
          conversationToken: token,
          connectionType: 'webrtc',
          dynamicVariables: providerContext,
        })
      },
      finish: () => {
        setMuted(true)
        sendUserMessage(finishMessage)
      },
      end: endSession,
      snapshot: () => ({
        ...state,
        trackCount: tracks.length,
        liveTracks: tracks.filter((track) => track.readyState === 'live')
          .length,
      }),
    }
    return () => {
      probeWindow.voiceCompatibility = undefined
      endSession()
      tracks.forEach((track) => track.stop())
    }
  }, [startSession, endSession, setMuted, sendUserMessage])
  return (
    <main>
      <h1>Synthetic voice compatibility</h1>
      <p>
        This local verification page uses an approved synthetic audio asset. The
        trusted runner supplies one credential in memory. It does not file
        feedback or collect conversation text.
      </p>
    </main>
  )
}
if (location.origin !== 'http://127.0.0.1:5173')
  throw new Error('LOCAL_TARGET_REQUIRED')
createRoot(document.getElementById('root')!).render(
  <ConversationProvider>
    <Probe />
  </ConversationProvider>,
)
