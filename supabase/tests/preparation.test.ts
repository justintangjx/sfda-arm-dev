import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

const url = process.env.SFDA_TEST_SUPABASE_URL
const publicKey = process.env.SFDA_TEST_SUPABASE_PUBLIC_KEY
const adminKey = process.env.SFDA_TEST_SUPABASE_ADMIN_KEY
if (
  !url ||
  !publicKey ||
  !adminKey ||
  !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(url)
)
  throw new Error('A verified local Supabase test target is required.')
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const operator = createClient(url, adminKey, options)
const anonymous = createClient(url, publicKey, options)
const client = () => createClient(url, publicKey, options)
type Identity = { id: string; client: SupabaseClient }
let admin: Identity
let coach: Identity
let other: Identity
let unrelated: Identity
let player: Identity
let missing: Identity
let disabled: Identity

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a database result object.')
  return value as Record<string, unknown>
}
const checked = (error: { code?: string } | null) => {
  if (error)
    throw new Error(`Database request failed (${error.code ?? 'UNKNOWN'}).`)
}
const rpc = async (
  identity: Identity,
  name: string,
  inputs: Record<string, unknown> = {},
  mutationId = randomUUID(),
) => {
  const { data, error } = await identity.client.rpc(name, {
    ...inputs,
    mutation_id: mutationId,
  })
  checked(error)
  return object(data)
}
const reference = (result: Record<string, unknown>) => object(result.result)
const idOf = (result: Record<string, unknown>) => {
  const id = reference(result).id
  if (typeof id !== 'string')
    throw new Error('Expected a database record identity.')
  return id
}
const account = async (): Promise<Identity> => {
  const email = `synthetic-${randomUUID()}@example.invalid`
  const password = `Synthetic!${randomUUID()}`
  const created = await operator.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  checked(created.error)
  if (!created.data.user)
    throw new Error('Synthetic Auth identity was unavailable.')
  const scoped = client()
  const signedIn = await scoped.auth.signInWithPassword({ email, password })
  checked(signedIn.error)
  return { id: created.data.user.id, client: scoped }
}
const provision = async (role: 'coach' | 'player', enabled = true) => {
  const identity = await account()
  await rpc(admin, 'create_profile', {
    profile_id: identity.id,
    display_name: 'Synthetic person',
    role,
  })
  if (enabled)
    await rpc(admin, 'set_profile_access', {
      profile_id: identity.id,
      enabled: true,
      expected_version: 1,
      reason: 'Synthetic test access',
    })
  return identity
}
const competition = async () =>
  idOf(
    await rpc(admin, 'create_competition', {
      name: `Synthetic event ${randomUUID()}`,
      starts_on: null,
      ends_on: null,
    }),
  )
const campaign = async (
  competitionId: string,
  author = coach,
  roster = player,
) => {
  const id = idOf(
    await rpc(admin, 'create_campaign', {
      competition_id: competitionId,
      name: 'Synthetic campaign',
      team_name: `Synthetic team ${randomUUID()}`,
      planned_preparation_start_on: '2099-01-01',
    }),
  )
  await rpc(admin, 'set_campaign_coach', {
    campaign_id: id,
    coach_id: author.id,
    active: true,
    expected_version: null,
    reason: 'Synthetic assignment',
  })
  await rpc(admin, 'set_campaign_player', {
    campaign_id: id,
    player_id: roster.id,
    active: true,
    expected_version: null,
    reason: 'Synthetic roster',
  })
  return id
}
const open = async (id: string) =>
  rpc(admin, 'advance_campaign_stage', {
    campaign_id: id,
    expected_version: 1,
    next_stage: 'preparation',
    reason: 'Synthetic stage opening',
  })
