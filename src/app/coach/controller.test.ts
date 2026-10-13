import { describe, expect, it } from 'vitest'
import { createCoachController } from './controller'
import {
  createFixtureAdapter,
  sampleActor,
  sampleCampaignId,
  samplePlayerId,
} from './fixtures'
import {
  applyProposal,
  bindingFor,
  editField,
  invalidateVoice,
  kindForStage,
  newEditor,
  reconcileContext,
  singaporeToday,
  validateForm,
  playerReference,
} from './editor'
import type { CoachAdapter, Commit, DataResult, Workspace } from './contracts'
import { validatePublicConfiguration } from './configuration'

const fixture = () => createFixtureAdapter({ wait: async () => {} })
const load = async (
  adapter: CoachAdapter,
  campaignId = sampleCampaignId,
  playerId = samplePlayerId,
): Promise<Workspace> => {
  const result = await adapter.loadWorkspace(
    sampleActor,
    campaignId,
    playerId,
    undefined,
    new AbortController().signal,
  )
  if (!result.ok) throw new Error(result.code)
  return result.value
}
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
describe('coach state contracts, synthetic evidence', () => {
  it('checks access before dispatch and never carries a previous player success into another context', async () => {
    const { adapter } = fixture()
    const controller = createCoachController(sampleActor, adapter)
    controller.open(await load(adapter), 'preparation')
    controller.updateEditor(
      editField(
        controller.getSnapshot().editor!,
        'observations',
        'Sample saved draft',
      ),
    )
    await controller.start('save')
    controller.reconcile(await load(adapter))
    controller.open(
      await load(
        adapter,
        sampleCampaignId,
        'a0000001-0000-4000-8000-000000000002',
      ),
      'preparation',
    )
    expect(controller.getSnapshot().message).toBe('')
    expect(controller.getSnapshot().lastSubmission).toBeUndefined()
    let dispatched = false
    const denied = createCoachController(sampleActor, {
      ...adapter,
      getAccess: async () => ({
        ok: false,
        code: 'FORBIDDEN',
        requestId: 'sample-request',
      }),
      mutate: async () => {
        dispatched = true
        return { ok: false, code: 'NETWORK_ERROR', requestId: 'sample-request' }
      },
    })
    denied.open(await load(adapter), 'preparation')
    await denied.start('save')
    expect(dispatched).toBe(false)
    expect(denied.getSnapshot().pending?.status).toBe('resolved')
  })
  it('freezes immediately, rejects competing writes and retains a late result across departure', async () => {
    const { adapter } = fixture()
    const response = deferred<DataResult<Commit>>()
    const controlled = { ...adapter, mutate: async () => response.promise }
    const controller = createCoachController(sampleActor, controlled)
    const workspace = await load(adapter)
    controller.open(workspace, 'preparation')
    const edited = editField(
      controller.getSnapshot().editor!,
      'observations',
      'Sample frozen intent',
    )
    controller.updateEditor(edited)
    const action = controller.start('save')
    const pending = controller.getSnapshot().pending!
    expect(pending.snapshot.form.observations).toBe('Sample frozen intent')
    controller.updateEditor(editField(edited, 'observations', 'Later typing'))
    expect(controller.getSnapshot().editor!.form.observations).toBe(
      'Sample frozen intent',
    )
    expect(await controller.start('submit')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.detach()
    controller.open(
      await load(
        adapter,
        sampleCampaignId,
        'a0000001-0000-4000-8000-000000000002',
      ),
      'preparation',
    )
    const committed = await adapter.mutate(sampleActor, pending.command)
    response.resolve(committed)
    await action
    expect(controller.getSnapshot().editor!.context.playerId).not.toBe(
      samplePlayerId,
    )
    expect(controller.getSnapshot().editor!.form.observations).toBe('')
    expect(controller.getSnapshot().pending!.command.mutationId).toBe(
      pending.command.mutationId,
    )
    const current = await load(adapter)
    controller.open(current, 'preparation')
    controller.reconcile(current)
    expect(controller.getSnapshot().pending).toBeUndefined()
    expect(controller.getSnapshot().editor!.draft).toEqual(current.draft)
  })
  it('does not resurrect a disposed actor when a mutation responds', async () => {
    const { adapter } = fixture()
    const response = deferred<DataResult<Commit>>()
    const controller = createCoachController(sampleActor, {
      ...adapter,
      mutate: async () => response.promise,
    })
    controller.open(await load(adapter), 'preparation')
    const action = controller.start('save')
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.dispose()
    response.resolve({ ok: false, code: 'NETWORK_ERROR', requestId: 'ignored' })
    await action
    expect(controller.getSnapshot().pending).toBeUndefined()
    expect(controller.getSnapshot().editor).toBeUndefined()
  })
  it('keeps an absent receipt unknown and reconciles a lost committed reply using its original ID', async () => {
    const { adapter } = fixture()
    let receiptVisible = false
    const controller = createCoachController(sampleActor, {
      ...adapter,
      mutate: async (actor, command) => {
        await adapter.mutate(actor, command)
        return {
          ok: false,
          code: 'NETWORK_ERROR',
          requestId: command.mutationId,
        }
      },
      checkPendingResult: async (actor, command) =>
        receiptVisible
          ? adapter.checkPendingResult(actor, command)
          : { status: 'unknown' },
    })
    controller.open(await load(adapter), 'preparation')
    controller.updateEditor(
      editField(
        controller.getSnapshot().editor!,
        'observations',
        'Sample lost reply',
      ),
    )
    await controller.start('save')
    const originalId = controller.getSnapshot().pending!.command.mutationId
    await controller.check()
    expect(controller.getSnapshot().pending!.status).toBe('unknown')
    receiptVisible = true
    await controller.check()
    controller.reconcile(await load(adapter))
    expect(controller.getSnapshot().pending).toBeUndefined()
    expect(controller.getSnapshot().editor!.draft?.content.observations).toBe(
      'Sample lost reply',
    )
    expect(originalId).toMatch(/^[a-f0-9-]{36}$/)
  })
  it('preserves local edits on version conflict and requires explicit reconciliation and resave', async () => {
    const data = fixture()
    const controller = createCoachController(sampleActor, data.adapter)
    controller.open(await load(data.adapter), 'preparation')
    controller.updateEditor(
      editField(
        controller.getSnapshot().editor!,
        'observations',
        'Sample local text',
      ),
    )
    data.setDraft(controller.getSnapshot().editor!.context, {
      id: crypto.randomUUID(),
      version: 2,
      content: {
        observations: 'Sample newer saved draft',
        strengths: null,
        developmentFocus: null,
        observedOn: null,
      },
    })
    await controller.start('save')
    controller.reconcile(await load(data.adapter))
    expect(controller.getSnapshot().editor!.form.observations).toBe(
      'Sample local text',
    )
    expect(controller.getSnapshot().conflict?.draft?.version).toBe(2)
    expect(await controller.start('save')).toBe(false)
    controller.resolveConflict(false)
    await controller.start('save')
    controller.reconcile(await load(data.adapter))
    expect(controller.getSnapshot().editor!.draft?.version).toBe(3)
    expect(controller.getSnapshot().editor!.form.observations).toBe(
      'Sample local text',
    )
  })
  it('keeps the original preparation phase and never moves old text into final feedback', async () => {
    const data = fixture()
    const original = await load(data.adapter)
    const edited = editField(
      newEditor(sampleActor, original, 'preparation'),
      'observations',
      'Sample original preparation',
    )
    data.setCampaign(sampleCampaignId, {
      stage: 'final_feedback',
      frozen: true,
    })
    const current = await load(data.adapter)
    const retained = reconcileContext(edited, sampleActor, current)
    expect(retained.context.kind).toBe('preparation')
    expect(retained.form.observations).toBe('Sample original preparation')
    expect(retained.resumeRequired).toBe(true)
    expect(kindForStage(current.campaign.stage)).toBe('final')
    expect(newEditor(sampleActor, current, 'final').form).toEqual({
      observations: '',
      strengths: '',
      developmentFocus: '',
      observedOn: '',
    })
  })
  it('restores the manual baseline after multiple voice applications and subsequent typing', async () => {
    const { adapter } = fixture()
    const workspace = await load(adapter)
    const binding = bindingFor(sampleActor, workspace, 'preparation')
    let editor = editField(
      newEditor(sampleActor, workspace, 'preparation'),
      'observations',
      'Sample manual baseline',
    )
    editor = editField(editor, 'strengths', 'Sample untouched strength')
    const proposal = {
      id: 'sample-proposal-1',
      binding,
      fields: {
        observations: 'Sample voice text',
        strengths: 'Sample proposed strength',
        developmentFocus: '',
      },
    }
    editor = applyProposal(editor, proposal, ['observations'], binding, true)
    editor = editField(editor, 'observations', 'Sample mixed typing')
    editor = applyProposal(
      editor,
      {
        ...proposal,
        id: 'sample-proposal-2',
        fields: {
          ...proposal.fields,
          observations: 'Sample second voice text',
        },
      },
      ['observations'],
      binding,
      true,
    )
    editor = editField(editor, 'observations', 'Sample final mixed text')
    expect(editor.provenance.observations?.proposalIds).toHaveLength(2)
    const restored = invalidateVoice(
      editor,
      { ...binding, campaignVersion: 2 },
      true,
      true,
    )
    expect(restored.form.observations).toBe('Sample manual baseline')
    expect(restored.comparison.observations).toBe('Sample final mixed text')
    expect(restored.form.strengths).toBe('Sample untouched strength')
    expect(restored.form.observedOn).toBe('')
    expect(invalidateVoice(editor, binding, false, false).comparison).toEqual(
      {},
    )
  })
  it('files a reviewed draft as the new baseline and removes unfiled provenance', async () => {
    const { adapter } = fixture()
    const workspace = await load(adapter)
    const controller = createCoachController(sampleActor, adapter)
    controller.open(workspace, 'preparation')
    const binding = bindingFor(sampleActor, workspace, 'preparation')
    controller.updateEditor(
      applyProposal(
        controller.getSnapshot().editor!,
        {
          id: 'sample-proposal',
          binding,
          fields: {
            observations: 'Sample reviewed voice',
            strengths: '',
            developmentFocus: '',
          },
        },
        ['observations'],
        binding,
        true,
      ),
    )
    await controller.start('save')
    controller.reconcile(await load(adapter))
    expect(controller.getSnapshot().editor!.provenance).toEqual({})
    expect(controller.getSnapshot().editor!.baseline.observations).toBe(
      'Sample reviewed voice',
    )
  })
  it('does not claim that a purged draft receipt is a current saved draft', async () => {
    const data = fixture()
    const controller = createCoachController(sampleActor, data.adapter)
    controller.open(await load(data.adapter), 'preparation')
    controller.updateEditor(
      editField(
        controller.getSnapshot().editor!,
        'observations',
        'Sample local draft',
      ),
    )
    await controller.start('save')
    data.setCampaign(sampleCampaignId, { stage: 'competition' })
    await controller.check()
    controller.reconcile(await load(data.adapter))
    expect(controller.getSnapshot().editor!.draft).toBeUndefined()
    expect(controller.getSnapshot().message).toContain('no longer available')
    expect(controller.getSnapshot().editor!.resumeRequired).toBe(true)
  })
  it('uses Singapore dates across midnight and accepts incomplete drafts only', () => {
    expect(singaporeToday(new Date('2026-10-11T16:01:00Z'))).toBe('2026-10-12')
    const form = {
      observations: '',
      strengths: 'Sample draft',
      developmentFocus: '',
      observedOn: '',
    }
    expect(validateForm(form, false, '2026-10-12')).toEqual({})
    expect(validateForm(form, true, '2026-10-12')).toHaveProperty('observedOn')
    expect(
      validateForm({ ...form, observedOn: '2026-10-13' }, false, '2026-10-12'),
    ).toHaveProperty('observedOn')
    expect(
      validateForm({ ...form, observedOn: '2026-02-30' }, false, '2026-10-12'),
    ).toHaveProperty('observedOn')
  })
  it('expands collisions and refuses a preview configuration with live capabilities', () => {
    expect(
      playerReference(samplePlayerId, [
        samplePlayerId,
        'a0000001-0000-4000-8000-000000000002',
      ]),
    ).toBe(samplePlayerId)
    expect(playerReference(samplePlayerId, [samplePlayerId])).toBe('a0000001')
    expect(
      validatePublicConfiguration({
        appEnv: 'preview',
        appOrigin: 'http://127.0.0.1:5173',
        releaseId: 'sample',
        voiceEnabled: true,
        supabaseUrl: null,
        supabasePublicKey: null,
      }),
    ).toBeUndefined()
  })
})
