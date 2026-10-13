import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'
import {
  isUuid,
  readAccess,
  readOperation,
  record,
  validPassword,
  type AccountOperation,
} from '../../domain/accounts'
import {
  executeMutation,
  prepareMutation,
  type MutationAction,
  type PendingMutation,
} from '../data/mutations'
import { useRuntime } from '../coach/runtime'
import { AsyncState } from '../coach/components'
import styles from '../coach/coach.module.css'
import layout from './accounts.module.css'

const messages: Readonly<Record<string, string>> = {
  EMAIL_EXISTS:
    'This account already exists. You can select its enabled application profile for assignments.',
  SETUP_EXISTS:
    'An account setup operation already reserves this email. You can resume that operation.',
  OPERATION_BUSY:
    'A setup operation is running. You can refresh its progress shortly.',
  VERSION_CONFLICT:
    'This record changed. Refresh its current state before trying again.',
  RECONCILIATION_REQUIRED:
    'Setup needs reconciliation. You can refresh its progress and resume it explicitly.',
  OUTCOME_UNKNOWN:
    'The outcome is unknown. Check current progress before beginning another action.',
  PROVIDER_UNAVAILABLE:
    'The account service is unavailable. You can inspect progress and resume later.',
  FORBIDDEN: 'This action is no longer available to your account.',
  ACCOUNT_DISABLED:
    'This account is disabled. A replacement setup link is unavailable.',
  PAIR_CONFLICT:
    'This coach and player already belong to another campaign for this competition.',
  NAME_CONFLICT: 'That name is already in use.',
}
const friendly = (code: unknown) =>
  typeof code === 'string'
    ? (messages[code] ??
      'The action could not be completed. You can refresh and check current records.')
    : 'The action could not be confirmed. You can check current progress.'
const value = (form: FormData, name: string) =>
  String(form.get(name) ?? '').trim()

export function SetupPassword() {
  const runtime = useRuntime()
  const [proof, setProof] = useState(runtime.setupProof)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<
    'form' | 'success' | 'unknown' | 'invalid'
  >(proof ? 'form' : 'invalid')
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    document.title = 'Set password | SFDA Coaches'
    return () => {
      alive.current = false
    }
  }, [])
  return (
    <div className={styles.login}>
      <section className={styles.loginCopy}>
        <p className={styles.eyebrow}>Your account is prepared by your admin</p>
        <h1>Choose your password.</h1>
        <p>
          You can use a password manager and paste your password. Your password
          stays private.
        </p>
        <p className={styles.support}>
          Your account access and campaign assignments are managed by your
          admin.
        </p>
      </section>
      <section className={styles.card}>
        <h2>Set password</h2>
        {status === 'success' ? (
          <>
            <p role="status">Your password is set. You can sign in now.</p>
            <Link to="/login">Go to sign in</Link>
          </>
        ) : status === 'unknown' ? (
          <>
            <p role="alert">
              The password result is unknown. Try logging in with the password
              you chose, then ask your admin for a replacement if that fails.
            </p>
            <Link to="/login">Try signing in</Link>
          </>
        ) : status === 'invalid' || runtime.configuration.appEnv !== 'local' ? (
          <>
            <p role="alert">
              This setup link is unavailable or has expired. You can ask your
              admin for a replacement.
            </p>
            <Link to="/login">Go to sign in</Link>
          </>
        ) : (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              if (busy || !proof) return
              const form = new FormData(event.currentTarget)
              const password = form.get('password')
              const confirmation = form.get('confirmation')
              if (!validPassword(password)) {
                setError(
                  'Use at least 12 characters and at most 64 UTF8 bytes, without control characters. Spaces are allowed.',
                )
                return
              }
              if (password !== confirmation) {
                setError('The passwords do not match.')
                return
              }
              setBusy(true)
              setError('')
              const body = { ...proof, password }
              event.currentTarget.reset()
              void fetch('/api/accounts/setup-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                cache: 'no-store',
              })
                .then(async (response) => {
                  const result: unknown = await response.json()
                  if (!alive.current) return
                  setBusy(false)
                  setProof(undefined)
                  setStatus(
                    response.ok && record(result)?.outcome === 'password_set'
                      ? 'success'
                      : record(result)?.code === 'OUTCOME_UNKNOWN' ||
                          response.status >= 500
                        ? 'unknown'
                        : 'invalid',
                  )
                })
                .catch(() => {
                  if (alive.current) {
                    setBusy(false)
                    setProof(undefined)
                    setStatus('unknown')
                  }
                })
            }}
          >
            <div>
              <label htmlFor="new-password">Password</label>
              <input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={busy}
                aria-describedby="password-help password-error"
              />
            </div>
            <p id="password-help" className={styles.support}>
              At least 12 characters. Spaces and password managers are welcome.
            </p>
            <div>
              <label htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                disabled={busy}
              />
            </div>
            {error && (
              <p id="password-error" role="alert">
                {error}
              </p>
            )}
            <button className={styles.primary} disabled={busy}>
              {busy ? 'Setting password…' : 'Set password'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}

