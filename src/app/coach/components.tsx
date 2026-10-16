import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Entry, HistorySummary } from './contracts'
import {
  formatDate,
  formatInstant,
  textFields,
  type Editor,
  type Proposal,
  type TextField,
} from './editor'
import styles from './coach.module.css'
import { fieldLabels } from './labels'

export function StatusBanner({
  children,
  urgent = false,
}: Readonly<{ children: ReactNode; urgent?: boolean }>) {
  return (
    <div className={styles.banner} role={urgent ? 'alert' : 'status'}>
      {children}
    </div>
  )
}
export function AsyncState({
  title,
  children,
  retry,
}: Readonly<{ title: string; children?: ReactNode; retry?: () => void }>) {
  return (
    <section className={styles.empty}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {retry && (
        <button type="button" onClick={retry}>
          Retry
        </button>
      )}
    </section>
  )
}
export function Dialog({
  title,
  children,
  close,
}: Readonly<{ title: string; children: ReactNode; close: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const invoker =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[data-safe-focus]')?.focus()
    return () => {
      dialog.close()
      if (invoker?.isConnected) invoker.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={styles.dialog}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length > 0)
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  )
}
export function FeedbackTabs({
  tab,
  change,
}: Readonly<{
  tab: 'write' | 'history'
  change: (tab: 'write' | 'history') => void
}>) {
  const refs = useRef<Partial<Record<'write' | 'history', HTMLButtonElement>>>(
    {},
  )
  const [focusState, setFocusState] = useState({ tab, value: tab })
  const focused = focusState.tab === tab ? focusState.value : tab
  const setFocused = (value: 'write' | 'history') =>
    setFocusState({ tab, value })
  return (
    <div className={styles.tabs} role="tablist" aria-label="Player feedback">
      {(['write', 'history'] as const).map((value) => (
        <button
          key={value}
          ref={(element) => {
            if (element) refs.current[value] = element
          }}
          type="button"
          role="tab"
          id={`${value}-tab`}
          aria-controls={`${value}-panel`}
          aria-selected={tab === value}
          tabIndex={focused === value ? 0 : -1}
          onFocus={() => setFocused(value)}
          onClick={() => change(value)}
          onKeyDown={(event) => {
            const target =
              event.key === 'Home'
                ? 'write'
                : event.key === 'End'
                  ? 'history'
                  : ['ArrowLeft', 'ArrowRight'].includes(event.key)
                    ? value === 'write'
                      ? 'history'
                      : 'write'
                    : undefined
            if (target) {
              event.preventDefault()
              setFocused(target)
              refs.current[target]?.focus()
            }
          }}
        >
          {value === 'write' ? 'Write feedback' : 'History'}
        </button>
      ))}
    </div>
  )
}
export function ContentReview({
  content,
}: Readonly<{ content: Editor['form'] }>) {
  return (
    <dl className={styles.feedbackText}>
      <dt>Observation date</dt>
      <dd>{formatDate(content.observedOn || null)}</dd>
      {textFields.map((field) => (
        <div key={field}>
          <dt>{fieldLabels[field]}</dt>
          <dd>{content[field] || 'Not provided'}</dd>
        </div>
      ))}
    </dl>
  )
}
export function FeedbackHistory({
  summaries,
  loadEntry,
}: Readonly<{
  summaries: readonly HistorySummary[]
  loadEntry: (feedbackId: string) => Promise<Entry | undefined>
}>) {
  const [expanded, setExpanded] = useState<
    Readonly<Record<string, Entry | 'loading' | 'failed'>>
  >({})
  const toggle = async (summary: HistorySummary) => {
    if (expanded[summary.id] && expanded[summary.id] !== 'loading') {
      setExpanded((value) => {
        const next = { ...value }
        delete next[summary.id]
        return next
      })
      return
    }
    setExpanded((value) => ({ ...value, [summary.id]: 'loading' }))
    const entry = await loadEntry(summary.id)
    setExpanded((value) => ({
      ...value,
      [summary.id]: entry ?? 'failed',
    }))
  }
  const renderText = (content: Entry['content']) => (
    <dl className={styles.feedbackText}>
      <dt>Observation date</dt>
      <dd>{formatDate(content.observedOn)}</dd>
      {textFields.map((field) => (
        <div key={field}>
          <dt>{fieldLabels[field]}</dt>
          <dd>{content[field] ?? 'Not provided'}</dd>
        </div>
      ))}
    </dl>
  )
  return (
    <ol className={styles.history}>
      {summaries.map((summary) => {
        const detail = expanded[summary.id]
        const open = Boolean(detail && detail !== 'loading')
        return (
          <li
            key={summary.id}
            id={`submission-${summary.id}`}
            className={styles.card}
          >
            <div className={styles.sectionHeader}>
              <h3>
                {summary.kind === 'preparation'
                  ? 'Preparation feedback'
                  : 'Final assessment'}
              </h3>
              <span className={styles.badge}>Submitted</span>
            </div>
            <p className={styles.support}>
              Observed {formatDate(summary.observedOn)} · Submitted{' '}
              {formatInstant(summary.submittedAt)}
            </p>
            <p className={styles.plainText}>
              {summary.preview || 'No preview'}
            </p>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`history-detail-${summary.id}`}
              onClick={() => void toggle(summary)}
            >
              {open ? 'Hide full feedback' : 'Show full feedback'}
            </button>
            {detail === 'loading' && (
              <p role="status">Loading full feedback…</p>
            )}
            {detail === 'failed' && (
              <p role="alert">Full feedback could not be loaded.</p>
            )}
            {detail && detail !== 'loading' && detail !== 'failed' && (
              <div id={`history-detail-${summary.id}`}>
                <p className={styles.support}>Original submitted feedback</p>
                {renderText(detail.content)}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
export type VoiceState =
  | 'idle'
  | 'requesting_microphone'
  | 'listening'
  | 'assistant_speaking'
  | 'processing'
  | 'proposal_ready'
  | 'cancelled'
  | 'failed'
export type VoiceAdapter = Readonly<{
  evidence: 'fixture' | 'live'
  state: VoiceState
  proposal: Proposal | undefined
  start: () => void
  stop: () => void
  cancel: () => void
  caption?: string
  message?: string
  remainingSeconds?: number
  startUnavailable?: boolean
}>
// Isolated UI tests may inject this simulated adapter. Public routes never do.
export function VoicePanel({
  adapter,
  editor,
  locked,
  apply,
}: Readonly<{
  adapter: VoiceAdapter
  editor: Editor
  locked: boolean
  apply: (proposal: Proposal, fields: readonly TextField[]) => void
}>) {
  const [selection, setSelection] = useState<
    Readonly<{ proposalId: string | undefined; fields: readonly TextField[] }>
  >({ proposalId: undefined, fields: [] })
  const [acknowledged, setAcknowledged] = useState(false)
  const selected =
    selection.proposalId === adapter.proposal?.id ? selection.fields : []
  const setSelected = (fields: readonly TextField[]) =>
    setSelection({ proposalId: adapter.proposal?.id, fields })
  const labels: Readonly<Record<VoiceState, string>> = {
    idle: 'Ready to start',
    requesting_microphone: 'Requesting microphone',
    listening: 'Listening',
    assistant_speaking: 'Assistant speaking',
    processing: 'Preparing proposed text',
    proposal_ready: 'Proposal ready for review',
    cancelled: 'Conversation cancelled, nothing filed',
    failed: 'Voice unavailable. You can continue writing.',
  }
  return (
    <section className={styles.card} aria-label="Speak feedback">
      <h3>Speak feedback</h3>
      <p>
        {adapter.evidence === 'fixture'
          ? 'Simulated voice, fixture evidence only. '
          : ''}
        {editor.context.kind === 'final'
          ? 'Final assessment'
          : 'Preparation observation'}{' '}
        for reference {editor.context.playerId.slice(0, 8)}.
      </p>
      <p role="status">{labels[adapter.state]}</p>
      {adapter.evidence === 'live' && (
        <>
          <p>
            Your speech is sent to ElevenLabs to prepare text for your review.
            Audio saving is off. Conversation text is scheduled for deletion.
            Only share observations you are authorised to share.
          </p>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />{' '}
            I understand and am authorised to share these observations.
          </label>
          {adapter.caption && (
            <p aria-live="polite" className={styles.plainText}>
              {adapter.caption}
            </p>
          )}
          {adapter.message && <p role="status">{adapter.message}</p>}
          {adapter.remainingSeconds !== undefined && (
            <p>Time remaining: {adapter.remainingSeconds} seconds</p>
          )}
        </>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          onClick={() => {
            adapter.start()
            setAcknowledged(false)
          }}
          disabled={
            locked ||
            adapter.startUnavailable ||
            (adapter.evidence === 'live' && !acknowledged) ||
            !['idle', 'failed', 'cancelled', 'proposal_ready'].includes(
              adapter.state,
            )
          }
        >
          Start conversation
        </button>
        <button
          type="button"
          onClick={adapter.stop}
          disabled={
            !['listening', 'assistant_speaking'].includes(adapter.state)
          }
        >
          {adapter.evidence === 'live' ? 'Finish and review' : 'Stop'}
        </button>
        <button type="button" onClick={adapter.cancel}>
          Cancel conversation
        </button>
      </div>
      {adapter.proposal && (
        <fieldset disabled={locked}>
          <legend>Compare proposed text</legend>
          {textFields.map((field) => (
            <div key={field}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(field)}
                  disabled={
                    adapter.evidence === 'live' &&
                    !adapter.proposal?.fields[field]
                  }
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, field]
                        : selected.filter((value) => value !== field),
                    )
                  }
                />{' '}
                Apply {fieldLabels[field]}
              </label>
              <div className={styles.comparison}>
                <section>
                  <h4>Current form</h4>
                  <p className={styles.plainText}>
                    {editor.form[field] || 'Blank'}
                  </p>
                </section>
                <section>
                  <h4>Proposed text</h4>
                  <p className={styles.plainText}>
                    {adapter.proposal!.fields[field]}
                  </p>
                </section>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={!selected.length || locked}
            onClick={() => {
              apply(adapter.proposal!, selected)
              setSelected([])
            }}
          >
            Apply selected fields
          </button>
          <p>
            Applying changes your form. Saving and submitting are separate
            actions. Your observation date stays the same.
          </p>
        </fieldset>
      )}
    </section>
  )
}