const content = {
  observations: 'Synthetic reviewed observation.',
  strengths: null,
  development_focus: null,
  observed_on: '2026-01-01',
}
const feedback = (id: string, override: Record<string, unknown> = {}) => ({
  campaign_id: id,
  player_id: player.id,
  kind: 'preparation',
  content,
  review_confirmed: true,
  draft_id: null,
  expected_version: null,
  ...override,
})
const rejected = async (
  identity: Identity,
  name: string,
  inputs: Record<string, unknown>,
  code: string,
  mutationId = randomUUID(),
) => {
  const { error } = await identity.client.rpc(name, {
    ...inputs,
    mutation_id: mutationId,
  })
  expect(error?.message).toBe(code)
  expect(error?.details).toBeNull()
  expect(error?.hint).toBeNull()
}

beforeAll(async () => {
  admin = await account()
  // Trusted synthetic fixture setup only. This is no production bootstrap procedure.
  checked(
    (
      await operator.from('profiles').insert({
        id: admin.id,
        display_name: 'Synthetic admin',
        role: 'admin',
        access_enabled: true,
      })
    ).error,
  )
  checked(
    (
      await operator.from('audit_events').insert({
        actor_kind: 'bootstrap',
        action: 'admin_bootstrapped',
        target_type: 'profile',
        target_id: admin.id,
        metadata: {},
      })
    ).error,
  )
  coach = await provision('coach')
  other = await provision('coach')
  unrelated = await provision('coach')
  player = await provision('player')
  disabled = await provision('coach', false)
  missing = await account()
})

