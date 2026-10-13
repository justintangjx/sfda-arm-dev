import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { AccountSummary } from '../../domain/accounts'
import { executeMutation, prepareMutation } from '../data/mutations'
import { loadAdmissionCandidates } from '../data/admission'
import styles from '../coach/coach.module.css'
import layout from '../accounts/accounts.module.css'
import {
  field,
  rpcOutcome,
  useAdmin,
  useAdminAction,
  useAlive,
  type AdminAction,
} from './actions'
import { ActionDialog, ActionStatus, LoadState, ReasonField } from './shared'

type Cursor = Readonly<{ createdAt: string; id: string }>
type CampaignRow = Readonly<{
  id: string
  name: string
  team_name: string
  stage: string
  version: number
  created_at: string
  competitions: Readonly<{ name: string }> | null
}>
const stageLabel = (stage: string) => stage.replaceAll('_', ' ')
// New members can join only before requirements freeze.
const openForAdmission = (stage: string) =>
  stage === 'setup' || stage === 'preparation'
const pageSize = 20

export function CampaignsScreen() {
  const { client, configuration } = useAdmin()
  const alive = useAlive()
  const [rows, setRows] = useState<readonly CampaignRow[]>([])
  const [cursor, setCursor] = useState<Cursor | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const load = useCallback(
    async (after: Cursor | undefined = undefined) => {
      let query = client
        .from('campaigns')
        .select('id,name,team_name,stage,version,created_at,competitions(name)')
        .order('created_at')
        .order('id')
        .limit(pageSize + 1)
      if (after)
        query = query.or(
          `created_at.gt.${after.createdAt},and(created_at.eq.${after.createdAt},id.gt.${after.id})`,
        )
      const result = await query
      if (!alive()) return
      if (result.error) {
        setState('error')
        return
      }
      const page = (result.data ?? []) as readonly CampaignRow[]
      const kept = page.slice(0, pageSize)
      const last = kept.at(-1)
      setRows((prior) => (after ? [...prior, ...kept] : kept))
      setCursor(
        page.length > pageSize && last
          ? { createdAt: last.created_at, id: last.id }
          : undefined,
      )
      setState('ready')
    },
    [client, alive],
  )
  useEffect(() => {
    document.title = 'Campaigns | SFDA Coaches'
    // This effect starts an external read; state changes occur after it.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])
  return (
    <>
      <div>
        <p className={styles.eyebrow}>Admin</p>
        <h1>Campaigns</h1>
        <p>
          Choose a campaign to maintain its coach assignments and player roster.
          {configuration.appEnv === 'local' &&
            ' Competitions and campaigns are created in the setup workspace.'}
        </p>
      </div>
      <section className={styles.card} aria-labelledby="campaigns-heading">
        <h2 id="campaigns-heading">All campaigns</h2>
        <LoadState state={state} retry={() => void load()}>
          {rows.length ? (
            <ul className={layout.operations}>
              {rows.map((row) => (
                <li key={row.id}>
                  <Link to={`/admin/campaigns/${row.id}`}>
                    <strong>{row.name}</strong>
                  </Link>
                  <p>
                    {row.team_name}. {row.competitions?.name ?? 'Competition'}.
                    Stage: {stageLabel(row.stage)}.
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">No campaigns yet.</p>
          )}
          {cursor && (
            <button type="button" onClick={() => void load(cursor)}>
              Load more campaigns
            </button>
          )}
        </LoadState>
      </section>
    </>
  )
}

type Member = Readonly<{
  id: string
  active: boolean
  version: number
  createdAt: string
  name: string
}>
type Role = 'coach' | 'player'
type Change = Readonly<{ role: Role; member: Member }>

export function CampaignDetailScreen() {
  const { id = '' } = useParams()
  const { client } = useAdmin()
  const alive = useAlive()
  const [campaign, setCampaign] = useState<CampaignRow | undefined>(undefined)
  const [members, setMembers] = useState<
    Readonly<Record<Role, readonly Member[]>>
  >({ coach: [], player: [] })
  const [candidates, setCandidates] = useState<readonly AccountSummary[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [missing, setMissing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [change, setChange] = useState<Change | undefined>(undefined)
  const load = useCallback(async () => {
    const [found, coaches, players, eligible] = await Promise.all([
      client
        .from('campaigns')
        .select('id,name,team_name,stage,version,created_at,competitions(name)')
        .eq('id', id)
        .maybeSingle(),
      client
        .from('campaign_coaches')
        .select('coach_id,is_active,version,created_at')
        .eq('campaign_id', id)
        .order('created_at')
        .order('coach_id'),
      client
        .from('campaign_players')
        .select('player_id,is_active,version,created_at')
        .eq('campaign_id', id)
        .order('created_at')
        .order('player_id'),
      loadAdmissionCandidates(client),
    ])
    if (!alive()) return
    if (found.error || coaches.error || players.error || !eligible.ok) {
      setState('error')
      return
    }
    if (!found.data) {
      setMissing(true)
      return
    }
    const ids = [
      ...(coaches.data ?? []).map((row) => row.coach_id),
      ...(players.data ?? []).map((row) => row.player_id),
    ]
    const names = ids.length
      ? await client.from('profiles').select('id,display_name').in('id', ids)
      : { data: [], error: null }
    if (!alive()) return
    if (names.error) {
      setState('error')
      return
    }
    const nameOf = (person: string) =>
      names.data?.find((row) => row.id === person)?.display_name ?? 'Unknown'
    setCampaign(found.data as CampaignRow)
    setMembers({
      coach: (coaches.data ?? []).map((row) => ({
        id: row.coach_id,
        active: row.is_active,
        version: row.version,
        createdAt: row.created_at,
        name: nameOf(row.coach_id),
      })),
      player: (players.data ?? []).map((row) => ({
        id: row.player_id,
        active: row.is_active,
        version: row.version,
        createdAt: row.created_at,
        name: nameOf(row.player_id),
      })),
    })
    setCandidates(eligible.value)
    setState('ready')
  }, [client, id, alive])
  const action = useAdminAction(load)
  useEffect(() => {
    document.title = 'Campaign roster | SFDA Coaches'
    // This effect starts external reads; state changes occur after them.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])
  if (missing)
    return (
      <section className={styles.empty}>
        <h1>This campaign is unavailable</h1>
        <Link to="/admin/campaigns">Back to campaigns</Link>
      </section>
    )
  const membership = (
    role: Role,
    person: string,
    active: boolean,
    version: number | null,
    reason: string,
    notice: string,
  ) => {
    const request =
      role === 'coach'
        ? prepareMutation('set_campaign_coach', {
            campaign_id: id,
            coach_id: person,
            active,
            expected_version: version,
            reason,
          })
        : prepareMutation('set_campaign_player', {
            campaign_id: id,
            player_id: person,
            active,
            expected_version: version,
            reason,
          })
    void action.run({
      requestId: request.inputs.mutation_id,
      label: 'Membership change',
      send: async () =>
        rpcOutcome(await executeMutation(client, request), notice),
    })
  }
  return (
    <>
      <Link to="/admin/campaigns">Back to campaigns</Link>
      <LoadState state={state} retry={() => void load()}>
        {campaign && (
          <>
            <div>
              <p className={styles.eyebrow}>
                {campaign.competitions?.name ?? 'Campaign'}
              </p>
              <h1>{campaign.name}</h1>
              <p>
                {campaign.team_name}. Stage: {stageLabel(campaign.stage)}.
              </p>
              {!openForAdmission(campaign.stage) &&
                campaign.stage !== 'closed' && (
                  <p className={styles.support}>
                    Final requirements are frozen. New coaches and players
                    cannot be added, and withdrawn players cannot be restored.
                    Existing removed coaches can be restored without adding
                    final obligations.
                  </p>
                )}
              {campaign.stage === 'closed' && (
                <p className={styles.support}>
                  This campaign is closed. Memberships are history only.
                </p>
              )}
            </div>
            <ActionStatus action={action} reload={() => void load()} />
            <div className={layout.filters}>
              <label htmlFor="member-filter">Show</label>
              <select
                id="member-filter"
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as typeof filter)
                }
              >
                <option value="all">All members</option>
                <option value="active">Active only</option>
                <option value="inactive">Removed only</option>
              </select>
            </div>
            <div className={layout.columns}>
              {(['coach', 'player'] as const).map((role) => (
                <Roster
                  key={role}
                  role={role}
                  stage={campaign.stage}
                  members={members[role].filter(
                    (member) =>
                      filter === 'all' ||
                      member.active === (filter === 'active'),
                  )}
                  candidates={candidates.filter(
                    (item) =>
                      item.role === role &&
                      !members[role].some((member) => member.id === item.id),
                  )}
                  action={action}
                  admit={(person) =>
                    membership(
                      role,
                      person,
                      true,
                      null,
                      role === 'coach'
                        ? 'Initial coach assignment'
                        : 'Initial player roster assignment',
                      role === 'coach' ? 'Coach assigned.' : 'Player added.',
                    )
                  }
                  change={(member) => setChange({ role, member })}
                />
              ))}
            </div>
            {change && (
              <ActionDialog
                title={
                  change.member.active
                    ? `Remove ${change.member.name}?`
                    : `Restore ${change.member.name}?`
                }
                confirmLabel={change.member.active ? 'Remove' : 'Restore'}
                danger={change.member.active}
                close={() => setChange(undefined)}
                confirm={(form) =>
                  membership(
                    change.role,
                    change.member.id,
                    !change.member.active,
                    change.member.version,
                    field(form, 'reason'),
                    change.member.active
                      ? 'Membership removed. History is kept.'
                      : 'Membership restored.',
                  )
                }
              >
                <p>
                  {change.member.active
                    ? 'Feedback history stays. Removed coaches keep read access to their own history.'
                    : 'Restoring brings back current access to this campaign.'}
                </p>
                <ReasonField id="membership-reason" />
              </ActionDialog>
            )}
          </>
        )}
      </LoadState>
    </>
  )
}

export function Roster({
  role,
  stage,
  members,
  candidates,
  action,
  admit,
  change,
}: Readonly<{
  role: Role
  stage: string
  members: readonly Member[]
  candidates: readonly AccountSummary[]
  action: AdminAction
  admit: (person: string) => void
  change: (member: Member) => void
}>) {
  const title = role === 'coach' ? 'Coach assignments' : 'Player roster'
  const admissionOpen = openForAdmission(stage)
  return (
    <section className={styles.card} aria-labelledby={`${role}-heading`}>
      <h2 id={`${role}-heading`}>{title}</h2>
      {members.length ? (
        <ul className={layout.operations}>
          {members.map((member) => {
            const canChange =
              stage !== 'closed' &&
              (member.active || role === 'coach' || openForAdmission(stage))
            return (
              <li key={member.id}>
                <p>
                  <strong>{member.name}</strong>{' '}
                  <span className={styles.badge}>
                    {member.active ? 'Active' : 'Removed'}
                  </span>
                </p>
                {canChange ? (
                  <button
                    type="button"
                    disabled={action.locked}
                    onClick={() => change(member)}
                  >
                    {member.active ? 'Remove' : 'Restore'}
                  </button>
                ) : (
                  <p className={styles.support}>
                    {member.active
                      ? 'No changes after the campaign closes.'
                      : 'Restoration is unavailable at this stage.'}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p>No members match.</p>
      )}
      {admissionOpen ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            const person = field(new FormData(event.currentTarget), 'person')
            if (person) admit(person)
          }}
        >
          <fieldset disabled={action.locked} className={layout.fields}>
            <legend>
              {role === 'coach' ? 'Assign a coach' : 'Add a player'}
            </legend>
            <label htmlFor={`${role}-admit`}>
              {role === 'coach' ? 'Coach' : 'Player'}
            </label>
            <select id={`${role}-admit`} name="person" required>
              <option value="">
                {candidates.length
                  ? `Choose a ${role}`
                  : `No enabled ${role}s available`}
              </option>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName} ({item.id.slice(0, 8)})
                </option>
              ))}
            </select>
            <p className={styles.support}>
              Only enabled accounts with finished setup appear here.
            </p>
            <button>{role === 'coach' ? 'Assign coach' : 'Add player'}</button>
          </fieldset>
        </form>
      ) : (
        <p className={styles.support}>
          {stage === 'closed'
            ? 'No memberships change after the campaign closes.'
            : role === 'player'
              ? 'New players can join only before requirements freeze.'
              : 'New coaches can join only before requirements freeze. Existing removed coaches can still be restored.'}
        </p>
      )}
    </section>
  )
}
