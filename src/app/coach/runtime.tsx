import {
  createContext,
  useContext,
  useSyncExternalStore,
  type MutableRefObject,
} from 'react'
import type { PlayerNavigationGate } from './navigation.ts'
import type { PublicConfiguration } from '../../domain/configuration'
import type { Actor, CoachAdapter, Command } from './contracts'
import type { CoachController } from './controller'
import type { Access, PasswordLink } from '../../domain/accounts'
import type { DataResult } from './contracts'
import type { createDataClient } from '../data/client'

export type Runtime = Readonly<{
  configuration: PublicConfiguration
  actor: Actor | undefined
  adapter: CoachAdapter | undefined
  controller: CoachController | undefined
  revision: number
  networkUnavailable: boolean
  reportNetwork: (unavailable: boolean) => void
  enterPreview: () => void
  signOut: () => void
  refreshAccess: () => Promise<boolean>
  refresh: () => void
  access: Access | undefined
  dataClient: ReturnType<typeof createDataClient>
  login: (email: string, password: string) => Promise<DataResult<Access>>
  passwordLink: PasswordLink | undefined
  formDirty: boolean
  setFormDirty: (dirty: boolean) => void
  playerNavigationGate: MutableRefObject<PlayerNavigationGate | undefined>
}>
export const RuntimeContext = createContext<Runtime | undefined>(undefined)
export const useRuntime = () => {
  const value = useContext(RuntimeContext)
  if (!value) throw new Error('Coach runtime missing')
  return value
}
export const useCoach = () => {
  const runtime = useRuntime()
  if (!runtime.actor || !runtime.adapter || !runtime.controller)
    throw new Error('Coach access missing')
  return {
    ...runtime,
    actor: runtime.actor,
    adapter: runtime.adapter,
    controller: runtime.controller,
  }
}
export const useCoachState = () => {
  const { controller } = useCoach()
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot)
}
export const performAction = async (
  runtime: ReturnType<typeof useCoach>,
  action: Command['action'],
) => {
  const { actor, adapter, controller } = runtime
  const editor = controller.getSnapshot().editor
  if (
    !editor ||
    controller.getSnapshot().pending ||
    !navigator.onLine ||
    runtime.networkUnavailable ||
    editor.resumeRequired
  )
    return false
  const committed = await controller.start(action)
  const pending = controller.getSnapshot().pending
  if (
    pending?.result &&
    !pending.result.ok &&
    pending.result.code === 'NETWORK_ERROR'
  )
    runtime.reportNetwork(true)
  if (
    pending?.result &&
    !pending.result.ok &&
    ['FORBIDDEN', 'AUTH_REQUIRED'].includes(pending.result.code)
  ) {
    runtime.signOut()
    return false
  }
  if (pending?.status === 'resolved' && !pending.detached) {
    const readback = await adapter.loadWorkspace(
      actor,
      editor.context.campaignId,
      editor.context.playerId,
      editor.context.kind,
      new AbortController().signal,
    )
    if (readback.ok) controller.reconcile(readback.value)
  }
  runtime.refresh()
  return (
    committed &&
    !controller.getSnapshot().pending &&
    !controller.getSnapshot().conflict &&
    controller.getSnapshot().editor?.draft !== undefined
  )
}
