import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  readAccountSummary,
  readOperation,
  readRecoveryProgress,
  recoveryReasons,
  record,
  type AccountOperation,
  type AccountSummary,
  type RecoveryProgress,
  type RecoveryReason,
  type SetupStatus,
} from '../../domain/accounts'
import type { Json } from '../../domain/database.types'
import { executeMutation, prepareMutation } from '../data/mutations'
import styles from '../coach/coach.module.css'
import layout from '../accounts/accounts.module.css'
import {
  field,
  friendly,
  rpcOutcome,
  useAdmin,
  useAdminAction,
  useAlive,
  useDirtyForm,
  useWorkerApi,
  workerOutcome,
  type WorkerReply,
} from './actions'
import { ActionDialog, ActionStatus, LoadState, ReasonField } from './shared'

const setupLabels: Readonly<Record<SetupStatus, string>> = {
  ready: 'Setup ready',
  pending: 'Setup pending',
  needs_reconciliation: 'Setup needs reconciliation',
  not_tracked: 'Setup not tracked',
  not_applicable: 'Administrator',
}
const roleLabels = { admin: 'Admin', coach: 'Coach', player: 'Player' }
const recoveryLabels: Readonly<Record<RecoveryProgress['status'], string>> = {
  reserved: 'Reserved',
  started: 'Sending',
  accepted: 'Email accepted',
  unknown: 'Outcome unknown',
  failed: 'Not sent',
  password_changed: 'Password changed',
}
const editable = (profile: AccountSummary) =>
  profile.role !== 'admin' &&
  (profile.setupStatus === 'ready' || profile.setupStatus === 'not_tracked')
const operationNotice = (reply: WorkerReply) => {
  const operation = readOperation(reply.body.operation)
  return operation
    ? `${operation.displayName}: ${operation.emailAttemptState === 'accepted' ? 'Link requested' : 'Link request pending'}. ${operation.accessEnabled ? 'Access enabled' : 'Access not yet enabled'}. Operation ${operation.id}`
    : 'Request recorded.'
}
const readPage = <T,>(
  value: unknown,
  key: string,
  read: (item: unknown) => T | undefined,
) => {
  const data = record(value)
  const items = data?.[key]
  if (!Array.isArray(items)) return undefined
  const parsed = items.map(read)
  return parsed.every((item) => item !== undefined)
    ? { items: parsed as T[], next: data?.nextCursor }
    : undefined
}