export function AccountStatus() {
  const runtime = useRuntime()
  useEffect(() => {
    document.title = 'Your account | SFDA Coaches'
  }, [])
  if (!runtime.access) return <Navigate to="/login" replace />
  if (runtime.access.role !== 'player')
    return (
      <Navigate
        to={runtime.access.role === 'admin' ? '/admin/setup' : '/coach'}
        replace
      />
    )
  return (
    <section className={styles.card}>
      <p className={styles.eyebrow}>Your SFDA account</p>
      <h1>Welcome, {runtime.access.displayName}.</h1>
      <p>
        Your account access is enabled. A player portal is not available in this
        release.
      </p>
      <p className={styles.support}>
        You can contact your admin if your account needs attention.
      </p>
      <button onClick={runtime.signOut}>Sign out</button>
    </section>
  )
}
export function AdminSetup() {
  const runtime = useRuntime()
  if (!runtime.access || !runtime.dataClient)
    return <Navigate to="/login" replace />
  if (runtime.access.role !== 'admin')
    return (
      <Navigate
        to={runtime.access.role === 'player' ? '/account' : '/coach'}
        replace
      />
    )
  if (runtime.configuration.appEnv !== 'local')
    return (
      <AsyncState title="Account setup unavailable">
        This setup path is available only in the local pilot workspace.
      </AsyncState>
    )
  return <AdminWorkspace />
}
type Competition = Readonly<{ id: string; name: string; created_at: string }>
type Campaign = Readonly<{
  id: string
  name: string
  team_name: string
  competition_id: string
  stage: string
  version: number
  created_at: string
}>
type Choice = Readonly<{
  id: string
  displayName: string
  role: 'admin' | 'coach' | 'player'
  enabled: boolean
  version: number
}>
const mergeRecords = <T extends { id: string; created_at: string }>(
  prior: readonly T[],
  incoming: readonly T[],
): readonly T[] =>
  [
    ...prior.filter((row) => !incoming.some((item) => item.id === row.id)),
    ...incoming,
  ].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )
