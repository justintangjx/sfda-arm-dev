import type {
  Actor,
  CoachAdapter,
  Command,
  Commit,
  DataResult,
  Workspace,
} from './contracts'
import {
  bindingFor,
  blankForm,
  newEditor,
  reconcileContext,
  sameContext,
  toContent,
  toForm,
  writable,
  invalidateVoiceSessions,
  type Editor,
} from './editor'
import { voiceContextMatches } from '../../domain/feedback'

export type Pending = Readonly<{
  command: Command
  snapshot: Editor
  status: 'pending' | 'unknown' | 'resolved'
  result: DataResult<Commit> | undefined
  detached: boolean
}>
export type CoachState = Readonly<{
  editor: Editor | undefined
  pending: Pending | undefined
  message: string
  conflict: Workspace | undefined
  lastSubmission: string | undefined
}>
const initialState: CoachState = {
  editor: undefined,
  pending: undefined,
  message: '',
  conflict: undefined,
  lastSubmission: undefined,
}
const ambiguous = (result: DataResult<Commit>) =>
  !result.ok && ['NETWORK_ERROR', 'INVALID_RESPONSE'].includes(result.code)

// One controller is created per actor above RouterProvider. Route departure cannot
// cancel a mutation or discard its request ID. Identity loss disposes this instance.
export const createCoachController = (actor: Actor, adapter: CoachAdapter) => {
  let state = initialState
  let disposed = false
  const invalidSessionIds = new Set<string>()
  const getSnapshot = (): CoachState => state
  const listeners = new Set<() => void>()
  const publish = (next: CoachState) => {
    if (disposed) return
    state = next
    listeners.forEach((listener) => listener())
  }
  const receive = (id: string, result: DataResult<Commit>, known = false) => {
    if (state.pending?.command.mutationId !== id || disposed) return
    publish({
      ...state,
      pending: {
        ...state.pending,
        result,
        status: !known && ambiguous(result) ? 'unknown' : 'resolved',
      },
      message:
        !known && ambiguous(result)
          ? 'Outcome unknown. Check the result before another action.'
          : 'Action response received. Confirming the current saved state.',
    })
  }
  const start = async (action: Command['action']): Promise<boolean> => {
    const editor = state.editor
    if (
      !editor ||
      editor.resumeRequired ||
      state.pending ||
      state.conflict ||
      disposed
    )
      return false
    const snapshot = structuredClone(editor)
    const command: Command = {
      action,
      mutationId: crypto.randomUUID(),
      context: snapshot.context,
      content: toContent(snapshot.form),
      draftId: snapshot.draft?.id,
      expectedVersion: snapshot.draft?.version,
      voiceBindings: Object.values(snapshot.provenance).flatMap(
        (value) => value?.bindings ?? [],
      ),
      voiceSessionIds: [
        ...new Set(
          Object.values(snapshot.provenance).flatMap(
            (value) => value?.sessionIds ?? [],
          ),
        ),
      ],
      reviewConfirmed: true,
    }
    publish({
      ...state,
      pending: {
        command,
        snapshot,
        status: 'pending',
        result: undefined,
        detached: false,
      },
      message:
        action === 'save'
          ? 'Saving draft…'
          : action === 'submit'
            ? 'Submitting feedback…'
            : 'Discarding saved draft…',
    })
    let dispatched = false
    try {
      const access = await adapter.getAccess(actor)
      if (disposed) return false
      if (
        !access.ok ||
        access.value.id !== actor.id ||
        access.value.accessVersion !== actor.accessVersion
      ) {
        receive(
          command.mutationId,
          { ok: false, code: 'FORBIDDEN', requestId: command.mutationId },
          true,
        )
        return false
      }
      const current = await adapter.loadWorkspace(
        actor,
        command.context.campaignId,
        command.context.playerId,
        command.context.kind,
        new AbortController().signal,
      )
      if (disposed) return false
      if (!current.ok) {
        receive(command.mutationId, current, true)
        return false
      }
      if (
        !writable(current.value, command.context.kind) ||
        command.voiceBindings.some(
          (binding) =>
            !voiceContextMatches(
              binding,
              bindingFor(actor, current.value, command.context.kind),
              true,
            ),
        )
      ) {
        receive(
          command.mutationId,
          { ok: false, code: 'STAGE_LOCKED', requestId: command.mutationId },
          true,
        )
        return false
      }
      dispatched = true
      receive(command.mutationId, await adapter.mutate(actor, command))
    } catch {
      receive(
        command.mutationId,
        {
          ok: false,
          code: 'NETWORK_ERROR',
          requestId: command.mutationId,
        },
        !dispatched,
      )
    }
    return getSnapshot().pending?.result?.ok === true
  }
  return {
    getSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    updateEditor: (editor: Editor) => {
      if (!state.pending) publish({ ...state, editor })
    },
    invalidateVoiceSessions: (ids: readonly string[]) => {
      ids.forEach((id) => invalidSessionIds.add(id))
      if (state.editor && !state.pending)
        publish({
          ...state,
          editor: invalidateVoiceSessions(state.editor, ids),
        })
    },
    open: (workspace: Workspace, kind: Editor['context']['kind']) => {
      const context = {
        actorId: actor.id,
        campaignId: workspace.campaign.id,
        playerId: workspace.player.id,
        kind,
      }
      const retained =
        state.pending && sameContext(state.pending.command.context, context)
          ? state.pending.snapshot
          : undefined
      const editor =
        retained ??
        (state.editor && sameContext(state.editor.context, context)
          ? state.editor
          : newEditor(actor, workspace, kind))
      const switched =
        !state.editor || !sameContext(state.editor.context, context)
      publish({
        ...state,
        editor: reconcileContext(editor, actor, workspace),
        ...(switched
          ? { message: '', conflict: undefined, lastSubmission: undefined }
          : {}),
      })
    },
    clearEditor: () =>
      publish({
        ...state,
        editor: undefined,
        conflict: undefined,
        lastSubmission: undefined,
        message: '',
      }),
    detach: () =>
      publish({
        ...state,
        editor: undefined,
        conflict: undefined,
        pending: state.pending
          ? { ...state.pending, detached: true }
          : undefined,
      }),
    start,
    check: async () => {
      const pending = state.pending
      if (!pending || disposed) return
      try {
        const result = await adapter.checkPendingResult(actor, pending.command)
        if (
          state.pending?.command.mutationId !== pending.command.mutationId ||
          disposed
        )
          return
        if (result.status === 'resolved')
          receive(pending.command.mutationId, result.result)
        else
          publish({
            ...state,
            message:
              'Outcome unknown. No confirmed receipt yet. This does not prove that the action failed.',
          })
      } catch {
        if (!disposed)
          publish({
            ...state,
            message: 'The result could not be checked. Retry when connected.',
          })
      }
    },
    reconcile: (workspace: Workspace) => {
      const pending = state.pending
      const editor = state.editor
      if (
        !pending ||
        !editor ||
        !sameContext(editor.context, pending.command.context) ||
        pending.status !== 'resolved' ||
        !pending.result
      )
        return
      const result = pending.result
      if (!result.ok) {
        publish({
          ...state,
          pending: undefined,
          editor: invalidateVoiceSessions(
            reconcileContext(pending.snapshot, actor, workspace),
            [
              ...invalidSessionIds,
              ...(['VOICE_CONTEXT_CHANGED', 'NOT_FOUND'].includes(result.code)
                ? (pending.command.voiceSessionIds ?? [])
                : []),
            ],
          ),
          conflict: ['VERSION_CONFLICT', 'DRAFT_EXISTS'].includes(result.code)
            ? workspace
            : undefined,
          message: `Action not completed (${result.code}). Your text is preserved. Request ${result.requestId}`,
        })
        return
      }
      const commit = result.value
      if (commit.type === 'draft') {
        const saved =
          workspace.draft?.id === commit.draft?.id ? workspace.draft : undefined
        const form = saved ? toForm(saved.content) : pending.snapshot.form
        const next = {
          ...pending.snapshot,
          form,
          baseline: saved ? form : pending.snapshot.baseline,
          draft: saved,
          provenance: saved ? {} : pending.snapshot.provenance,
          comparison: {},
        }
        publish({
          ...state,
          pending: undefined,
          editor: reconcileContext(next, actor, workspace),
          message: saved
            ? 'Draft saved.'
            : 'The committed draft is no longer available. Your local text remains in this tab.',
        })
      } else {
        const next =
          commit.type === 'submission' && commit.entry.kind === 'final'
            ? {
                ...pending.snapshot,
                form: toForm(commit.entry.content),
                baseline: toForm(commit.entry.content),
                draft: undefined,
                provenance: {},
                comparison: {},
              }
            : {
                ...pending.snapshot,
                form: blankForm,
                baseline: blankForm,
                draft: undefined,
                provenance: {},
                comparison: {},
              }
        publish({
          ...state,
          pending: undefined,
          editor: reconcileContext(next, actor, workspace),
          lastSubmission:
            commit.type === 'submission' ? commit.entry.id : undefined,
          message:
            commit.type === 'submission'
              ? 'Feedback submitted.'
              : 'Saved draft discarded.',
        })
      }
    },
    resolveConflict: (loadSaved: boolean) => {
      const editor = state.editor
      const conflict = state.conflict
      if (!editor || !conflict || state.pending) return
      const baseline = conflict.draft
        ? toForm(conflict.draft.content)
        : blankForm
      publish({
        ...state,
        editor: {
          ...editor,
          form: loadSaved ? baseline : editor.form,
          baseline,
          draft: conflict.draft,
          provenance: loadSaved ? {} : editor.provenance,
          comparison: loadSaved ? {} : editor.comparison,
        },
        conflict: undefined,
        message: loadSaved
          ? 'Saved draft loaded.'
          : 'Your edited version is retained. Save draft explicitly to file it.',
      })
    },
    dispose: () => {
      disposed = true
      state = initialState
      listeners.forEach((listener) => listener())
      listeners.clear()
    },
  }
}
export type CoachController = ReturnType<typeof createCoachController>
