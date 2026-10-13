import {
  validateFeedbackText,
  voiceContextMatches,
  type FeedbackKind,
  type FeedbackText,
  type VoiceContextBinding,
} from '../../domain/feedback'
import type { Actor, Context, Draft, Workspace } from './contracts'

export const textFields = [
  'observations',
  'strengths',
  'developmentFocus',
] as const
export type TextField = (typeof textFields)[number]
export type Form = Readonly<Record<TextField, string> & { observedOn: string }>
export type Provenance = Readonly<{
  baseline: string
  bindings: readonly VoiceContextBinding[]
  proposalIds: readonly string[]
}>
export type Editor = Readonly<{
  context: Context
  form: Form
  baseline: Form
  draft: Draft | undefined
  revision: number
  provenance: Readonly<Partial<Record<TextField, Provenance>>>
  comparison: Readonly<Partial<Record<TextField, string>>>
  resumeRequired: boolean
}>
export type Proposal = Readonly<{
  id: string
  binding: VoiceContextBinding
  fields: Readonly<Record<TextField, string>>
}>
export const blankForm: Form = {
  observations: '',
  strengths: '',
  developmentFocus: '',
  observedOn: '',
}
export const toForm = (content: FeedbackText): Form => ({
  observations: content.observations ?? '',
  strengths: content.strengths ?? '',
  developmentFocus: content.developmentFocus ?? '',
  observedOn: content.observedOn ?? '',
})
export const toContent = (form: Form): FeedbackText => ({
  observations: form.observations.trim() || null,
  strengths: form.strengths.trim() || null,
  developmentFocus: form.developmentFocus.trim() || null,
  observedOn: form.observedOn || null,
})
export const kindForStage = (
  stage: Workspace['campaign']['stage'],
): FeedbackKind | undefined =>
  stage === 'preparation'
    ? 'preparation'
    : stage === 'final_feedback'
      ? 'final'
      : undefined
export const sameContext = (a: Context, b: Context) =>
  a.actorId === b.actorId &&
  a.campaignId === b.campaignId &&
  a.playerId === b.playerId &&
  a.kind === b.kind
export const dirty = (editor: Editor) =>
  Object.keys(editor.form).some(
    (key) =>
      editor.form[key as keyof Form] !== editor.baseline[key as keyof Form],
  ) || textFields.some((field) => editor.provenance[field] !== undefined)
export const writable = (workspace: Workspace, kind: FeedbackKind) =>
  workspace.campaign.isActive &&
  kindForStage(workspace.campaign.stage) === kind &&
  (kind === 'preparation'
    ? workspace.player.isActive
    : workspace.player.obligation === 'outstanding')
export const bindingFor = (
  actor: Actor,
  workspace: Workspace,
  kind: FeedbackKind,
): VoiceContextBinding => ({
  callerId: actor.id,
  campaignId: workspace.campaign.id,
  playerId: workspace.player.id,
  kind,
  campaignVersion: workspace.campaign.version,
  callerAccessVersion: actor.accessVersion,
  coachMembershipVersion: workspace.campaign.membershipVersion,
  playerMembershipVersion: workspace.player.membershipVersion,
})
export const newEditor = (
  actor: Actor,
  workspace: Workspace,
  kind: FeedbackKind,
): Editor => {
  const form = workspace.draft ? toForm(workspace.draft.content) : blankForm
  return {
    context: {
      actorId: actor.id,
      campaignId: workspace.campaign.id,
      playerId: workspace.player.id,
      kind,
    },
    form,
    baseline: form,
    draft: workspace.draft,
    revision: 0,
    provenance: {},
    comparison: {},
    resumeRequired: false,
  }
}
export const editField = (
  editor: Editor,
  field: keyof Form,
  value: string,
): Editor => ({
  ...editor,
  form: { ...editor.form, [field]: value },
  revision: editor.revision + 1,
})
export const applyProposal = (
  editor: Editor,
  proposal: Proposal,
  fields: readonly TextField[],
  current: VoiceContextBinding,
  permitted: boolean,
): Editor => {
  if (!voiceContextMatches(proposal.binding, current, permitted)) return editor
  return fields.reduce((value, field) => {
    const old = value.provenance[field]
    return {
      ...value,
      form: { ...value.form, [field]: proposal.fields[field] },
      revision: value.revision + 1,
      provenance: {
        ...value.provenance,
        [field]: {
          baseline: old?.baseline ?? value.form[field],
          bindings: [...(old?.bindings ?? []), proposal.binding],
          proposalIds: [...(old?.proposalIds ?? []), proposal.id],
        },
      },
    }
  }, editor)
}
export const invalidateVoice = (
  editor: Editor,
  binding: VoiceContextBinding,
  permitted: boolean,
  canRead: boolean,
): Editor =>
  textFields.reduce((value, field) => {
    const source = value.provenance[field]
    if (
      !source ||
      source.bindings.every((item) =>
        voiceContextMatches(item, binding, permitted),
      )
    )
      return value
    return {
      ...value,
      form: { ...value.form, [field]: source.baseline },
      revision: value.revision + 1,
      provenance: { ...value.provenance, [field]: undefined },
      comparison: canRead
        ? { ...value.comparison, [field]: value.form[field] }
        : {},
    }
  }, editor)
export const reconcileContext = (
  editor: Editor,
  actor: Actor,
  workspace: Workspace,
): Editor => {
  const allowed = writable(workspace, editor.context.kind)
  const next = invalidateVoice(
    editor,
    bindingFor(actor, workspace, editor.context.kind),
    allowed,
    true,
  )
  return {
    ...next,
    draft: workspace.draft?.id === editor.draft?.id ? editor.draft : undefined,
    resumeRequired: next.resumeRequired || !allowed,
  }
}
export const singaporeToday = (instant = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
export type FieldErrors = Readonly<Partial<Record<keyof Form, string>>>
export const validateForm = (
  form: Form,
  complete: boolean,
  today: string,
): FieldErrors => {
  const errors: Partial<Record<keyof Form, string>> = {}
  for (const field of textFields)
    if (
      Array.from(form[field]).length > (field === 'observations' ? 10000 : 5000)
    )
      errors[field] =
        `Use at most ${field === 'observations' ? '10,000' : '5,000'} characters.`
  if (complete && !form.observations.trim())
    errors.observations = 'Enter your observations.'
  if (complete && !form.observedOn)
    errors.observedOn = 'Choose the observation date.'
  if (
    form.observedOn &&
    (!validateFeedbackText(
      toContent({ ...blankForm, observedOn: form.observedOn }),
      false,
    ).ok ||
      form.observedOn > today)
  )
    errors.observedOn = 'Choose a valid date no later than today in Singapore.'
  return errors
}
export const playerReference = (id: string, loadedIds: readonly string[]) =>
  loadedIds.filter((other) => other.slice(0, 8) === id.slice(0, 8)).length > 1
    ? id
    : id.slice(0, 8)
export const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00Z`))
    : 'No date'
export const formatInstant = (value: string) =>
  `${new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' }).format(new Date(value))} SGT`
