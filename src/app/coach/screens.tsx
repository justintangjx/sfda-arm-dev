import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  useBlocker,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router'
import { isUuid, type FeedbackKind } from '../../domain/feedback'
import type { Campaign, Player } from './contracts'
import {
  AsyncState,
  ContentReview,
  Dialog,
  FeedbackHistory,
  FeedbackTabs,
  StatusBanner,
} from './components'
import { campaignPath, fieldLabels, playerPath, stageLabels } from './labels'
import {
  blankForm,
  dirty,
  editField,
  kindForStage,
  newEditor,
  playerReference,
  singaporeToday,
  textFields,
  toForm,
  validateForm,
  writable,
  type FieldErrors,
} from './editor'
import { useConnectivity, usePages, useRead } from './hooks'
import { performAction, useCoach, useCoachState, useRuntime } from './runtime'
import styles from './coach.module.css'

const unavailable = (code: string) =>
  ['NOT_FOUND', 'FORBIDDEN', 'AUTH_REQUIRED'].includes(code)

export function CoachShell() {
  const runtime = useRuntime()
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to main content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link
            className={styles.wordmark}
            to={
              runtime.access?.role === 'admin'
                ? '/admin/setup'
                : runtime.access?.role === 'player'
                  ? '/account'
                  : '/coach'
            }
          >
            SFDA Coaches
          </Link>
          {runtime.actor && <AccountControls />}
        </div>
      </header>
      {runtime.configuration.appEnv === 'preview' && (
        <div className={styles.preview}>
          <strong>Preview: sample data</strong>. Changes are temporary. No real
          accounts or voice recording.
        </div>
      )}
      <main id="main" tabIndex={-1} className={styles.container}>
        {runtime.actor && <WorkStatus />}
        <Outlet />
        <footer className={styles.footer}>
          SFDA coach workspace. Your observations, reviewed by you.
        </footer>
      </main>
    </>
  )
}
function AccountControls() {
  const runtime = useCoach()
  const { refreshAccess, refresh } = runtime
  const state = useCoachState()
  const online = useConnectivity()
  const [signOutOpen, setSignOutOpen] = useState(false)
  const attempt = useRef(0)
  const location = useLocation()
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname &&
      Boolean(state.pending || (state.editor && dirty(state.editor))),
  )
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    if (state.pending || (state.editor && dirty(state.editor)))
      window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state.pending, state.editor])
  useEffect(() => {
    const refresh = () => {
      void refreshAccess().then((valid) => {
        if (valid) refresh()
      })
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [refreshAccess, refresh])
  useEffect(() => {
    document.title = location.pathname.includes('/players/')
      ? 'Player feedback | SFDA Coaches'
      : location.pathname.includes('/campaigns/')
        ? 'Campaign roster | SFDA Coaches'
        : 'Your campaigns | SFDA Coaches'
  }, [location.pathname])
  const close = () => {
    attempt.current++
    setSignOutOpen(false)
    if (blocker.state === 'blocked') blocker.reset()
  }
  const leave = () => {
    attempt.current++
    if (state.pending) runtime.controller.detach()
    else runtime.controller.clearEditor()
    if (signOutOpen) {
      runtime.signOut()
      setSignOutOpen(false)
    } else if (blocker.state === 'blocked') blocker.proceed()
  }
  const saveAndLeave = async () => {
    const token = ++attempt.current
    const saved = await performAction(runtime, 'save')
    if (token !== attempt.current || !saved) return
    leave()
  }
  return (
    <>
      <div className={styles.account}>
        <span>{runtime.actor.displayName}</span>
        <button
          type="button"
          onClick={() => {
            if (state.pending || (state.editor && dirty(state.editor)))
              setSignOutOpen(true)
            else runtime.signOut()
          }}
        >
          Sign out
        </button>
      </div>
      {(blocker.state === 'blocked' || signOutOpen) && (
        <Dialog
          title={
            state.pending
              ? 'Work action unresolved'
              : signOutOpen
                ? 'Sign out with unsaved edits?'
                : 'Save your changes?'
          }
          close={close}
        >
          <p>
            {state.pending
              ? signOutOpen
                ? 'The action may still complete. Signing out loses its recovery state and does not cancel the transaction.'
                : 'The action may still complete. You can leave and return to check its result.'
              : 'Your unsaved text is held in this tab. Discarding local edits keeps any previously saved draft.'}
          </p>
          {!online && <p>Offline. Draft saving is unavailable.</p>}
          {state.editor?.resumeRequired && (
            <p>This original phase or assignment no longer allows saving.</p>
          )}
          <div className={styles.actions}>
            <button type="button" data-safe-focus onClick={close}>
              Stay
            </button>
            {state.pending ? (
              <button type="button" onClick={leave}>
                {signOutOpen ? 'Sign out and lose recovery state' : 'Leave'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={
                    !online || state.editor?.resumeRequired || !state.editor
                  }
                  onClick={() => {
                    void saveAndLeave()
                  }}
                >
                  {signOutOpen
                    ? 'Save draft and sign out'
                    : 'Save draft and switch'}
                </button>
                <button type="button" className={styles.danger} onClick={leave}>
                  {signOutOpen ? 'Discard local edits and sign out' : 'Discard'}
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
function WorkStatus() {
  const { controller } = useCoach()
  const state = useCoachState()
  const online = useConnectivity()
  return (
    <>
      {!online && (
        <StatusBanner>
          Offline, unsaved edits remain in this tab. Saving, submitting and
          voice are unavailable.
        </StatusBanner>
      )}
      {state.pending && (
        <StatusBanner>
          <p>
            {state.pending.status === 'unknown'
              ? 'Outcome unknown'
              : state.pending.status === 'resolved'
                ? 'Work action needs reconciliation'
                : 'Work action pending'}
            . Other feedback actions remain unavailable.
          </p>
          <p className={styles.support}>
            Request {state.pending.command.mutationId}
          </p>
          <Link
            to={playerPath(
              state.pending.command.context.campaignId,
              state.pending.command.context.playerId,
            )}
          >
            Return to feedback
          </Link>
          {state.pending.status !== 'pending' && (
            <button
              type="button"
              disabled={!online}
              onClick={() => {
                void controller.check()
              }}
            >
              Check result
            </button>
          )}
        </StatusBanner>
      )}
    </>
  )
}
export function Login() {
  const runtime = useRuntime()
  const navigate = useNavigate()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    document.title = 'Sign in | SFDA Coaches'
  }, [])
  return (
    <div className={styles.login}>
      <section className={styles.loginCopy}>
        <p className={styles.eyebrow}>A focused place for coach feedback</p>
        <h1>Observe. Reflect. Help your players grow.</h1>
        <p>
          Choose your campaign, find a player and record what you noticed.
          Preparation observations and final assessments stay distinct.
        </p>
        <p className={styles.support}>
          Access is prepared by your admin. There is no public registration.
        </p>
      </section>
      <section className={styles.card}>
        <h2>Sign in</h2>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            if (busy || runtime.configuration.appEnv === 'preview') return
            const form = new FormData(event.currentTarget)
            const email = form.get('email')
            const password = form.get('password')
            if (typeof email !== 'string' || typeof password !== 'string')
              return
            setBusy(true)
            setError('')
            void runtime.login(email.trim(), password).then((result) => {
              if (!alive.current) return
              setBusy(false)
              if (result.ok)
                navigate(
                  result.value.role === 'admin'
                    ? '/admin/setup'
                    : result.value.role === 'player'
                      ? '/account'
                      : '/coach',
                  { replace: true },
                )
              else
                setError(
                  result.code === 'FORBIDDEN'
                    ? 'Account access is unavailable. You can ask your admin for help.'
                    : result.code === 'NETWORK_ERROR'
                      ? 'Sign in could not be confirmed. Check your connection and try again.'
                      : 'Email or password was not accepted.',
                )
            })
          }}
        >
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              required
              disabled={busy}
            />
            <button
              type="button"
              aria-pressed={show}
              onClick={() => setShow((value) => !value)}
            >
              {show ? 'Hide password' : 'Show password'}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          <button
            type="submit"
            className={styles.primary}
            disabled={busy || runtime.configuration.appEnv === 'preview'}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p role="status">
            {runtime.configuration.appEnv === 'preview'
              ? 'Preview does not accept real credentials. Open the sample workspace below.'
              : 'Use the password you chose from your account setup email.'}
          </p>
          {runtime.configuration.appEnv === 'preview' && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                runtime.enterPreview()
                navigate('/coach')
              }}
            >
              Open sample workspace
            </button>
          )}
        </form>
      </section>
    </div>
  )
}
export function RequireCoach() {
  const runtime = useRuntime()
  if (runtime.access && runtime.access.role !== 'coach')
    return (
      <Navigate
        to={runtime.access.role === 'admin' ? '/admin/setup' : '/account'}
        replace
      />
    )
  return runtime.actor && runtime.adapter && runtime.controller ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace />
  )
}
export function CampaignList() {
  const { actor, adapter, revision } = useCoach()
  const load = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      adapter.loadCampaigns(actor, cursor, signal),
    [actor, adapter],
  )
  const page = usePages(load, revision)
  return (
    <>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Your coach workspace</p>
        <h1>Your campaigns</h1>
        <p>
          Choose a team and competition to review your players and record
          feedback.
        </p>
      </div>
      {!page.loaded && page.loading && (
        <StatusBanner>Loading your campaigns…</StatusBanner>
      )}
      {page.error && (
        <AsyncState title="Campaigns could not be loaded" retry={page.more}>
          {page.error.code}, request {page.error.requestId}
        </AsyncState>
      )}
      {page.loaded && !page.rows.length && (
        <AsyncState title="No campaigns assigned">
          Contact your admin.
        </AsyncState>
      )}
      <ul className={styles.cards}>
        {page.rows.map((campaign) => (
          <li key={campaign.id} className={styles.card}>
            <span className={styles.badge}>{stageLabels[campaign.stage]}</span>
            <Link
              className={styles.campaignLink}
              to={campaignPath(campaign.id)}
            >
              {campaign.name}
            </Link>
            <dl className={styles.metadata}>
              <dt>Team</dt>
              <dd>{campaign.team}</dd>
              <dt>Competition</dt>
              <dd>{campaign.competition}</dd>
            </dl>
            <p className={styles.support}>
              {campaign.isActive ? 'Current assignment' : 'Historical access'}
            </p>
          </li>
        ))}
      </ul>
      {page.cursor && (
        <div className={styles.paging}>
          <button type="button" onClick={page.more} disabled={page.loading}>
            Load more campaigns
          </button>
        </div>
      )}
    </>
  )
}
type CampaignOutlet = Readonly<{
  campaign: Campaign
  players: readonly Player[]
}>
export function CampaignRoute() {
  const { campaignId } = useParams()
  if (!isUuid(campaignId)) return <UnavailableWorkspace />
  return <CampaignWorkspace key={campaignId} campaignId={campaignId} />
}
function UnavailableWorkspace() {
  return (
    <>
      <AsyncState title="This workspace is unavailable">
        Choose one of your assigned campaigns.
      </AsyncState>
      <Link to="/coach">Back to campaigns</Link>
    </>
  )
}
function CampaignWorkspace({ campaignId }: Readonly<{ campaignId: string }>) {
  const { actor, adapter, revision } = useCoach()
  const { playerId } = useParams()
  const location = useLocation()
  const previousPlayer = useRef<string | undefined>(undefined)
  const campaignRead = useRead(
    useCallback(
      (signal: AbortSignal) => adapter.loadCampaign(actor, campaignId, signal),
      [actor, adapter, campaignId],
    ),
    revision,
  )
  const roster = usePages(
    useCallback(
      (cursor: string | undefined, signal: AbortSignal) =>
        adapter.loadRoster(actor, campaignId, cursor, signal),
      [actor, adapter, campaignId],
    ),
    revision,
  )
  const completion = useRead(
    useCallback(
      (signal: AbortSignal) =>
        adapter.loadCompletion(actor, campaignId, signal),
      [actor, adapter, campaignId],
    ),
    revision,
  )
  useEffect(() => {
    if (playerId) previousPlayer.current = playerId
    else if (previousPlayer.current && roster.loaded)
      document.getElementById(`roster-${previousPlayer.current}`)?.focus()
  }, [playerId, location.pathname, roster.loaded])
  if (campaignRead.loading)
    return <StatusBanner>Loading campaign context…</StatusBanner>
  if (campaignRead.error)
    return unavailable(campaignRead.error.code) ? (
      <UnavailableWorkspace />
    ) : (
      <AsyncState
        title="Campaign could not be loaded"
        retry={campaignRead.retry}
      >
        {campaignRead.error.code}, request {campaignRead.error.requestId}
      </AsyncState>
    )
  const campaign = campaignRead.value!
  return (
    <>
      <section className={styles.context}>
        <Link to="/coach">Back to campaigns</Link>
        <h1>{campaign.name}</h1>
        <p>
          {campaign.team} · {campaign.competition}
        </p>
        <span className={styles.badge}>{stageLabels[campaign.stage]}</span>
        <p className={styles.support}>
          {campaign.isActive
            ? 'Current assignment'
            : 'Historical access, feedback is read only'}
        </p>
        {completion.value?.scope === 'self' && (
          <p className={styles.support}>
            {completion.value.frozen
              ? `Your final assessments: ${completion.value.submitted} submitted, ${completion.value.waived} waived, ${completion.value.outstanding} outstanding`
              : 'Final assessment list not set'}
          </p>
        )}
        {completion.error && (
          <p>
            Completion unavailable.{' '}
            <button type="button" onClick={completion.retry}>
              Retry completion
            </button>
          </p>
        )}
      </section>
      <div className={styles.layout}>
        <nav
          aria-label="Player roster"
          className={`${styles.roster} ${playerId ? styles.rosterWithPlayer : ''}`}
        >
          <div className={styles.rosterTitle}>
            <h2>Players</h2>
            <p className={styles.support}>
              Choose a player by name and reference.
            </p>
          </div>
          {!roster.loaded && roster.loading && (
            <StatusBanner>Loading players…</StatusBanner>
          )}
          {roster.error && (
            <AsyncState title="Players could not be loaded" retry={roster.more}>
              {roster.error.code}, request {roster.error.requestId}
            </AsyncState>
          )}
          {roster.loaded && !roster.rows.length && (
            <AsyncState title="No players in this campaign" />
          )}
          <ul className={styles.rosterList}>
            {roster.rows.map((player) => (
              <li key={player.id}>
                <Link
                  id={`roster-${player.id}`}
                  to={playerPath(campaignId, player.id)}
                  aria-current={player.id === playerId ? 'page' : undefined}
                >
                  <span>{player.displayName}</span>
                  <span className={styles.reference}>
                    Ref{' '}
                    {playerReference(
                      player.id,
                      roster.rows.map((row) => row.id),
                    )}
                  </span>
                  {!player.isActive && (
                    <span className={styles.support}>Withdrawn</span>
                  )}
                  {campaign.frozen && (
                    <span className={styles.support}>
                      {player.obligation === 'none'
                        ? 'No final assessment required'
                        : `Your final: ${player.obligation}`}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {roster.cursor && (
            <div className={styles.paging}>
              <button
                type="button"
                onClick={roster.more}
                disabled={roster.loading}
              >
                Load more players
              </button>
            </div>
          )}
        </nav>
        <div className={styles.workspace}>
          {playerId ? (
            <Outlet
              context={
                { campaign, players: roster.rows } satisfies CampaignOutlet
              }
            />
          ) : (
            <AsyncState title="Choose a player">
              Your feedback form and submitted history will appear here.
            </AsyncState>
          )}
        </div>
      </div>
    </>
  )
}
export function PlayerRoute() {
  const { campaignId, playerId } = useParams()
  if (!isUuid(campaignId) || !isUuid(playerId)) return <UnavailableWorkspace />
  return (
    <PlayerWorkspace
      key={`${campaignId}/${playerId}`}
      campaignId={campaignId}
      playerId={playerId}
    />
  )
}
function PlayerWorkspace({
  campaignId,
  playerId,
}: Readonly<{ campaignId: string; playerId: string }>) {
  const runtime = useCoach()
  const state = useCoachState()
  const online = useConnectivity()
  const { campaign, players } = useOutletContext<CampaignOutlet>()
  const [query, setQuery] = useSearchParams()
  const tab = query.get('tab') === 'history' ? 'history' : 'write'
  const kind = useRef<FeedbackKind | undefined>(
    state.pending?.command.context.campaignId === campaignId &&
      state.pending.command.context.playerId === playerId
      ? state.pending.command.context.kind
      : state.editor?.context.campaignId === campaignId &&
          state.editor.context.playerId === playerId
        ? state.editor.context.kind
        : undefined,
  )
  const heading = useRef<HTMLHeadingElement>(null)
  const activeWorkspace = useRef(true)
  useEffect(() => {
    activeWorkspace.current = true
    return () => {
      activeWorkspace.current = false
    }
  }, [])
  const errorSummary = useRef<HTMLDivElement>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [dialog, setDialog] = useState<
    'final' | 'discard' | 'phase' | undefined
  >(undefined)
  const [localError, setLocalError] = useState('')
  const [historyRevision, setHistoryRevision] = useState(0)
  const read = useRead(
    useCallback(
      (signal: AbortSignal) =>
        runtime.adapter.loadWorkspace(
          runtime.actor,
          campaignId,
          playerId,
          kind.current,
          signal,
        ),
      [runtime.actor, runtime.adapter, campaignId, playerId],
    ),
    runtime.revision,
  )
  const history = usePages(
    useCallback(
      (cursor: string | undefined, signal: AbortSignal) =>
        runtime.adapter.loadHistory(
          runtime.actor,
          campaignId,
          playerId,
          cursor,
          signal,
        ),
      [runtime.actor, runtime.adapter, campaignId, playerId],
    ),
    historyRevision + runtime.revision,
  )
  useEffect(() => {
    if (!read.value) return
    kind.current ??= kindForStage(read.value.campaign.stage) ?? 'preparation'
    runtime.controller.open(read.value, kind.current)
  }, [read.value, runtime.controller])
  const focusedPlayer = useRef(false)
  const editorReady =
    state.editor?.context.campaignId === campaignId &&
    state.editor.context.playerId === playerId
  useEffect(() => {
    if (
      read.value &&
      editorReady &&
      heading.current &&
      !focusedPlayer.current
    ) {
      heading.current?.focus()
      focusedPlayer.current = true
    }
  }, [read.value, editorReady])
  useEffect(() => {
    if (Object.keys(errors).length) errorSummary.current?.focus()
  }, [errors])
  const pending = state.pending
  const { actor, adapter, controller } = runtime
  const retryRead = read.retry
  useEffect(() => {
    if (
      !pending ||
      pending.status !== 'resolved' ||
      pending.detached ||
      pending.command.context.campaignId !== campaignId ||
      pending.command.context.playerId !== playerId
    )
      return
    const abort = new AbortController()
    void adapter
      .loadWorkspace(actor, campaignId, playerId, kind.current, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted && result.ok) {
          controller.reconcile(result.value)
          retryRead()
          setHistoryRevision((value) => value + 1)
        }
      })
    return () => abort.abort()
  }, [pending, actor, adapter, controller, campaignId, playerId, retryRead])
  const check = async () => {
    await runtime.controller.check()
    const result = await runtime.adapter.loadWorkspace(
      runtime.actor,
      campaignId,
      playerId,
      kind.current,
      new AbortController().signal,
    )
    if (result.ok) {
      runtime.controller.reconcile(result.value)
      read.retry()
      setHistoryRevision((value) => value + 1)
      runtime.refresh()
    }
  }
  const run = async (action: 'save' | 'submit' | 'discard') => {
    setLocalError('')
    try {
      await performAction(runtime, action)
      read.retry()
      setHistoryRevision((value) => value + 1)
    } catch {
      setLocalError(
        'The action could not be started. Your text remains in this tab. Refresh context and retry.',
      )
    }
  }
  if (read.loading)
    return <StatusBanner>Loading player and saved draft…</StatusBanner>
  if (read.error)
    return unavailable(read.error.code) ? (
      <UnavailableWorkspace />
    ) : (
      <AsyncState title="Player could not be loaded" retry={read.retry}>
        {read.error.code}, request {read.error.requestId}
      </AsyncState>
    )
  const workspace = read.value!
  const editor = state.editor
  if (
    !editor ||
    editor.context.campaignId !== campaignId ||
    editor.context.playerId !== playerId
  )
    return <StatusBanner>Preparing feedback editor…</StatusBanner>
  const allowed =
    writable(workspace, editor.context.kind) &&
    (runtime.adapter.evidence !== 'live' ||
      editor.context.kind === 'preparation')
  const locked =
    Boolean(pending) ||
    !allowed ||
    editor.resumeRequired ||
    Boolean(state.conflict)
  const writesDisabled = locked || !online
  const phaseEnded =
    kindForStage(workspace.campaign.stage) !== editor.context.kind
  const submitted =
    editor.context.kind === 'final' ? workspace.finalEntry : undefined
  const validate = (complete: boolean) => {
    const next = validateForm(editor.form, complete, singaporeToday())
    setErrors(next)
    return !Object.keys(next).length
  }
  const reference = playerReference(playerId, [
    ...new Set([...players.map((player) => player.id), playerId]),
  ])
  const accessText = !workspace.campaign.isActive
    ? 'Historical access. You can read your submitted feedback.'
    : workspace.campaign.stage === 'setup'
      ? 'Preparation has not opened.'
      : workspace.campaign.stage === 'competition'
        ? 'Feedback paused during competition.'
        : workspace.campaign.stage === 'closed'
          ? 'Campaign closed. Your history remains available.'
          : workspace.campaign.stage === 'final_feedback' &&
              workspace.player.obligation === 'none'
            ? 'No final assessment required.'
            : workspace.player.obligation === 'waived'
              ? `Final assessment waived. ${workspace.player.waiverReason ?? ''}`
              : submitted
                ? 'Your final assessment is submitted and fixed.'
                : !workspace.player.isActive &&
                    editor.context.kind === 'preparation'
                  ? 'This player is withdrawn. Preparation feedback is read only.'
                  : editor.context.kind === 'final'
                    ? 'One final assessment for this competition. Review before submitting.'
                    : 'Preparation is open. You can submit observations as often as needed.'
  return (
    <>
      <div className={styles.playerHeader}>
        <Link className={styles.backToRoster} to={campaignPath(campaignId)}>
          Back to roster
        </Link>
        <h2 ref={heading} tabIndex={-1}>
          {workspace.player.displayName}
        </h2>
        <p className={styles.reference}>Player reference {reference}</p>
        {!workspace.player.isActive && (
          <p className={styles.support}>Withdrawn from roster</p>
        )}
      </div>
      <StatusBanner>{accessText}</StatusBanner>
      {state.message &&
        (!pending ||
          (pending.command.context.campaignId === campaignId &&
            pending.command.context.playerId === playerId)) && (
          <StatusBanner>
            <p>{state.message}</p>
            {state.lastSubmission && (
              <div>
                <button
                  type="button"
                  onClick={() => setQuery({ tab: 'history' })}
                >
                  View submitted feedback
                </button>
              </div>
            )}
          </StatusBanner>
        )}
      {localError && <StatusBanner urgent>{localError}</StatusBanner>}
      <FeedbackTabs tab={tab} change={(value) => setQuery({ tab: value })} />
      <section
        role="tabpanel"
        id="write-panel"
        aria-labelledby="write-tab"
        hidden={tab !== 'write'}
      >
        {submitted ? (
          <FeedbackHistory entries={[submitted]} />
        ) : (
          <>
            <div className={styles.formHeading}>
              <h3>
                {editor.context.kind === 'preparation'
                  ? 'Preparation observation'
                  : 'Final assessment'}
              </h3>
              <span className={styles.support}>
                {dirty(editor)
                  ? 'Unsaved changes'
                  : editor.draft
                    ? 'Saved draft'
                    : 'New feedback'}
              </span>
            </div>
            {phaseEnded && (
              <StatusBanner>
                {editor.context.kind === 'preparation'
                  ? 'Preparation text from an ended stage.'
                  : 'Final text from an ended stage.'}{' '}
                Text remains read only in its original phase.
              </StatusBanner>
            )}
            {editor.resumeRequired && allowed && !phaseEnded && (
              <StatusBanner>
                <p>
                  Your assignment is available again. Review the current context
                  before resuming.
                </p>
                <button
                  type="button"
                  disabled={Boolean(pending)}
                  onClick={() =>
                    runtime.controller.updateEditor({
                      ...editor,
                      resumeRequired: false,
                    })
                  }
                >
                  Resume editing
                </button>
              </StatusBanner>
            )}
            {phaseEnded &&
              runtime.adapter.evidence !== 'live' &&
              kindForStage(workspace.campaign.stage) === 'final' &&
              writable(workspace, 'final') && (
                <button
                  type="button"
                  disabled={Boolean(pending)}
                  onClick={() => setDialog('phase')}
                >
                  Discard old text and start final assessment
                </button>
              )}
            {pending?.command.context.campaignId === campaignId &&
              pending.command.context.playerId === playerId && (
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={!online || pending.status === 'pending'}
                    onClick={() => {
                      void check()
                    }}
                  >
                    Check result
                  </button>
                  <p>
                    Inputs remain read only until this action is reconciled.
                  </p>
                </div>
              )}
            {state.conflict && (
              <section className={styles.card}>
                <h3>Draft changed since you loaded it</h3>
                <div className={styles.comparison}>
                  <section>
                    <h4>Your local version</h4>
                    <ContentReview content={editor.form} />
                  </section>
                  <section>
                    <h4>Latest saved draft</h4>
                    <ContentReview
                      content={
                        state.conflict.draft
                          ? toForm(state.conflict.draft.content)
                          : blankForm
                      }
                    />
                  </section>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    onClick={() => runtime.controller.resolveConflict(true)}
                  >
                    Load saved draft
                  </button>
                  <button
                    type="button"
                    onClick={() => runtime.controller.resolveConflict(false)}
                  >
                    Keep my edited version
                  </button>
                </div>
                <p>
                  No automatic merge. Saving requires another explicit action.
                </p>
              </section>
            )}
            {textFields.some(
              (field) => editor.comparison[field] !== undefined,
            ) && (
              <section className={styles.card}>
                <h3>Voice text from a changed context, cannot be saved</h3>
                {textFields
                  .filter((field) => editor.comparison[field] !== undefined)
                  .map((field) => (
                    <div key={field}>
                      <h4>{fieldLabels[field]}</h4>
                      <p className={styles.plainText}>
                        {editor.comparison[field]}
                      </p>
                    </div>
                  ))}
                <button
                  type="button"
                  onClick={() =>
                    runtime.controller.updateEditor({
                      ...editor,
                      comparison: {},
                    })
                  }
                >
                  Dismiss
                </button>
              </section>
            )}
            <form
              noValidate
              className={`${styles.card} ${styles.form}`}
              onSubmit={(event) => {
                event.preventDefault()
                if (writesDisabled || !validate(true)) return
                if (editor.context.kind === 'final') setDialog('final')
                else void run('submit')
              }}
            >
              {Object.keys(errors).length > 0 && (
                <div
                  ref={errorSummary}
                  tabIndex={-1}
                  role="alert"
                  className={styles.error}
                >
                  <h4>Check your feedback</h4>
                  <ul>
                    {Object.entries(errors).map(([field, error]) => (
                      <li key={field}>
                        <a href={`#${field}`}>{error}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <label htmlFor="observedOn">
                  Observation date (required to submit)
                </label>
                <input
                  id="observedOn"
                  type="date"
                  value={editor.form.observedOn}
                  max={singaporeToday()}
                  readOnly={locked}
                  aria-invalid={Boolean(errors.observedOn)}
                  aria-describedby={`date-help${errors.observedOn ? ' date-error' : ''}`}
                  onChange={(event) =>
                    runtime.controller.updateEditor(
                      editField(editor, 'observedOn', event.target.value),
                    )
                  }
                />
                <p id="date-help" className={styles.support}>
                  Choose the date you observed this player. Today is based on
                  Singapore time.
                </p>
                {errors.observedOn && (
                  <p id="date-error" className={styles.error}>
                    {errors.observedOn}
                  </p>
                )}
              </div>
              {textFields.map((field) => (
                <div key={field}>
                  <label htmlFor={field}>
                    {fieldLabels[field]}{' '}
                    {field === 'observations'
                      ? '(required to submit)'
                      : '(optional)'}
                  </label>
                  <textarea
                    id={field}
                    value={editor.form[field]}
                    readOnly={locked}
                    aria-invalid={Boolean(errors[field])}
                    aria-describedby={`${field}-help${errors[field] ? ` ${field}-error` : ''}`}
                    onChange={(event) =>
                      runtime.controller.updateEditor(
                        editField(editor, field, event.target.value),
                      )
                    }
                  />
                  <p id={`${field}-help`} className={styles.support}>
                    {field === 'observations'
                      ? 'What did you notice in this session or competition?'
                      : field === 'strengths'
                        ? 'What is working well for this player?'
                        : 'What could help this player improve?'}
                    {Array.from(editor.form[field]).length >
                      (field === 'observations' ? 9000 : 4500) &&
                      ` ${(field === 'observations' ? 10000 : 5000) - Array.from(editor.form[field]).length} characters remaining.`}
                  </p>
                  {errors[field] && (
                    <p className={styles.error} id={`${field}-error`}>
                      {errors[field]}
                    </p>
                  )}
                </div>
              ))}
              {allowed && (
                <>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      disabled={writesDisabled || !dirty(editor)}
                      onClick={() => {
                        if (validate(false)) void run('save')
                      }}
                    >
                      Save draft
                    </button>
                    <button
                      type="submit"
                      className={styles.primary}
                      disabled={writesDisabled}
                    >
                      {editor.context.kind === 'final'
                        ? 'Review final assessment'
                        : 'Submit feedback'}
                    </button>
                    {editor.draft && (
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={writesDisabled}
                        onClick={() => setDialog('discard')}
                      >
                        Discard saved draft
                      </button>
                    )}
                  </div>
                  <p className={styles.support}>
                    Saving is explicit. Submitted feedback is fixed. Unsaved
                    edits are lost if you close or reload this tab.
                  </p>
                </>
              )}
              {!allowed && dirty(editor) && !pending && (
                <button
                  type="button"
                  onClick={() =>
                    runtime.controller.updateEditor({
                      ...editor,
                      form: editor.baseline,
                      provenance: {},
                      comparison: {},
                    })
                  }
                >
                  Discard local edits
                </button>
              )}
            </form>
          </>
        )}
      </section>
      <section
        role="tabpanel"
        id="history-panel"
        aria-labelledby="history-tab"
        hidden={tab !== 'history'}
      >
        <h3>Your submitted feedback</h3>
        <p className={styles.support}>
          Only your submissions are shown. Corrections retain the original
          feedback.
        </p>
        {!history.loaded && history.loading && (
          <StatusBanner>Loading submitted feedback…</StatusBanner>
        )}
        {history.error && (
          <AsyncState title="History could not be loaded" retry={history.more}>
            {history.error.code}, request {history.error.requestId}
          </AsyncState>
        )}
        {history.loaded && !history.rows.length && (
          <AsyncState title="No submitted feedback yet" />
        )}
        <FeedbackHistory entries={history.rows} />
        {history.cursor && (
          <div className={styles.paging}>
            <button
              type="button"
              disabled={history.loading}
              onClick={history.more}
            >
              Load more feedback
            </button>
          </div>
        )}
      </section>
      {dialog && (
        <Dialog
          title={
            dialog === 'final'
              ? 'Review final assessment'
              : dialog === 'phase'
                ? 'Start final assessment?'
                : 'Discard saved draft?'
          }
          close={() => setDialog(undefined)}
        >
          {dialog === 'final' ? (
            <>
              <p>
                {workspace.player.displayName}, reference {reference}
              </p>
              <p>
                {campaign.name}, {campaign.team}, {campaign.competition}
              </p>
              <ContentReview content={editor.form} />
              <p>
                You can submit one final assessment for this player and
                competition. Submitted feedback is fixed.
              </p>
            </>
          ) : (
            <p>
              {dialog === 'phase'
                ? 'Discard this original phase text, then load your final draft or start blank. No text will be transferred.'
                : 'This deletes your saved draft. Your current local form will also be cleared after confirmation.'}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              data-safe-focus
              onClick={() => setDialog(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={dialog === 'final' ? styles.primary : styles.danger}
              disabled={Boolean(pending) || !online}
              onClick={() => {
                if (dialog === 'phase') {
                  void runtime.adapter
                    .loadWorkspace(
                      runtime.actor,
                      campaignId,
                      playerId,
                      'final',
                      new AbortController().signal,
                    )
                    .then((result) => {
                      if (
                        activeWorkspace.current &&
                        result.ok &&
                        writable(result.value, 'final') &&
                        !runtime.controller.getSnapshot().pending
                      ) {
                        kind.current = 'final'
                        runtime.controller.clearEditor()
                        runtime.controller.updateEditor(
                          newEditor(runtime.actor, result.value, 'final'),
                        )
                        read.retry()
                      }
                    })
                } else if (dialog === 'final') {
                  if (validate(true)) void run('submit')
                } else void run('discard')
                setDialog(undefined)
              }}
            >
              {dialog === 'final'
                ? 'Submit final assessment'
                : dialog === 'phase'
                  ? 'Discard and start final assessment'
                  : 'Discard saved draft'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