describe('real local Supabase preparation boundary (AC-1 through AC-5, AC-11, AC-12, AC-14 through AC-16)', () => {
  it('runs the thin Auth, assignment, reviewed submission and private read path (covers: AC-1, AC-2, AC-3, AC-4, AC-5, AC-16)', async () => {
    const id = await campaign(await competition())
    await open(id)
    for (let i = 0; i < 3; i++)
      await rpc(coach, 'submit_feedback', feedback(id))
    const own = await coach.client
      .from('feedback_entries')
      .select('id,coach_id,competition_id,observed_on,submitted_at')
      .eq('campaign_id', id)
    checked(own.error)
    expect(own.data).toHaveLength(3)
    expect(
      own.data?.every(
        (row) =>
          row.coach_id === coach.id &&
          row.observed_on === content.observed_on &&
          row.submitted_at,
      ),
    ).toBe(true)
    for (const identity of [player, unrelated, other, disabled, missing]) {
      const read = await identity.client
        .from('feedback_entries')
        .select('id')
        .eq('campaign_id', id)
      checked(read.error)
      expect(read.data).toEqual([])
    }
    const read = await admin.client
      .from('feedback_entries')
      .select('id')
      .eq('campaign_id', id)
    checked(read.error)
    expect(read.data).toHaveLength(3)
    expect(
      (await anonymous.from('feedback_entries').select('id')).error,
    ).not.toBeNull()
    expect(
      object((await missing.client.rpc('get_my_access')).data).status,
    ).toBe('missing')
    expect(
      object((await disabled.client.rpc('get_my_access')).data).enabled,
    ).toBe(false)
    expect(object((await player.client.rpc('get_my_access')).data).role).toBe(
      'player',
    )
  })

  it('keeps drafts private, validates explicit review and consumes the reviewed snapshot (covers: AC-3, AC-4, AC-5, AC-12, AC-13)', async () => {
    const id = await campaign(await competition())
    await open(id)
    const saved = await rpc(
      coach,
      'save_feedback_draft',
      feedback(id, {
        content: { ...content, observations: null, observed_on: null },
      }),
    )
    const draftId = idOf(saved)
    expect(
      (
        await admin.client
          .from('feedback_entries')
          .select('id')
          .eq('id', draftId)
      ).data,
    ).toEqual([])
    await rejected(coach, 'submit_feedback', feedback(id), 'DRAFT_EXISTS')
    await rejected(
      coach,
      'save_feedback_draft',
      feedback(id, {
        draft_id: draftId,
        expected_version: 1,
        review_confirmed: false,
      }),
      'INVALID_INPUT',
    )
    const updated = await rpc(
      coach,
      'save_feedback_draft',
      feedback(id, { draft_id: draftId, expected_version: 1 }),
    )
    expect(reference(updated).version).toBe(2)
    await rejected(
      coach,
      'save_feedback_draft',
      feedback(id, { draft_id: draftId, expected_version: 1 }),
      'VERSION_CONFLICT',
    )
    const submitted = await rpc(
      coach,
      'submit_feedback',
      feedback(id, {
        draft_id: draftId,
        expected_version: 2,
        content: {
          ...content,
          observations: 'Synthetic coach reviewed replacement.',
        },
      }),
    )
    expect(idOf(submitted)).toBe(draftId)
    expect(reference(submitted).version).toBe(3)
  })

  it('binds a pairing to its first campaign even without feedback and after removal (covers: AC-2, AC-11)', async () => {
    const competitionId = await competition()
    const first = await campaign(competitionId)
    await rpc(admin, 'set_campaign_player', {
      campaign_id: first,
      player_id: player.id,
      active: false,
      expected_version: 1,
      reason: 'Synthetic withdrawal',
    })
    const second = idOf(
      await rpc(admin, 'create_campaign', {
        competition_id: competitionId,
        name: 'Synthetic second campaign',
        team_name: randomUUID(),
        planned_preparation_start_on: null,
      }),
    )
    await rpc(admin, 'set_campaign_coach', {
      campaign_id: second,
      coach_id: coach.id,
      active: true,
      expected_version: null,
      reason: 'Synthetic assignment',
    })
    await rejected(
      admin,
      'set_campaign_player',
      {
        campaign_id: second,
        player_id: player.id,
        active: true,
        expected_version: null,
        reason: 'Synthetic admission',
      },
      'PAIR_CONFLICT',
    )
    expect(
      (
        await admin.client
          .from('campaign_players')
          .select('player_id')
          .eq('campaign_id', second)
      ).data,
    ).toEqual([])
    await rpc(admin, 'set_campaign_player', {
      campaign_id: first,
      player_id: player.id,
      active: true,
      expected_version: 2,
      reason: 'Synthetic restoration',
    })
  })

  it('replays simultaneous requests once and rejects changed payloads with no extra audit (covers: AC-12, AC-15)', async () => {
    const id = await campaign(await competition())
    await open(id)
    const key = randomUUID()
    const results = await Promise.all([
      rpc(coach, 'submit_feedback', feedback(id), key),
      rpc(coach, 'submit_feedback', feedback(id), key),
    ])
    expect(results.map((value) => value.outcome).sort()).toEqual([
      'already_committed',
      'committed',
    ])
    expect(idOf(results[0]!)).toBe(idOf(results[1]!))
    await rejected(
      coach,
      'submit_feedback',
      feedback(id, {
        content: { ...content, observations: 'Different synthetic text.' },
      }),
      'IDEMPOTENCY_CONFLICT',
      key,
    )
    const audit = await admin.client
      .from('audit_events')
      .select('id,actor_id,metadata')
      .eq('mutation_id', key)
    checked(audit.error)
    expect(audit.data).toHaveLength(1)
    expect(audit.data?.[0]?.actor_id).toBe(coach.id)
    expect(JSON.stringify(audit.data)).not.toContain(content.observations)
  })

  it('preserves former coach reads but stops writes, and checks revocation against an issued token (covers: AC-3, AC-11)', async () => {
    const author = other
    const id = await campaign(await competition(), author)
    await open(id)
    const submission = await rpc(author, 'submit_feedback', feedback(id))
    const key = randomUUID()
    const removed = await rpc(
      admin,
      'set_campaign_coach',
      {
        campaign_id: id,
        coach_id: author.id,
        active: false,
        expected_version: 1,
        reason: 'Synthetic removal',
      },
      key,
    )
    const replay = await rpc(
      admin,
      'set_campaign_coach',
      {
        campaign_id: id,
        coach_id: author.id,
        active: false,
        expected_version: 1,
        reason: 'Synthetic removal',
      },
      key,
    )
    expect(reference(replay).coachId).toBe(author.id)
    expect(reference(replay).campaignId).toBe(id)
    expect(reference(replay).version).toBe(reference(removed).version)
    expect(
      (
        await author.client
          .from('feedback_entries')
          .select('id')
          .eq('id', idOf(submission))
      ).data,
    ).toHaveLength(1)
    await rejected(author, 'submit_feedback', feedback(id), 'FORBIDDEN')
    await rpc(admin, 'set_profile_access', {
      profile_id: author.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic revocation',
    })
    expect(
      (
        await author.client
          .from('feedback_entries')
          .select('id')
          .eq('campaign_id', id)
      ).data,
    ).toEqual([])
    await rejected(author, 'submit_feedback', feedback(id), 'FORBIDDEN')
    await rpc(admin, 'set_profile_access', {
      profile_id: author.id,
      enabled: true,
      expected_version: 3,
      reason: 'Synthetic reactivation',
    })
  })

  it('rejects invalid dates, content, names, roles and future observations without partial effects (covers: AC-1, AC-5, AC-15)', async () => {
    const id = await campaign(await competition())
    await open(id)
    for (const change of [
      { observations: '  ' },
      { observations: 'x'.repeat(10001) },
      { strengths: 'x'.repeat(5001) },
      { observed_on: '2026-02-30' },
      { observed_on: 'infinity' },
      { observed_on: '2099-01-01' },
    ])
      await rejected(
        coach,
        'submit_feedback',
        feedback(id, { content: { ...content, ...change } }),
        'INVALID_INPUT',
      )
    await rejected(
      coach,
      'submit_feedback',
      feedback(id, {
        content: { ...content, transcript: 'Unreviewed synthetic proposal.' },
      }),
      'INVALID_INPUT',
    )
    await rejected(
      admin,
      'create_competition',
      { name: '   ', starts_on: null, ends_on: null },
      'INVALID_INPUT',
    )
    await rejected(
      admin,
      'create_profile',
      {
        profile_id: randomUUID(),
        display_name: 'Synthetic absent account',
        role: 'coach',
      },
      'AUTH_USER_MISSING',
    )
    await rejected(
      admin,
      'create_profile',
      {
        profile_id: missing.id,
        display_name: 'Synthetic forbidden admin',
        role: 'admin',
      },
      'INVALID_INPUT',
    )
    expect(
      (
        await coach.client
          .from('feedback_entries')
          .select('id')
          .eq('campaign_id', id)
      ).data,
    ).toEqual([])
  })

  it('denies ordinary direct DML and forbidden profile and receipt columns (covers: AC-3, AC-15, AC-16)', async () => {
    for (const identity of [admin, coach, player, disabled, missing]) {
      for (const table of [
        'profiles',
        'competitions',
        'campaigns',
        'campaign_coaches',
        'campaign_players',
        'competition_pairings',
        'feedback_entries',
        'audit_events',
        'mutation_receipts',
      ]) {
        expect(
          (await identity.client.from(table).insert({})).error,
        ).not.toBeNull()
        expect(
          (
            await identity.client
              .from(table)
              .update({ created_at: '2026-01-01' })
              .neq('created_at', '2000-01-01')
          ).error,
        ).not.toBeNull()
        expect(
          (
            await identity.client
              .from(table)
              .delete()
              .neq('created_at', '2000-01-01')
          ).error,
        ).not.toBeNull()
      }
    }
    expect(
      (await coach.client.from('profiles').select('id,role,access_enabled'))
        .error,
    ).not.toBeNull()
    expect(
      (await admin.client.from('mutation_receipts').select('request_hash'))
        .error,
    ).not.toBeNull()
    expect((await coach.client.from('audit_events').select('id')).data).toEqual(
      [],
    )
    await rejected(
      player,
      'create_competition',
      { name: randomUUID(), starts_on: null, ends_on: null },
      'FORBIDDEN',
    )
  })
})