type Filters = Readonly<{ name: string; role: string; enabled: string }>
export function AccountsScreen() {
  const { client } = useAdmin()
  const api = useWorkerApi()
  const alive = useAlive()
  const dirty = useDirtyForm()
  const [filters, setFilters] = useState<Filters>({
    name: '',
    role: '',
    enabled: '',
  })
  const [items, setItems] = useState<readonly AccountSummary[]>([])
  const [cursor, setCursor] = useState<Json | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [found, setFound] = useState<AccountSummary | 'not_found' | undefined>(
    undefined,
  )
  const [lookupError, setLookupError] = useState('')
  const load = useCallback(
    async (after: Json | undefined = undefined) => {
      const result = await client.rpc('admin_list_accounts', {
        name_query: filters.name || null,
        role_filter:
          filters.role === 'admin' ||
          filters.role === 'coach' ||
          filters.role === 'player'
            ? filters.role
            : null,
        enabled_filter: filters.enabled ? filters.enabled === 'enabled' : null,
        page_cursor: after ?? null,
        page_size: 20,
      })
      if (!alive()) return
      const page = result.error
        ? undefined
        : readPage(result.data, 'items', readAccountSummary)
      if (!page) {
        setState('error')
        return
      }
      setItems((prior) => (after ? [...prior, ...page.items] : page.items))
      setCursor((page.next ?? undefined) as Json | undefined)
      setState('ready')
    },
    [client, filters, alive],
  )
  const action = useAdminAction(() => load())
  useEffect(() => {
    document.title = 'Accounts | SFDA Coaches'
    // This effect starts an external read; state changes occur after it.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])
  return (
    <>
      <div>
        <p className={styles.eyebrow}>Admin</p>
        <h1>Accounts</h1>
        <p>
          Find a person by name, role or access, or look up an exact login
          email. Each account change saves separately.
        </p>
      </div>
      <ActionStatus action={action} reload={() => void load()} />
      <section className={styles.card} aria-labelledby="directory-heading">
        <h2 id="directory-heading">Account directory</h2>
        <form
          className={layout.filters}
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setState('loading')
            setFilters({
              name: field(form, 'name'),
              role: field(form, 'role'),
              enabled: field(form, 'enabled'),
            })
          }}
        >
          <div>
            <label htmlFor="directory-name">Name contains</label>
            <input id="directory-name" name="name" maxLength={160} />
          </div>
          <div>
            <label htmlFor="directory-role">Role</label>
            <select id="directory-role" name="role">
              <option value="">Any role</option>
              <option value="admin">Admin</option>
              <option value="coach">Coach</option>
              <option value="player">Player</option>
            </select>
          </div>
          <div>
            <label htmlFor="directory-access">Access</label>
            <select id="directory-access" name="enabled">
              <option value="">Any access</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <button>Search accounts</button>
        </form>
        <LoadState state={state} retry={() => void load()}>
          {items.length ? (
            <ul className={layout.operations}>
              {items.map((item) => (
                <li key={item.id}>
                  <Link to={`/admin/accounts/${item.id}`}>
                    <strong>{item.displayName}</strong>
                  </Link>
                  <p>
                    {roleLabels[item.role]}.{' '}
                    {item.enabled ? 'Access enabled' : 'Access disabled'}.{' '}
                    {setupLabels[item.setupStatus]}.
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">No accounts match these filters.</p>
          )}
          {cursor !== undefined && (
            <button type="button" onClick={() => void load(cursor)}>
              Load more accounts
            </button>
          )}
        </LoadState>
      </section>
      <div className={layout.columns}>
        <section className={styles.card} aria-labelledby="lookup-heading">
          <h2 id="lookup-heading">Find by login email</h2>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              const email = field(new FormData(event.currentTarget), 'email')
              setLookupError('')
              setFound(undefined)
              void api('/api/admin/accounts/lookup', { email }).then(
                (reply) => {
                  if (!alive()) return
                  const profile = readAccountSummary(reply.body.profile)
                  if (reply.ok && profile) setFound(profile)
                  else if (reply.ok && reply.body.outcome === 'not_found')
                    setFound('not_found')
                  else setLookupError(friendly(reply.body.code))
                },
              )
            }}
          >
            <div>
              <label htmlFor="lookup-email">Login email</label>
              <input
                id="lookup-email"
                name="email"
                type="email"
                required
                autoComplete="off"
              />
            </div>
            <button>Find account</button>
          </form>
          <div aria-live="polite">
            {found === 'not_found' && (
              <p>No application account uses this email.</p>
            )}
            {found && found !== 'not_found' && (
              <p>
                <Link to={`/admin/accounts/${found.id}`}>
                  {found.displayName}
                </Link>
                , {roleLabels[found.role]}.
              </p>
            )}
            {lookupError && <p role="alert">{lookupError}</p>}
          </div>
        </section>
        <section className={styles.card} aria-labelledby="add-heading">
          <h2 id="add-heading">Add coach or player</h2>
          <p>
            The person chooses their own password from the setup link. Access is
            enabled only after setup records the link request.
          </p>
          <form
            className={styles.form}
            onInput={dirty.onInput}
            onSubmit={(event) => {
              event.preventDefault()
              const element = event.currentTarget
              const form = new FormData(element)
              const body = {
                mutationId: crypto.randomUUID(),
                email: field(form, 'email'),
                displayName: field(form, 'displayName'),
                role: field(form, 'role'),
              }
              void action
                .run({
                  requestId: body.mutationId,
                  label: 'Account creation',
                  send: async () => {
                    const reply = await api('/api/admin/accounts', body)
                    return workerOutcome(reply, operationNotice(reply))
                  },
                })
                .then((saved) => {
                  if (saved) {
                    element.reset()
                    dirty.clean()
                  }
                })
            }}
          >
            <fieldset disabled={action.locked} className={layout.fields}>
              <legend>New account</legend>
              <div>
                <label htmlFor="new-name">Display name</label>
                <input
                  id="new-name"
                  name="displayName"
                  maxLength={160}
                  required
                />
              </div>
              <div>
                <label htmlFor="new-email">Account email</label>
                <input
                  id="new-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="new-role">Role</label>
                <select id="new-role" name="role">
                  <option value="coach">Coach</option>
                  <option value="player">Player</option>
                </select>
              </div>
              <button className={styles.primary}>
                Create account and request link
              </button>
            </fieldset>
          </form>
        </section>
      </div>
    </>
  )
}

type Detail = Readonly<{
  profile: AccountSummary
  loginEmail: string | null
  currentLinkKind: 'setup' | 'recovery' | null
  recoveryEligible: boolean
  setupOperations: readonly AccountOperation[]
}>
const readDetail = (value: unknown): Detail | undefined => {
  const data = record(value)
  const profile = readAccountSummary(data?.profile)
  const operations = Array.isArray(data?.setupOperations)
    ? data.setupOperations.map(readOperation)
    : undefined
  if (
    !data ||
    !profile ||
    !operations ||
    operations.some((item) => !item) ||
    typeof data.recoveryEligible !== 'boolean' ||
    !(data.loginEmail === null || typeof data.loginEmail === 'string') ||
    ![null, 'setup', 'recovery'].includes(data.currentLinkKind as string)
  )
    return undefined
  return {
    profile,
    loginEmail: data.loginEmail,
    currentLinkKind: data.currentLinkKind as Detail['currentLinkKind'],
    recoveryEligible: data.recoveryEligible,
    setupOperations: operations as AccountOperation[],
  }
}
type Pending =
  | Readonly<{ kind: 'access'; enabled: boolean }>
  | Readonly<{ kind: 'recovery' }>
  | Readonly<{ kind: 'replace'; operation: AccountOperation }>

export function AccountDetailScreen() {
  const { id = '' } = useParams()
  const { client } = useAdmin()
  const api = useWorkerApi()
  const alive = useAlive()
  const dirty = useDirtyForm()
  const [detail, setDetail] = useState<Detail | undefined>(undefined)
  const [history, setHistory] = useState<readonly RecoveryProgress[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | undefined>(
    undefined,
  )
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [missing, setMissing] = useState(false)
  const [dialog, setDialog] = useState<Pending | undefined>(undefined)
  const load = useCallback(async () => {
    const [account, recoveries] = await Promise.all([
      api(`/api/admin/accounts/${id}`),
      api(
        `/api/admin/recovery-operations?${new URLSearchParams({ targetProfileId: id })}`,
      ),
    ])
    if (!alive()) return
    const parsed = readDetail(account.body)
    const page = readPage(recoveries.body, 'operations', readRecoveryProgress)
    setMissing(account.body.code === 'NOT_FOUND')
    if (!account.ok || !parsed || !recoveries.ok || !page) {
      setDetail(undefined)
      setState('error')
      return
    }
    setDetail(parsed)
    setHistory(page.items)
    setHistoryCursor(typeof page.next === 'string' ? page.next : undefined)
    setState('ready')
  }, [api, id, alive])
  const loadMoreHistory = async () => {
    if (!historyCursor) return
    const reply = await api(
      `/api/admin/recovery-operations?${new URLSearchParams({ targetProfileId: id, cursor: historyCursor })}`,
    )
    const page = readPage(reply.body, 'operations', readRecoveryProgress)
    if (!alive() || !page) return
    setHistory((prior) => [...prior, ...page.items])
    setHistoryCursor(typeof page.next === 'string' ? page.next : undefined)
  }
  const action = useAdminAction(load)
  useEffect(() => {
    document.title = 'Account details | SFDA Coaches'
    // This effect starts external reads; state changes occur after them.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])
  if (missing)
    return (
      <section className={styles.empty}>
        <h1>This account is unavailable</h1>
        <Link to="/admin/accounts">Back to accounts</Link>
      </section>
    )
  const profile = detail?.profile
  const setupAction = (path: string, label: string, version: number) => {
    const body = { mutationId: crypto.randomUUID(), expectedVersion: version }
    void action.run({
      requestId: body.mutationId,
      label,
      send: async () => {
        const reply = await api(path, body)
        return workerOutcome(reply, operationNotice(reply))
      },
    })
  }
  return (
    <>
      <Link to="/admin/accounts">Back to accounts</Link>
      <LoadState state={state} retry={() => void load()}>
        {detail && profile && (
          <>
            <div>
              <p className={styles.eyebrow}>{roleLabels[profile.role]}</p>
              <h1>{profile.displayName}</h1>
              <dl className={styles.metadata}>
                <dt>Login email</dt>
                <dd>{detail.loginEmail ?? 'Not yet confirmed'}</dd>
                <dt>Access</dt>
                <dd>{profile.enabled ? 'Enabled' : 'Disabled'}</dd>
                <dt>Setup</dt>
                <dd>
                  {setupLabels[profile.setupStatus]}.{' '}
                  {profile.passwordInitialized
                    ? 'Password chosen.'
                    : 'No known password yet.'}
                </dd>
                <dt>Current password link</dt>
                <dd>
                  {detail.currentLinkKind === null
                    ? 'None'
                    : detail.currentLinkKind === 'setup'
                      ? 'Setup link'
                      : 'Recovery link'}
                </dd>
              </dl>
            </div>
            <ActionStatus action={action} reload={() => void load()} />
            <div className={layout.columns}>
              <section className={styles.card} aria-labelledby="name-heading">
                <h2 id="name-heading">Display name</h2>
                {editable(profile) ? (
                  <form
                    className={styles.form}
                    onInput={dirty.onInput}
                    onSubmit={(event) => {
                      event.preventDefault()
                      const element = event.currentTarget
                      const form = new FormData(element)
                      const request = prepareMutation('update_profile_name', {
                        profile_id: profile.id,
                        display_name: field(form, 'displayName'),
                        expected_version: profile.version,
                        reason: field(form, 'reason'),
                      })
                      void action
                        .run({
                          requestId: request.inputs.mutation_id,
                          label: 'Name change',
                          send: async () =>
                            rpcOutcome(
                              await executeMutation(client, request),
                              'Display name saved.',
                            ),
                        })
                        .then((saved) => {
                          if (saved) {
                            element.reset()
                            dirty.clean()
                          }
                        })
                    }}
                  >
                    <fieldset
                      disabled={action.locked}
                      className={layout.fields}
                    >
                      <legend>Change display name</legend>
                      <div>
                        <label htmlFor="edit-name">New display name</label>
                        <input
                          id="edit-name"
                          name="displayName"
                          defaultValue={profile.displayName}
                          maxLength={160}
                          required
                        />
                      </div>
                      <ReasonField id="edit-name-reason" />
                      <button>Save name</button>
                    </fieldset>
                  </form>
                ) : (
                  <p>
                    {profile.role === 'admin'
                      ? 'Administrator names are read only here.'
                      : 'Names can change after account setup is ready.'}
                  </p>
                )}
              </section>
              <section className={styles.card} aria-labelledby="access-heading">
                <h2 id="access-heading">Access</h2>
                {profile.role === 'admin' ? (
                  <p>Administrator access is read only here.</p>
                ) : profile.enabled ? (
                  <>
                    <p>
                      Disabling stops work at once and invalidates any current
                      password link. Campaign history stays.
                    </p>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={action.locked}
                      onClick={() =>
                        setDialog({ kind: 'access', enabled: false })
                      }
                    >
                      Disable access
                    </button>
                  </>
                ) : editable(profile) ? (
                  <>
                    <p>
                      Enabling restores only active campaign assignments. Old
                      password links stay invalid.
                    </p>
                    <button
                      type="button"
                      disabled={action.locked}
                      onClick={() =>
                        setDialog({ kind: 'access', enabled: true })
                      }
                    >
                      Enable access
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      Setup is not finished. Access is enabled through Resume on
                      its setup operation, not here. Blocking setup invalidates
                      its current link, and a later resume then needs
                      reconciliation.
                    </p>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={action.locked}
                      onClick={() =>
                        setDialog({ kind: 'access', enabled: false })
                      }
                    >
                      Block setup
                    </button>
                  </>
                )}
              </section>
            </div>
            <section className={styles.card} aria-labelledby="password-heading">
              <h2 id="password-heading">Password link</h2>
              <p>
                A new password link invalidates any older setup or recovery link
                for this account. One email can be requested per minute.
              </p>
              {detail.recoveryEligible ? (
                <button
                  type="button"
                  disabled={action.locked}
                  onClick={() => setDialog({ kind: 'recovery' })}
                >
                  Send password recovery link
                </button>
              ) : (
                <p>
                  Recovery is available for enabled accounts that have already
                  chosen a password.
                </p>
              )}
              <h3>Recovery history</h3>
              {history.length ? (
                <ul className={layout.operations}>
                  {history.map((item) => (
                    <li key={item.id}>
                      <p>
                        <strong>{recoveryLabels[item.status]}</strong>.{' '}
                        {item.source === 'admin'
                          ? `Admin request: ${item.reasonLabel ?? 'no reason'}`
                          : 'Requested from Forgot password'}
                        . {item.current ? 'Current link.' : 'Not current.'}
                      </p>
                      <p className={styles.support}>
                        {new Date(item.createdAt).toLocaleString()}. Operation{' '}
                        {item.id}.
                        {item.safeError ? ` ${friendly(item.safeError)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recovery requests yet.</p>
              )}
              {historyCursor && (
                <button type="button" onClick={() => void loadMoreHistory()}>
                  Load more recovery history
                </button>
              )}
            </section>
            {profile.role !== 'admin' && (
              <section className={styles.card} aria-labelledby="setup-heading">
                <h2 id="setup-heading">Setup operations</h2>
                {detail.setupOperations.length ? (
                  <ul className={layout.operations}>
                    {detail.setupOperations.map((operation) => (
                      <li key={operation.id}>
                        <p>
                          {operation.kind === 'provision'
                            ? 'Account setup'
                            : 'Replacement link'}
                          : {operation.checkpoint.replaceAll('_', ' ')}. Email
                          attempt:{' '}
                          {operation.emailAttemptState.replaceAll('_', ' ')}.
                        </p>
                        <p className={styles.support}>
                          Operation {operation.id}.
                        </p>
                        <div className={styles.actions}>
                          {operation.checkpoint !== 'ready' && (
                            <button
                              type="button"
                              disabled={action.locked}
                              onClick={() =>
                                setupAction(
                                  `/api/admin/account-operations/${operation.id}/resume`,
                                  'Setup resume',
                                  operation.version,
                                )
                              }
                            >
                              Resume
                            </button>
                          )}
                          {operation.kind === 'provision' &&
                            !profile.passwordInitialized &&
                            ['profile_created', 'ready'].includes(
                              operation.checkpoint,
                            ) && (
                              <button
                                type="button"
                                disabled={action.locked}
                                onClick={() =>
                                  setDialog({ kind: 'replace', operation })
                                }
                              >
                                Request replacement setup link
                              </button>
                            )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>This account was not created through tracked setup.</p>
                )}
              </section>
            )}
            {dialog?.kind === 'access' && (
              <ActionDialog
                title={dialog.enabled ? 'Enable access?' : 'Disable access?'}
                confirmLabel={
                  dialog.enabled ? 'Enable access' : 'Disable access'
                }
                danger={!dialog.enabled}
                close={() => setDialog(undefined)}
                confirm={(form) => {
                  const request = prepareMutation('set_profile_access', {
                    profile_id: profile.id,
                    enabled: dialog.enabled,
                    expected_version: profile.version,
                    reason: field(form, 'reason'),
                  })
                  void action.run({
                    requestId: request.inputs.mutation_id,
                    label: 'Access change',
                    send: async () =>
                      rpcOutcome(
                        await executeMutation(client, request),
                        dialog.enabled ? 'Access enabled.' : 'Access disabled.',
                      ),
                  })
                }}
              >
                <p>
                  {dialog.enabled
                    ? `${profile.displayName} regains their active campaign assignments.`
                    : `${profile.displayName} loses access at once. Any current password link stops working.`}
                </p>
                <ReasonField id="access-reason" />
              </ActionDialog>
            )}
            {dialog?.kind === 'recovery' && (
              <ActionDialog
                title="Send a password recovery link?"
                confirmLabel="Send link"
                close={() => setDialog(undefined)}
                confirm={(form) => {
                  const body = {
                    mutationId: crypto.randomUUID(),
                    expectedProfileVersion: profile.version,
                    reason: field(form, 'reason') as RecoveryReason,
                  }
                  void action.run({
                    requestId: body.mutationId,
                    label: 'Recovery request',
                    send: async () =>
                      workerOutcome(
                        await api(
                          `/api/admin/accounts/${profile.id}/recovery`,
                          body,
                        ),
                        'Password recovery link requested.',
                      ),
                  })
                }}
              >
                <p>
                  The link goes to the account login email. Any older password
                  link stops working.
                </p>
                <div>
                  <label htmlFor="recovery-reason">Reason</label>
                  <select id="recovery-reason" name="reason" required>
                    {Object.entries(recoveryReasons).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </ActionDialog>
            )}
            {dialog?.kind === 'replace' && (
              <ActionDialog
                title="Request a replacement setup link?"
                confirmLabel="Request replacement"
                close={() => setDialog(undefined)}
                confirm={() =>
                  setupAction(
                    `/api/admin/account-operations/${dialog.operation.id}/setup-link`,
                    'Replacement link',
                    dialog.operation.version,
                  )
                }
              >
                <p>The previous setup link stops working immediately.</p>
              </ActionDialog>
            )}
          </>
        )}
      </LoadState>
    </>
  )
}