function AdminWorkspace() {
  const runtime = useRuntime()
  const client = runtime.dataClient!
  const [operations, setOperations] = useState<readonly AccountOperation[]>([])
  const [operationCursor, setOperationCursor] = useState<string | undefined>(
    undefined,
  )
  const [profiles, setProfiles] = useState<readonly Choice[]>([])
  const [profileCursor, setProfileCursor] = useState<
    ApplicationDatabaseCursor | undefined
  >(undefined)
  const [competitions, setCompetitions] = useState<readonly Competition[]>([])
  const [campaigns, setCampaigns] = useState<readonly Campaign[]>([])
  const [competitionCursor, setCompetitionCursor] = useState<
    ApplicationDatabaseCursor | undefined
  >(undefined)
  const [campaignCursor, setCampaignCursor] = useState<
    ApplicationDatabaseCursor | undefined
  >(undefined)
  const [competitionId, setCompetitionId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [resumeId, setResumeId] = useState('')
  const [conflict, setConflict] = useState<
    Readonly<Record<string, unknown>> | undefined
  >(undefined)
  const [unknown, setUnknown] = useState<
    Readonly<{ mutationId: string }> | undefined
  >(undefined)
  const alive = useRef(true)
  const selectedCampaign = campaigns.find((item) => item.id === campaignId)
  const api = useCallback(
    async (path: string, body: unknown = undefined) => {
      const current = await client.auth.getSession()
      if (!current.data.session)
        return { ok: false, status: 401, body: { code: 'AUTH_REQUIRED' } }
      try {
        const result = await fetch(path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${current.data.session.access_token}`,
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: 'no-store',
        })
        const data: unknown = await result.json()
        return {
          ok: result.ok,
          status: result.status,
          body: record(data) ?? { code: 'PROVIDER_UNAVAILABLE' },
        }
      } catch {
        return { ok: false, status: 503, body: { code: 'OUTCOME_UNKNOWN' } }
      }
    },
    [client],
  )
  const loadOperations = useCallback(
    async (cursor: string | undefined = undefined) => {
      const result = await api(
        `/api/admin/account-operations${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`,
      )
      if (!alive.current) return
      if (!result.ok) {
        setError(friendly(result.body.code))
        return
      }
      const list = result.body.operations
      if (!Array.isArray(list)) {
        setError('Account progress is unavailable.')
        return
      }
      const parsed = list.map(readOperation)
      if (parsed.some((item) => !item)) {
        setError('Account progress is unavailable.')
        return
      }
      setOperations((prior) =>
        cursor
          ? [...prior, ...(parsed as AccountOperation[])]
          : (parsed as AccountOperation[]),
      )
      setOperationCursor(
        typeof result.body.nextCursor === 'string'
          ? result.body.nextCursor
          : undefined,
      )
    },
    [api],
  )
  const loadProfiles = useCallback(
    async (cursor: ApplicationDatabaseCursor | undefined = undefined) => {
      const result = await client.rpc('admin_list_profiles', {
        page_size: 20,
        page_cursor: cursor ?? null,
        role_filter: null,
      })
      if (!alive.current) return
      const data = record(result.data)
      if (result.error || !Array.isArray(data?.items)) {
        setError('Assignment choices could not be loaded.')
        return
      }
      const parsed = data.items
        .map(readAccess)
        .filter((item): item is NonNullable<typeof item> =>
          Boolean(item?.enabled),
        )
      setProfiles((prior) => (cursor ? [...prior, ...parsed] : parsed))
      setProfileCursor(
        record(data.nextCursor) as ApplicationDatabaseCursor | undefined,
      )
    },
    [client],
  )
  const loadCompetitions = useCallback(
    async (cursor: ApplicationDatabaseCursor | undefined = undefined) => {
      let query = client
        .from('competitions')
        .select('id,name,created_at')
        .order('created_at')
        .order('id')
        .limit(21)
      if (cursor)
        query = query.or(
          `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
        )
      const result = await query
      if (!alive.current) return
      if (result.error) {
        setError('Competitions could not be loaded.')
        return
      }
      const rows = result.data ?? []
      setCompetitions((prior) => mergeRecords(prior, rows.slice(0, 20)))
      const last = rows[19]
      setCompetitionCursor(
        rows.length > 20 && last
          ? { id: last.id, createdAt: last.created_at }
          : undefined,
      )
    },
    [client],
  )
  const loadCampaigns = useCallback(
    async (cursor: ApplicationDatabaseCursor | undefined = undefined) => {
      let query = client
        .from('campaigns')
        .select('id,name,team_name,competition_id,stage,version,created_at')
        .order('created_at')
        .order('id')
        .limit(21)
      if (cursor)
        query = query.or(
          `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
        )
      const result = await query
      if (!alive.current) return
      if (result.error) {
        setError('Campaigns could not be loaded.')
        return
      }
      const rows = result.data ?? []
      setCampaigns((prior) => mergeRecords(prior, rows.slice(0, 20)))
      const last = rows[19]
      setCampaignCursor(
        rows.length > 20 && last
          ? { id: last.id, createdAt: last.created_at }
          : undefined,
      )
    },
    [client],
  )
  const refresh = useCallback(async () => {
    await Promise.all([
      loadOperations(),
      loadProfiles(),
      loadCompetitions(),
      loadCampaigns(),
    ])
    if (alive.current) setLoading(false)
  }, [loadOperations, loadProfiles, loadCompetitions, loadCampaigns])
  useEffect(() => {
    alive.current = true
    document.title = 'Admin setup | SFDA Coaches'
    // This effect starts external reads; state changes occur after those reads.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh().catch(() => {
      if (alive.current) {
        setError('Setup records could not be loaded.')
        setLoading(false)
      }
    })
    return () => {
      alive.current = false
    }
  }, [refresh])
  const accountAction = async (
    path: string,
    body: Readonly<Record<string, unknown>>,
  ) => {
    if (busy || unknown) return
    setBusy(true)
    setError('')
    setNotice('')
    setConflict(undefined)
    const result = await api(path, body)
    if (!alive.current) return
    setBusy(false)
    if (!result.ok) {
      setError(friendly(result.body.code))
      setConflict(record(result.body.conflict))
    } else {
      const operation = readOperation(result.body.operation)
      if (operation)
        setNotice(
          `${operation.displayName}: ${operation.emailAttemptState === 'accepted' ? 'Link requested' : 'Link request pending'}. ${operation.accessEnabled ? 'Access enabled' : 'Access not yet enabled'}. Operation ${operation.id}`,
        )
      if (result.status === 202)
        setError(friendly(result.body.code ?? 'OUTCOME_UNKNOWN'))
    }
    await refresh()
  }
  const run = async <Action extends MutationAction>(
    request: PendingMutation<Action>,
    after: (id: string) => void = () => {},
  ) => {
    if (busy || unknown) return
    setBusy(true)
    setError('')
    setNotice('')
    const result = await executeMutation(client, request)
    if (!alive.current) return
    setBusy(false)
    if (!result.ok) {
      setError(friendly(result.code))
      if (['NETWORK_ERROR', 'INVALID_RESPONSE'].includes(result.code))
        setUnknown({ mutationId: request.inputs.mutation_id })
      return
    }
    const id =
      'id' in result.value.result
        ? result.value.result.id
        : result.value.result.campaignId
    const labels = {
      competition: 'competition',
      campaign: 'campaign',
      campaign_coach: 'coach assignment',
      campaign_player: 'player assignment',
    }
    const kind = result.value.result.type
    setNotice(
      `Saved ${kind in labels ? labels[kind as keyof typeof labels] : 'record'}. Reference ${id}`,
    )
    if (kind === 'competition') {
      const current = await client
        .from('competitions')
        .select('id,name,created_at')
        .eq('id', id)
        .single()
      if (!alive.current) return
      if (current.data)
        setCompetitions((prior) => mergeRecords(prior, [current.data]))
    } else if (kind === 'campaign') {
      const current = await client
        .from('campaigns')
        .select('id,name,team_name,competition_id,stage,version,created_at')
        .eq('id', id)
        .single()
      if (!alive.current) return
      if (current.data)
        setCampaigns((prior) => mergeRecords(prior, [current.data]))
    }
    after(id)
    await refresh()
  }
  const checkUnknown = async () => {
    if (!unknown) return
    const result = await client
      .from('mutation_receipts')
      .select('mutation_id,result_type,result_id')
      .eq('actor_id', runtime.access!.id)
      .eq('mutation_id', unknown.mutationId)
      .maybeSingle()
    if (!alive.current) return
    if (result.data) {
      setUnknown(undefined)
      setError('')
      setNotice(`The action committed. Reference ${result.data.result_id}`)
      await refresh()
    } else
      setError(
        'No committed receipt is visible yet. This does not prove rollback. You can check again.',
      )
  }
  const disabled = busy || Boolean(unknown)
  return (
    <div className={layout.workspace}>
      <div>
        <p className={styles.eyebrow}>Local pilot setup</p>
        <h1>Prepare the first feedback path.</h1>
        <p>
          Prepare accounts, choose a competition, add your campaign roster and
          open preparation. Each section saves separately.
        </p>
        <p className={styles.support}>
          You can use synthetic people in this local build. Password setup links
          go to the local capture inbox.
        </p>
      </div>
      {loading && <p role="status">Loading setup records…</p>}
      {error && (
        <p role="alert" className={styles.banner}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.banner}>
          {notice}
        </p>
      )}
      {unknown && (
        <div className={styles.banner}>
          <p>
            Campaign action outcome unknown. Request {unknown.mutationId}. New
            setup writes are paused.
          </p>
          <button onClick={() => void checkUnknown()}>
            Check committed result
          </button>
        </div>
      )}
      <section className={styles.card}>
        <h2>1. Accounts</h2>
        <p>
          Choose a fixed account role. The user chooses their password from the
          setup link.
        </p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            void accountAction('/api/admin/accounts', {
              mutationId: crypto.randomUUID(),
              email: value(form, 'email'),
              displayName: value(form, 'displayName'),
              role: value(form, 'role'),
            })
          }}
        >
          <fieldset disabled={disabled} className={layout.fields}>
            <legend>Create an account</legend>
            <div>
              <label htmlFor="account-name">Display name</label>
              <input
                id="account-name"
                name="displayName"
                maxLength={160}
                required
              />
            </div>
            <div>
              <label htmlFor="account-email">Account email</label>
              <input
                id="account-email"
                name="email"
                type="email"
                required
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="account-role">Role</label>
              <select id="account-role" name="role">
                <option value="coach">Coach</option>
                <option value="player">Player</option>
              </select>
            </div>
            <button className={styles.primary}>
              Create account and request link
            </button>
          </fieldset>
        </form>
        {conflict?.kind === 'existing_operation' &&
          isUuid(conflict.operationId) && (
            <p>
              Existing operation {conflict.operationId}. You can refresh the
              list and choose Resume.
            </p>
          )}
        {conflict?.kind === 'auth_identity_unlinked' && (
          <p>
            This Auth identity has no linked application profile. It cannot be
            adopted through this setup page.
          </p>
        )}
        {conflict?.kind === 'existing_profile' && (
          <p>
            The existing profile is available in enabled assignment choices. Its
            role will stay fixed.
          </p>
        )}
        <h3>Account progress</h3>
        <p className={styles.support}>
          Link requested and access enabled are separate steps. Neither means
          the user has set a password.
        </p>
        <button disabled={busy} onClick={() => void refresh()}>
          Refresh setup records
        </button>
        {!operations.length && !loading && (
          <p>No account setup operations yet.</p>
        )}
        <ul className={layout.operations}>
          {operations.map((operation) => (
            <li key={operation.id}>
              <div>
                <strong>{operation.displayName}</strong>
                <p>
                  {operation.role}. {operation.checkpoint.replaceAll('_', ' ')}.
                  Email attempt:{' '}
                  {operation.emailAttemptState.replaceAll('_', ' ')}.
                </p>
                <p className={styles.support}>
                  Operation {operation.id}.{' '}
                  {operation.passwordSetupAt
                    ? 'Password setup recorded.'
                    : 'Password setup not recorded.'}
                </p>
              </div>
              <div className={styles.actions}>
                <button
                  disabled={disabled}
                  onClick={() => setResumeId(operation.id)}
                >
                  Resume
                </button>
                {operation.kind === 'provision' &&
                  ['profile_created', 'ready'].includes(
                    operation.checkpoint,
                  ) && (
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void accountAction(
                          `/api/admin/account-operations/${operation.id}/setup-link`,
                          {
                            mutationId: crypto.randomUUID(),
                            expectedVersion: operation.version,
                          },
                        )
                      }
                    >
                      Request replacement link
                    </button>
                  )}
              </div>
              {operation.kind === 'provision' && (
                <p className={styles.support}>
                  Requesting a replacement immediately invalidates the previous
                  application setup link.
                </p>
              )}
              {resumeId === operation.id && (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault()
                    const form = new FormData(event.currentTarget)
                    const email = value(form, 'resumeEmail')
                    void accountAction(
                      `/api/admin/account-operations/${operation.id}/resume`,
                      {
                        mutationId: crypto.randomUUID(),
                        expectedVersion: operation.version,
                        ...(!operation.targetId ? { email } : {}),
                      },
                    )
                    setResumeId('')
                  }}
                >
                  {!operation.targetId && (
                    <div>
                      <label htmlFor={`resume-${operation.id}`}>
                        Original account email
                      </label>
                      <input
                        id={`resume-${operation.id}`}
                        name="resumeEmail"
                        type="email"
                        required
                      />
                    </div>
                  )}
                  <button disabled={disabled}>Resume this operation</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {operationCursor && (
          <button
            disabled={busy}
            onClick={() => void loadOperations(operationCursor)}
          >
            Load more account progress
          </button>
        )}
      </section>
      <section className={styles.card}>
        <h2>2. Competition and campaign</h2>
        <div className={layout.columns}>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              void run(
                prepareMutation('create_competition', {
                  name: value(form, 'name'),
                  starts_on: value(form, 'startsOn') || null,
                  ends_on: value(form, 'endsOn') || null,
                }),
                setCompetitionId,
              )
            }}
          >
            <fieldset disabled={disabled} className={layout.fields}>
              <legend>Create a competition</legend>
              <label htmlFor="competition-name">Competition name</label>
              <input
                id="competition-name"
                name="name"
                required
                maxLength={160}
              />
              <label htmlFor="competition-start">Start date (optional)</label>
              <input id="competition-start" name="startsOn" type="date" />
              <label htmlFor="competition-end">End date (optional)</label>
              <input id="competition-end" name="endsOn" type="date" />
              <button>Create competition</button>
            </fieldset>
          </form>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              void run(
                prepareMutation('create_campaign', {
                  competition_id: competitionId,
                  name: value(form, 'name'),
                  team_name: value(form, 'team'),
                  planned_preparation_start_on:
                    value(form, 'preparationOn') || null,
                }),
                setCampaignId,
              )
            }}
          >
            <fieldset disabled={disabled} className={layout.fields}>
              <legend>Create a campaign</legend>
              <label htmlFor="competition-choice">Competition</label>
              <select
                id="competition-choice"
                required
                value={competitionId}
                onChange={(event) => setCompetitionId(event.target.value)}
              >
                <option value="">Choose a competition</option>
                {competitions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id.slice(0, 8)})
                  </option>
                ))}
              </select>
              <label htmlFor="campaign-name">Campaign name</label>
              <input id="campaign-name" name="name" required maxLength={160} />
              <label htmlFor="campaign-team">Team name</label>
              <input id="campaign-team" name="team" required maxLength={160} />
              <label htmlFor="preparation-date">
                Planned preparation date (optional)
              </label>
              <input id="preparation-date" name="preparationOn" type="date" />
              <button>Create campaign</button>
            </fieldset>
          </form>
        </div>
        <p className={styles.support}>
          Dates provide context. Opening preparation is an explicit action.
        </p>
        {competitionCursor && (
          <button
            disabled={disabled}
            onClick={() => void loadCompetitions(competitionCursor)}
          >
            Load more competitions
          </button>
        )}
      </section>
      <section className={styles.card}>
        <h2>3. Assignments</h2>
        <label htmlFor="campaign-choice">Campaign</label>
        <select
          id="campaign-choice"
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
          disabled={disabled}
        >
          <option value="">Choose a campaign</option>
          {campaigns.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}, {item.team_name}, {item.stage.replaceAll('_', ' ')} (
              {item.id.slice(0, 8)})
            </option>
          ))}
        </select>
        {campaignCursor && (
          <button
            disabled={disabled}
            onClick={() => void loadCampaigns(campaignCursor)}
          >
            Load more campaigns
          </button>
        )}
        <p className={styles.support}>
          Only enabled coach and player profiles appear below. Pending accounts
          cannot be assigned through this page.
        </p>
        <div className={layout.columns}>
          {(['coach', 'player'] as const).map((role) => (
            <form
              key={role}
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                const id = value(form, 'profile')
                void run(
                  role === 'coach'
                    ? prepareMutation('set_campaign_coach', {
                        campaign_id: campaignId,
                        coach_id: id,
                        active: true,
                        expected_version: null,
                        reason: 'Initial coach assignment',
                      })
                    : prepareMutation('set_campaign_player', {
                        campaign_id: campaignId,
                        player_id: id,
                        active: true,
                        expected_version: null,
                        reason: 'Initial player roster assignment',
                      }),
                )
              }}
            >
              <fieldset
                disabled={disabled || !campaignId}
                className={layout.fields}
              >
                <legend>
                  {role === 'coach' ? 'Assign a coach' : 'Add a roster player'}
                </legend>
                <label htmlFor={`${role}-choice`}>
                  {role === 'coach' ? 'Coach' : 'Player'}
                </label>
                <select id={`${role}-choice`} name="profile" required>
                  <option value="">Choose a {role}</option>
                  {profiles
                    .filter((item) => item.role === role && item.enabled)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName} ({item.id.slice(0, 8)})
                      </option>
                    ))}
                </select>
                <button>
                  {role === 'coach' ? 'Assign coach' : 'Add player'}
                </button>
              </fieldset>
            </form>
          ))}
        </div>
        {profileCursor && (
          <button
            disabled={busy}
            onClick={() => void loadProfiles(profileCursor)}
          >
            Load more enabled profiles
          </button>
        )}
      </section>
      <section className={styles.card}>
        <h2>4. Open preparation</h2>
        <p>
          {selectedCampaign
            ? `${selectedCampaign.name}, ${selectedCampaign.team_name}. Current stage: ${selectedCampaign.stage.replaceAll('_', ' ')}.`
            : 'Choose a campaign above to open preparation.'}
        </p>
        <button
          className={styles.primary}
          disabled={disabled || selectedCampaign?.stage !== 'setup'}
          onClick={() => {
            if (selectedCampaign)
              void run(
                prepareMutation('advance_campaign_stage', {
                  campaign_id: selectedCampaign.id,
                  expected_version: selectedCampaign.version,
                  next_stage: 'preparation',
                  reason: 'Open preparation for initial feedback',
                }),
              )
          }}
        >
          Open preparation
        </button>
        <p className={styles.support}>
          Your assigned coach can then sign in and submit reviewed preparation
          observations.
        </p>
      </section>
    </div>
  )
}
type ApplicationDatabaseCursor = Readonly<{ createdAt: string; id: string }>