describe('preparation access regression checks on real Supabase', () => {
  it('isolates two assigned authors and protects discard with ownership and version checks (covers: AC-3, AC-4, AC-12, AC-14, AC-15)', async () => {
    const id = await campaign(await competition())
    await rpc(admin, 'set_campaign_coach', {
      campaign_id: id,
      coach_id: other.id,
      active: true,
      expected_version: null,
      reason: 'Synthetic second author',
    })
    await open(id)
    const draft = idOf(await rpc(coach, 'save_feedback_draft', feedback(id)))
    const otherDraft = idOf(
      await rpc(other, 'save_feedback_draft', feedback(id)),
    )
    expect(otherDraft).not.toBe(draft)
    for (const [identity, expected] of [
      [coach, draft],
      [other, otherDraft],
    ] as const) {
      const result = await identity.client
        .from('feedback_entries')
        .select('id')
        .eq('campaign_id', id)
      checked(result.error)
      expect(result.data).toEqual([{ id: expected }])
    }
    await rejected(coach, 'save_feedback_draft', feedback(id), 'DRAFT_EXISTS')
    await rejected(
      other,
      'discard_feedback_draft',
      { draft_id: draft, expected_version: 1 },
      'NOT_FOUND',
    )
    await rejected(
      coach,
      'discard_feedback_draft',
      { draft_id: draft, expected_version: 2 },
      'VERSION_CONFLICT',
    )
    expect(
      (await coach.client.from('feedback_entries').select('id').eq('id', draft))
        .data,
    ).toEqual([{ id: draft }])
    const key = randomUUID()
    const input = { draft_id: draft, expected_version: 1 }
    const discarded = await rpc(coach, 'discard_feedback_draft', input, key)
    expect(reference(discarded)).toMatchObject({ id: draft, exists: false })
    expect(
      await rpc(coach, 'discard_feedback_draft', input, key),
    ).toMatchObject({
      outcome: 'already_committed',
      result: { id: draft, exists: false },
    })
    await rejected(coach, 'discard_feedback_draft', input, 'NOT_FOUND')
    expect(
      (
        await other.client
          .from('feedback_entries')
          .select('id')
          .eq('id', otherDraft)
      ).data,
    ).toEqual([{ id: otherDraft }])
    expect(
      (
        await admin.client
          .from('audit_events')
          .select('id')
          .eq('mutation_id', key)
      ).data,
    ).toHaveLength(1)
  })

  it('stops preparation writes for a withdrawn player while retaining submitted history (covers: AC-3, AC-11)', async () => {
    const id = await campaign(await competition())
    await open(id)
    const submitted = idOf(await rpc(coach, 'submit_feedback', feedback(id)))
    await rpc(admin, 'set_campaign_player', {
      campaign_id: id,
      player_id: player.id,
      active: false,
      expected_version: 1,
      reason: 'Synthetic withdrawal',
    })
    for (const name of ['submit_feedback', 'save_feedback_draft'])
      await rejected(coach, name, feedback(id), 'NOT_FOUND')
    for (const identity of [coach, admin]) {
      const read = await identity.client
        .from('feedback_entries')
        .select('id')
        .eq('id', submitted)
      checked(read.error)
      expect(read.data).toEqual([{ id: submitted }])
    }
  })

  it('checks current account access before replaying a committed request (covers: AC-1, AC-11, AC-12, AC-15)', async () => {
    const author = await provision('coach')
    const id = await campaign(await competition(), author)
    await open(id)
    const key = randomUUID()
    const submitted = idOf(
      await rpc(author, 'submit_feedback', feedback(id), key),
    )
    await rpc(admin, 'set_campaign_coach', {
      campaign_id: id,
      coach_id: author.id,
      active: false,
      expected_version: 1,
      reason: 'Synthetic removal',
    })
    expect(
      await rpc(author, 'submit_feedback', feedback(id), key),
    ).toMatchObject({ outcome: 'already_committed', result: { id: submitted } })
    await rpc(admin, 'set_profile_access', {
      profile_id: author.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic access revocation',
    })
    await rejected(author, 'submit_feedback', feedback(id), 'FORBIDDEN', key)
    const receipt = await author.client
      .from('mutation_receipts')
      .select('mutation_id')
      .eq('mutation_id', key)
    checked(receipt.error)
    expect(receipt.data).toEqual([])
    expect(
      (
        await admin.client
          .from('audit_events')
          .select('id')
          .eq('mutation_id', key)
      ).data,
    ).toHaveLength(1)
  })

  it('keeps every preparation table scoped to assigned callers and denies missing profiles (covers: AC-1, AC-2, AC-3, AC-11, AC-15, AC-16)', async () => {
    const event = await competition()
    const id = await campaign(event)
    await open(id)
    const key = randomUUID()
    const submitted = idOf(
      await rpc(coach, 'submit_feedback', feedback(id), key),
    )
    const tables = [
      {
        name: 'profiles',
        column: 'id',
        value: player.id,
        columns: 'id,display_name',
      },
      { name: 'competitions', column: 'id', value: event, columns: 'id' },
      { name: 'campaigns', column: 'id', value: id, columns: 'id' },
      {
        name: 'campaign_coaches',
        column: 'campaign_id',
        value: id,
        columns: 'coach_id',
      },
      {
        name: 'campaign_players',
        column: 'campaign_id',
        value: id,
        columns: 'player_id',
      },
      {
        name: 'competition_pairings',
        column: 'campaign_id',
        value: id,
        columns: 'coach_id,player_id',
      },
      {
        name: 'feedback_entries',
        column: 'id',
        value: submitted,
        columns: 'id',
      },
      {
        name: 'mutation_receipts',
        column: 'mutation_id',
        value: key,
        columns: 'mutation_id',
      },
    ]
    for (const table of tables) {
      for (const identity of [admin, coach]) {
        const result = await identity.client
          .from(table.name)
          .select(table.columns)
          .eq(table.column, table.value)
        checked(result.error)
        expect(
          result.data,
          `${table.name} for an authorised caller`,
        ).toHaveLength(1)
      }
      for (const identity of [player, unrelated, missing, disabled]) {
        const result = await identity.client
          .from(table.name)
          .select(table.columns)
          .eq(table.column, table.value)
        checked(result.error)
        expect(result.data, `${table.name} for an excluded caller`).toEqual([])
      }
      expect(
        (
          await anonymous
            .from(table.name)
            .select(table.columns)
            .eq(table.column, table.value)
        ).error,
      ).not.toBeNull()
    }
    for (const identity of [coach, player, unrelated, missing, disabled]) {
      const audit = await identity.client
        .from('audit_events')
        .select('id')
        .eq('mutation_id', key)
      checked(audit.error)
      expect(audit.data).toEqual([])
    }
  })

  it.each([
    { content: null },
    { content: [] },
    { kind: null },
    { review_confirmed: null },
    { content: { ...content, observations: 17 } },
    { content: { ...content, development_focus: 'x'.repeat(5001) } },
  ])(
    'rejects malformed reviewed input without a receipt or audit %# (covers: AC-5, AC-13, AC-15)',
    async (change) => {
      const id = await campaign(await competition())
      await open(id)
      const key = randomUUID()
      await rejected(
        coach,
        'submit_feedback',
        feedback(id, change),
        'INVALID_INPUT',
        key,
      )
      expect(
        (
          await coach.client
            .from('feedback_entries')
            .select('id')
            .eq('campaign_id', id)
        ).data,
      ).toEqual([])
      expect(
        (
          await admin.client
            .from('mutation_receipts')
            .select('mutation_id')
            .eq('mutation_id', key)
        ).data,
      ).toEqual([])
      expect(
        (
          await admin.client
            .from('audit_events')
            .select('id')
            .eq('mutation_id', key)
        ).data,
      ).toEqual([])
    },
  )

  it('denies a tampered token before returning data (covers: AC-1, AC-3, AC-16)', async () => {
    const session = await coach.client.auth.getSession()
    if (!session.data.session)
      throw new Error('Expected a synthetic coach session.')
    const parts = session.data.session.access_token.split('.')
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    payload.sub = admin.id
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`
    const attacker = createClient(url!, publicKey!, {
      ...options,
      global: { headers: { Authorization: `Bearer ${tampered}` } },
    })
    const result = await attacker.from('feedback_entries').select('id')
    expect(result.status).toBe(401)
    expect(result.data).toBeNull()
  })
})
