import { createHash, randomUUID } from 'node:crypto'
import { localSql } from './sql.ts'
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { ApplicationDatabase } from '../../src/domain/database.ts'
import {
  executeMutation,
  prepareMutation,
} from '../../src/app/data/mutations.ts'
import {
  advance,
  checked,
  content,
  createCampaign,
  createCompetition,
  createFixture,
  feedback,
  finalCampaign,
  idOf,
  object,
  read,
  ref,
  rejected,
  rpc,
  type Fixture,
} from './fixture.ts'

let fixture: Fixture
beforeAll(async () => {
  fixture = await createFixture()
})
const obligations = async (id: string) => {
  const data = await read(fixture.admin, 'list_final_obligations', {
    campaign_id: id,
  })
  if (!Array.isArray(data.items)) throw new Error('Expected obligation page.')
  return data.items.map(object)
}
const obligationId = async (
  id: string,
  coachId = fixture.coach.id,
  playerId = fixture.player.id,
) => {
  const row = (await obligations(id)).find(
    (row) => row.coachId === coachId && row.playerId === playerId,
  )
  if (typeof row?.id !== 'string')
    throw new Error('Expected frozen obligation.')
  return row.id
}

describe('real final lifecycle and retention (AC-1 through AC-16)', () => {
  it('freezes exact active pairings, deletes preparation drafts and replays a deleted reference (covers: AC-6, AC-7, AC-11, AC-12, AC-14)', async () => {
    const { admin, coach, other, player, secondPlayer } = fixture
    const id = await createCampaign(
      fixture,
      await createCompetition(admin),
      [coach, other],
      [player, secondPlayer],
    )
    await advance(admin, id, 1, 'preparation')
    const key = randomUUID()
    const input = feedback(id, player.id, 'preparation')
    const draft = await rpc(coach, 'save_feedback_draft', input, key)
    await rpc(admin, 'set_campaign_coach', {
      campaign_id: id,
      coach_id: other.id,
      active: false,
      expected_version: 1,
      reason: 'Synthetic removal before freeze',
    })
    await rpc(admin, 'set_profile_access', {
      profile_id: player.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic disabled login remains designated',
    })
    const transition = await advance(admin, id, 2, 'competition')
    expect(ref(transition).metadata).toMatchObject({
      obligations_created: 2,
      drafts_deleted: 1,
      stage: 'competition',
    })
    const replay = await rpc(coach, 'save_feedback_draft', input, key)
    expect(ref(replay).exists).toBe(false)
    expect(idOf(replay)).toBe(idOf(draft))
    await rejected(coach, 'save_feedback_draft', input, 'STAGE_CLOSED')
    await rejected(
      admin,
      'set_campaign_coach',
      {
        campaign_id: id,
        coach_id: other.id,
        active: true,
        expected_version: null,
        reason: 'Synthetic incorrect version',
      },
      'INVALID_INPUT',
    )
    await rpc(admin, 'set_campaign_coach', {
      campaign_id: id,
      coach_id: other.id,
      active: true,
      expected_version: 2,
      reason: 'Synthetic restoration after freeze',
    })
    expect(await obligations(id)).toHaveLength(2)
    await rejected(
      admin,
      'set_campaign_player',
      {
        campaign_id: id,
        player_id: secondPlayer.id,
        active: true,
        expected_version: 1,
        reason: 'Synthetic post freeze activation',
      },
      'STAGE_LOCKED',
    )
    await rpc(admin, 'set_campaign_player', {
      campaign_id: id,
      player_id: player.id,
      active: false,
      expected_version: 1,
      reason: 'Synthetic withdrawal after freeze',
    })
    await advance(admin, id, 3, 'final_feedback')
    await rpc(coach, 'submit_feedback', feedback(id, player.id))
    const completion = await read(coach, 'get_campaign_completion', {
      campaign_id: id,
    })
    expect(completion).toMatchObject({
      frozen: true,
      scope: 'self',
      required: 2,
      submitted: 1,
      waived: 0,
      outstanding: 1,
    })
    await rpc(admin, 'set_profile_access', {
      profile_id: player.id,
      enabled: true,
      expected_version: 3,
      reason: 'Synthetic login restoration',
    })
  })

  it('allows one final under distinct concurrent requests and replays the committed request after closure (covers: AC-8, AC-12, AC-15)', async () => {
    const { admin, coach, player } = fixture
    const id = await finalCampaign(fixture)
    const keys = [randomUUID(), randomUUID()]
    const input = feedback(id, player.id)
    const responses = await Promise.all(
      keys.map((key) =>
        coach.client.rpc('submit_feedback', { ...input, mutation_id: key }),
      ),
    )
    expect(responses.filter((response) => !response.error)).toHaveLength(1)
    expect(responses.find((response) => response.error)?.error?.message).toBe(
      'ALREADY_SUBMITTED',
    )
    const winner = responses.findIndex((response) => !response.error)
    const reference = object(responses[winner]!.data)
    await advance(admin, id, 4, 'closed')
    const replay = await rpc(coach, 'submit_feedback', input, keys[winner])
    expect(idOf(replay)).toBe(idOf(reference))
    expect(replay.outcome).toBe('already_committed')
    expect(
      (
        await admin.client
          .from('audit_events')
          .select('id')
          .in('mutation_id', keys)
      ).data,
    ).toHaveLength(1)
    expect(
      (
        await coach.client
          .from('feedback_history')
          .select('id')
          .eq('campaign_id', id)
      ).data,
    ).toHaveLength(1)
    await rejected(coach, 'submit_feedback', input, 'STAGE_CLOSED')
    const independent = await finalCampaign(fixture)
    await rpc(coach, 'submit_feedback', feedback(independent, player.id))
  })

  it('orders final submission against waiver and closes only when all obligations are resolved (covers: AC-9, AC-12)', async () => {
    const { admin, coach, player } = fixture
    const id = await finalCampaign(fixture)
    const obligation = await obligationId(id)
    await rejected(
      admin,
      'advance_campaign_stage',
      {
        campaign_id: id,
        expected_version: 4,
        next_stage: 'closed',
        reason: 'Synthetic premature closure',
      },
      'OUTSTANDING_FINALS',
    )
    const finalKey = randomUUID()
    const waiverKey = randomUUID()
    const [submission, waiver] = await Promise.all([
      coach.client.rpc('submit_feedback', {
        ...feedback(id, player.id),
        mutation_id: finalKey,
      }),
      admin.client.rpc('waive_final_obligation', {
        obligation_id: obligation,
        reason: 'Synthetic nonparticipation',
        mutation_id: waiverKey,
      }),
    ])
    expect(
      [submission, waiver].filter((response) => !response.error),
    ).toHaveLength(1)
    expect(submission.error?.message ?? waiver.error?.message).toBe(
      submission.error ? 'OBLIGATION_WAIVED' : 'ALREADY_SUBMITTED',
    )
    const completion = await read(admin, 'get_campaign_completion', {
      campaign_id: id,
    })
    expect(completion.outstanding).toBe(0)
    const closed = await advance(admin, id, 4, 'closed')
    expect(ref(closed).metadata).toMatchObject({
      required: 1,
      submitted: submission.error ? 0 : 1,
      waived: waiver.error ? 0 : 1,
    })
    expect(
      (
        await admin.client
          .from('audit_events')
          .select('id')
          .in('mutation_id', [finalKey, waiverKey])
      ).data,
    ).toHaveLength(1)
  })

  it('keeps waivers permanent after restoration and deletes final drafts on closure (covers: AC-9, AC-14)', async () => {
    const { admin, coach, player } = fixture
    const id = await finalCampaign(fixture)
    const key = randomUUID()
    const input = feedback(id, player.id)
    const draft = await rpc(coach, 'save_feedback_draft', input, key)
    const obligation = await obligationId(id)
    await rejected(
      admin,
      'waive_final_obligation',
      { obligation_id: obligation, reason: ' ' },
      'INVALID_INPUT',
    )
    await rpc(admin, 'waive_final_obligation', {
      obligation_id: obligation,
      reason: 'Synthetic exception',
    })
    await rpc(admin, 'set_campaign_coach', {
      campaign_id: id,
      coach_id: coach.id,
      active: false,
      expected_version: 1,
      reason: 'Synthetic removal',
    })
    await rpc(admin, 'set_campaign_coach', {
      campaign_id: id,
      coach_id: coach.id,
      active: true,
      expected_version: 2,
      reason: 'Synthetic restoration',
    })
    await rejected(coach, 'submit_feedback', input, 'OBLIGATION_WAIVED')
    await rejected(
      admin,
      'waive_final_obligation',
      { obligation_id: obligation, reason: 'Synthetic repeated waiver' },
      'ALREADY_WAIVED',
    )
    const closed = await advance(admin, id, 4, 'closed')
    expect(ref(closed).metadata).toMatchObject({
      drafts_deleted: 1,
      required: 1,
      submitted: 0,
      waived: 1,
    })
    expect(
      ref(await rpc(coach, 'save_feedback_draft', input, key)).exists,
    ).toBe(false)
    expect(
      (
        await coach.client
          .from('feedback_entries')
          .select('id')
          .eq('id', idOf(draft))
      ).data,
    ).toEqual([])
    const receipts = await admin.client
      .from('mutation_receipts')
      .select('result_metadata')
      .eq('campaign_id', id)
    checked(receipts.error)
    expect(JSON.stringify(receipts.data)).not.toContain(content.observations)
    expect(JSON.stringify(receipts.data)).not.toContain(content.observed_on)
  })

  it('appends ordered corrections after closure while preserving the original and submission time (covers: AC-3, AC-10, AC-12, AC-14)', async () => {
    const { admin, coach, other, player } = fixture
    const id = await finalCampaign(fixture)
    const submissionId = idOf(
      await rpc(coach, 'submit_feedback', feedback(id, player.id)),
    )
    const before = await coach.client
      .from('feedback_entries')
      .select('observations,observed_on,submitted_at,coach_id,version')
      .eq('id', submissionId)
      .single()
    checked(before.error)
    await advance(admin, id, 4, 'closed')
    const inputs = {
      feedback_id: submissionId,
      content: {
        ...content,
        observations: 'Synthetic corrected content.',
        observed_on: '2026-01-02',
      },
      reason: 'Synthetic correction reason',
      expected_revision: 0,
    }
    const results = await Promise.all([
      fixture.secondAdmin.client.rpc('correct_feedback', {
        ...inputs,
        mutation_id: randomUUID(),
      }),
      admin.client.rpc('correct_feedback', {
        ...inputs,
        mutation_id: randomUUID(),
      }),
    ])
    expect(results.filter((result) => !result.error)).toHaveLength(1)
    expect(results.find((result) => result.error)?.error?.message).toBe(
      'VERSION_CONFLICT',
    )
    const key = randomUUID()
    await rpc(
      admin,
      'correct_feedback',
      {
        ...inputs,
        expected_revision: 1,
        content: {
          ...inputs.content,
          strengths: 'Synthetic corrected strength.',
        },
      },
      key,
    )
    expect(
      (
        await rpc(
          admin,
          'correct_feedback',
          {
            ...inputs,
            expected_revision: 1,
            content: {
              ...inputs.content,
              strengths: 'Synthetic corrected strength.',
            },
          },
          key,
        )
      ).outcome,
    ).toBe('already_committed')
    const after = await coach.client
      .from('feedback_entries')
      .select('observations,observed_on,submitted_at,coach_id,version')
      .eq('id', submissionId)
      .single()
    checked(after.error)
    expect(after.data).toEqual(before.data)
    const history = await coach.client
      .from('feedback_history')
      .select('original,latest,correction_revision,correction_attribution')
      .eq('id', submissionId)
      .single()
    checked(history.error)
    expect(history.data).toMatchObject({
      original: { observations: content.observations },
      latest: {
        observations: inputs.content.observations,
        strengths: 'Synthetic corrected strength.',
      },
      correction_revision: 2,
      correction_attribution: 'Admin',
    })
    const revisions = await coach.client
      .from('feedback_corrections')
      .select('revision')
      .eq('feedback_id', submissionId)
      .order('revision')
    checked(revisions.error)
    expect(revisions.data).toEqual([{ revision: 1 }, { revision: 2 }])
    expect(
      (
        await other.client
          .from('feedback_corrections')
          .select('id')
          .eq('feedback_id', submissionId)
      ).data,
    ).toEqual([])
    await rejected(coach, 'correct_feedback', inputs, 'FORBIDDEN')
    expect(
      (
        await fixture.operator
          .from('feedback_entries')
          .delete()
          .eq('id', submissionId)
      ).error?.message,
    ).toBe('IMMUTABLE_RECORD')
    expect(
      (await fixture.operator.auth.admin.deleteUser(coach.id)).error,
    ).not.toBeNull()
  })

  it('keeps coach completion private and pages tied timestamps without duplicates (covers: AC-3, AC-6, AC-9)', async () => {
    const { admin, coach, other, player, secondPlayer } = fixture
    const id = await finalCampaign(
      fixture,
      [coach, other],
      [player, secondPlayer],
    )
    await rpc(other, 'submit_feedback', feedback(id, player.id))
    expect(
      await read(coach, 'get_campaign_completion', { campaign_id: id }),
    ).toMatchObject({
      scope: 'self',
      required: 2,
      submitted: 0,
      outstanding: 2,
    })
    expect(
      await read(admin, 'get_campaign_completion', { campaign_id: id }),
    ).toMatchObject({
      scope: 'campaign',
      required: 4,
      submitted: 1,
      outstanding: 3,
    })
    const ids: unknown[] = []
    let cursor: unknown = null
    for (let page = 0; page < 5; page++) {
      const result = await read(admin, 'list_final_obligations', {
        campaign_id: id,
        page_size: 1,
        page_cursor: cursor,
      })
      if (!Array.isArray(result.items))
        throw new Error('Expected bounded obligation page.')
      ids.push(...result.items.map((item) => object(item).id))
      cursor = result.nextCursor
      if (!cursor) break
    }
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    expect(
      (await obligations(id)).filter((row) => row.status === 'submitted'),
    ).toHaveLength(1)
    expect(
      (
        await fixture.player.client.rpc('get_campaign_completion', {
          campaign_id: id,
        })
      ).error?.message,
    ).toBe('NOT_FOUND')
    expect(
      (
        await admin.client.rpc('list_final_obligations', {
          campaign_id: id,
          page_size: 101,
        })
      ).error?.message,
    ).toBe('INVALID_INPUT')
  })

  it('handles an explicit zero obligation snapshot without skipping stages (covers: AC-6, AC-9)', async () => {
    const { admin } = fixture
    const id = await createCampaign(
      fixture,
      await createCompetition(admin),
      [],
      [],
    )
    expect(
      await read(admin, 'get_campaign_completion', { campaign_id: id }),
    ).toMatchObject({ frozen: false, required: 0 })
    await rejected(
      admin,
      'advance_campaign_stage',
      {
        campaign_id: id,
        expected_version: 1,
        next_stage: 'closed',
        reason: 'Synthetic skip',
      },
      'STAGE_CONFLICT',
    )
    await advance(admin, id, 1, 'preparation')
    await advance(admin, id, 2, 'competition')
    expect(
      await read(admin, 'get_campaign_completion', { campaign_id: id }),
    ).toMatchObject({ frozen: true, required: 0, stage: 'competition' })
    await advance(admin, id, 3, 'final_feedback')
    await advance(admin, id, 4, 'closed')
    await rejected(
      admin,
      'advance_campaign_stage',
      {
        campaign_id: id,
        expected_version: 5,
        next_stage: 'preparation',
        reason: 'Synthetic reopen',
      },
      'STAGE_CONFLICT',
    )
  })

  it('orders draft save against stage end so a late save cannot resurrect content (covers: AC-6, AC-12, AC-14)', async () => {
    const { admin, coach, player } = fixture
    const id = await createCampaign(fixture, await createCompetition(admin))
    await advance(admin, id, 1, 'preparation')
    const [save, transition] = await Promise.all([
      coach.client.rpc('save_feedback_draft', {
        ...feedback(id, player.id, 'preparation'),
        mutation_id: randomUUID(),
      }),
      admin.client.rpc('advance_campaign_stage', {
        campaign_id: id,
        expected_version: 2,
        next_stage: 'competition',
        reason: 'Synthetic race',
        mutation_id: randomUUID(),
      }),
    ])
    checked(transition.error)
    if (save.error) expect(save.error.message).toBe('STAGE_CLOSED')
    expect(
      (
        await coach.client
          .from('feedback_entries')
          .select('id')
          .eq('campaign_id', id)
      ).data,
    ).toEqual([])
    expect(await obligations(id)).toHaveLength(1)
  })

  it('recovers a simulated lost response after a real commit with one record and audit event (covers: AC-12, AC-15)', async () => {
    const { url, publicKey, coach, admin, player } = fixture
    const session = await coach.client.auth.getSession()
    checked(session.error)
    if (!session.data.session) throw new Error('Synthetic session unavailable.')
    let loseResponse = true
    const waits: number[] = []
    const client = createClient<ApplicationDatabase>(url, publicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (input, init) => {
          const response = await fetch(input, init)
          if (
            loseResponse &&
            response.ok &&
            String(input).includes('/rpc/submit_feedback')
          ) {
            loseResponse = false
            await response.text()
            throw new TypeError(
              'Synthetic lost response after real database commit',
            )
          }
          return response
        },
        headers: {
          Authorization: `Bearer ${session.data.session.access_token}`,
        },
      },
    })
    const id = await createCampaign(fixture, await createCompetition(admin))
    await advance(admin, id, 1, 'preparation')
    const request = prepareMutation('submit_feedback', {
      campaign_id: id,
      player_id: player.id,
      kind: 'preparation',
      content,
      review_confirmed: true,
      draft_id: null,
      expected_version: null,
    })
    const first = await executeMutation(
      client,
      request,
      async (milliseconds) => {
        waits.push(milliseconds)
      },
    )
    const replay = await executeMutation(client, request)
    expect(first.ok).toBe(true)
    expect(replay.ok).toBe(true)
    expect(waits).toEqual([250])
    if (first.ok && replay.ok) {
      expect(first.value.outcome).toBe('already_committed')
      expect(replay.value.outcome).toBe('already_committed')
      expect(replay.value.result).toEqual(first.value.result)
    }
    expect(
      (
        await admin.client
          .from('audit_events')
          .select('id')
          .eq('mutation_id', request.inputs.mutation_id)
      ).data,
    ).toHaveLength(1)
  })
  it('serializes pairing admission across campaigns and different administrators (covers: AC-2, AC-12)', async () => {
    const { admin, secondAdmin, coach, player } = fixture
    const competition = await createCompetition(admin)
    const first = await createCampaign(fixture, competition, [coach], [])
    const second = await createCampaign(fixture, competition, [coach], [])
    const inputs = (id: string) => ({
      campaign_id: id,
      player_id: player.id,
      active: true,
      expected_version: null,
      reason: 'Synthetic concurrent admission',
      mutation_id: randomUUID(),
    })
    const results = await Promise.all([
      admin.client.rpc('set_campaign_player', inputs(first)),
      secondAdmin.client.rpc('set_campaign_player', inputs(second)),
    ])
    expect(results.filter((result) => !result.error)).toHaveLength(1)
    expect(results.find((result) => result.error)?.error?.message).toBe(
      'PAIR_CONFLICT',
    )
    const pairings = await admin.client
      .from('competition_pairings')
      .select('campaign_id')
      .eq('competition_id', competition)
    checked(pairings.error)
    expect(pairings.data).toHaveLength(1)
    const membership = await admin.client
      .from('campaign_players')
      .select('campaign_id')
      .in('campaign_id', [first, second])
    checked(membership.error)
    expect(membership.data).toHaveLength(1)
  })

  it('preserves complete metadata snapshots, rejects identity changes and pages admin profiles (covers: AC-1, AC-2, AC-12, AC-15)', async () => {
    const { admin, coach, player } = fixture
    const competition = await createCompetition(admin)
    const name = `Synthetic normalised ${randomUUID()}`
    const updated = await rpc(admin, 'update_competition', {
      competition_id: competition,
      name: ` ${name} `,
      starts_on: '2026-01-01',
      ends_on: '2026-01-03',
      expected_version: 1,
      reason: 'Synthetic metadata correction',
    })
    expect(ref(updated).version).toBe(2)
    await rejected(
      admin,
      'create_competition',
      { name: name.toUpperCase(), starts_on: null, ends_on: null },
      'NAME_CONFLICT',
    )
    await rejected(
      admin,
      'update_competition',
      {
        competition_id: competition,
        name,
        starts_on: null,
        ends_on: null,
        expected_version: 1,
        reason: 'Synthetic stale change',
      },
      'VERSION_CONFLICT',
    )
    const id = await createCampaign(fixture, competition)
    const campaign = await rpc(admin, 'update_campaign_metadata', {
      campaign_id: id,
      name: 'Synthetic revised campaign',
      team_name: 'Synthetic revised team',
      planned_preparation_start_on: null,
      expected_version: 1,
      reason: 'Synthetic complete snapshot',
    })
    expect(ref(campaign).version).toBe(2)
    await rejected(
      admin,
      'create_campaign',
      {
        competition_id: competition,
        name: 'Synthetic duplicate',
        team_name: ' SYNTHETIC REVISED TEAM ',
        planned_preparation_start_on: null,
      },
      'NAME_CONFLICT',
    )
    const renamed = await rpc(admin, 'update_profile_name', {
      profile_id: player.id,
      display_name: ' Synthetic revised player ',
      expected_version: 4,
      reason: 'Synthetic name correction',
    })
    expect(ref(renamed).version).toBe(5)
    await rejected(
      admin,
      'update_profile_name',
      {
        profile_id: admin.id,
        display_name: 'Synthetic admin conversion',
        expected_version: 1,
        reason: 'Synthetic forbidden operation',
      },
      'FORBIDDEN',
    )
    const { error } = await fixture.operator
      .from('profiles')
      .update({
        role: 'admin',
        version: 3,
        updated_at: new Date().toISOString(),
      })
      .eq('id', coach.id)
    expect(error?.message).toBe('IMMUTABLE_RECORD')
    const page = await read(admin, 'admin_list_profiles', {
      role_filter: 'player',
      page_size: 1,
    })
    expect(Array.isArray(page.items)).toBe(true)
    expect(page.items).toHaveLength(1)
    const next = await read(admin, 'admin_list_profiles', {
      role_filter: 'player',
      page_size: 1,
      page_cursor: page.nextCursor,
    })
    expect(object((next.items as unknown[])[0]).id).not.toBe(
      object((page.items as unknown[])[0]).id,
    )
    expect(
      (
        await coach.client
          .from('profiles')
          .select('id,display_name')
          .eq('id', player.id)
      ).data,
    ).toHaveLength(1)
    await rpc(admin, 'update_profile_name', {
      profile_id: player.id,
      display_name: 'Synthetic person',
      expected_version: 5,
      reason: 'Synthetic fixture restoration',
    })
  })

  it('denies every final table to players and disabled callers, denies direct DML, and requires admin functions (covers: AC-1, AC-3, AC-11, AC-15, AC-16)', async () => {
    const { admin, coach, other, player } = fixture
    const id = await finalCampaign(fixture, [coach, other])
    const original = idOf(
      await rpc(coach, 'submit_feedback', feedback(id, player.id)),
    )
    await rpc(admin, 'correct_feedback', {
      feedback_id: original,
      content,
      reason: 'Synthetic correction',
      expected_revision: 0,
    })
    await rpc(other, 'save_feedback_draft', feedback(id, player.id))
    await rpc(admin, 'waive_final_obligation', {
      obligation_id: await obligationId(id, other.id),
      reason: 'Synthetic exception',
    })
    for (const table of [
      'final_obligations',
      'final_waivers',
      'feedback_corrections',
      'feedback_history',
    ]) {
      expect((await player.client.from(table).select('*')).data).toEqual([])
      expect(
        (await fixture.anonymous.from(table).select('*')).error,
      ).not.toBeNull()
      for (const identity of [admin, coach, player]) {
        expect(
          (await identity.client.from(table).insert({})).error,
        ).not.toBeNull()
        expect(
          (
            await identity.client
              .from(table)
              .update({ reason: 'Synthetic forbidden update' })
              .neq('id', randomUUID())
          ).error,
        ).not.toBeNull()
        expect(
          (await identity.client.from(table).delete().neq('id', randomUUID()))
            .error,
        ).not.toBeNull()
      }
    }
    expect(
      (
        await admin.client
          .from('feedback_entries')
          .select('id')
          .eq('campaign_id', id)
          .eq('status', 'draft')
      ).data,
    ).toEqual([])
    expect(
      (
        await other.client
          .from('feedback_corrections')
          .select('id')
          .eq('feedback_id', original)
      ).data,
    ).toEqual([])
    await rpc(admin, 'set_profile_access', {
      profile_id: other.id,
      enabled: false,
      expected_version: 2,
      reason: 'Synthetic revocation',
    })
    for (const table of [
      'final_obligations',
      'final_waivers',
      'feedback_corrections',
      'feedback_history',
      'campaigns',
      'campaign_players',
    ])
      expect((await other.client.from(table).select('*')).data).toEqual([])
    expect(
      (await other.client.rpc('list_final_obligations', { campaign_id: id }))
        .error?.message,
    ).toBe('NOT_FOUND')
    await rpc(admin, 'set_profile_access', {
      profile_id: other.id,
      enabled: true,
      expected_version: 3,
      reason: 'Synthetic restoration',
    })
    const adminInputs: Record<string, Record<string, unknown>> = {
      create_profile: {
        profile_id: randomUUID(),
        display_name: 'Synthetic forbidden profile',
        role: 'coach',
      },
      update_profile_name: {
        profile_id: player.id,
        display_name: 'Synthetic forbidden name',
        expected_version: 4,
        reason: 'Synthetic forbidden',
      },
      set_profile_access: {
        profile_id: player.id,
        enabled: false,
        expected_version: 4,
        reason: 'Synthetic forbidden',
      },
      create_competition: {
        name: randomUUID(),
        starts_on: null,
        ends_on: null,
      },
      update_competition: {
        competition_id: randomUUID(),
        name: randomUUID(),
        starts_on: null,
        ends_on: null,
        expected_version: 1,
        reason: 'Synthetic forbidden',
      },
      create_campaign: {
        competition_id: randomUUID(),
        name: 'Synthetic forbidden campaign',
        team_name: randomUUID(),
        planned_preparation_start_on: null,
      },
      update_campaign_metadata: {
        campaign_id: id,
        name: 'Synthetic forbidden metadata',
        team_name: randomUUID(),
        planned_preparation_start_on: null,
        expected_version: 4,
        reason: 'Synthetic forbidden',
      },
      set_campaign_coach: {
        campaign_id: id,
        coach_id: coach.id,
        active: false,
        expected_version: 1,
        reason: 'Synthetic forbidden',
      },
      set_campaign_player: {
        campaign_id: id,
        player_id: player.id,
        active: false,
        expected_version: 1,
        reason: 'Synthetic forbidden',
      },
      advance_campaign_stage: {
        campaign_id: id,
        expected_version: 4,
        next_stage: 'closed',
        reason: 'Synthetic forbidden',
      },
      waive_final_obligation: {
        obligation_id: await obligationId(id),
        reason: 'Synthetic forbidden',
      },
      correct_feedback: {
        feedback_id: original,
        content,
        expected_revision: 1,
        reason: 'Synthetic forbidden',
      },
    }
    for (const [name, inputs] of Object.entries(adminInputs)) {
      await rejected(coach, name, inputs, 'FORBIDDEN')
      await rejected(player, name, inputs, 'FORBIDDEN')
      expect(
        (
          await fixture.anonymous.rpc(name, {
            ...inputs,
            mutation_id: randomUUID(),
          })
        ).error,
      ).not.toBeNull()
    }
    expect(
      (await coach.client.rpc('admin_list_profiles', {})).error?.message,
    ).toBe('FORBIDDEN')
    for (const name of ['save_feedback_draft', 'submit_feedback']) {
      await rejected(admin, name, feedback(id, player.id), 'FORBIDDEN')
      await rejected(player, name, feedback(id, player.id), 'FORBIDDEN')
    }
    const signup = await fixture.anonymous.auth.signUp({
      email: `synthetic-${randomUUID()}@example.invalid`,
      password: `Synthetic!${randomUUID()}`,
    })
    expect(signup.error?.code).toBe('signup_disabled')
  })

  it('pins database serialization, grants, restrictive relationships and the Singapore midnight boundary (covers: AC-5, AC-14, AC-16)', () => {
    const serialised =
      '{"input": {"alpha": 1, "nullable": null}, "action": "probe", "fingerprintVersion": 1}'
    const evidence = object(
      localSql(`select jsonb_build_object(
      'beforeMidnight',private.singapore_today('2026-01-01T15:59:59Z'::timestamptz),
      'atMidnight',private.singapore_today('2026-01-01T16:00:00Z'::timestamptz),
      'fingerprintText',jsonb_build_object('fingerprintVersion',1,'action','probe','input',jsonb_build_object('alpha',1,'nullable',null))::text,
      'fingerprint',encode(sha256(convert_to(jsonb_build_object('fingerprintVersion',1,'action','probe','input',jsonb_build_object('alpha',1,'nullable',null))::text,'UTF8')),'hex'),
      'rlsTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity),
      'cascadingForeignKeys',(select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f' and c.confdeltype<>'r'),
      'unsafeFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (not p.prosecdef or not p.proconfig @> array['search_path=""'] or has_function_privilege('anon',p.oid,'execute'))),
      'historyInvokesCaller',(select reloptions @> array['security_invoker=true'] from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='feedback_history')
    );`),
    )
    expect(evidence).toMatchObject({
      beforeMidnight: '2026-01-01',
      atMidnight: '2026-01-02',
      fingerprintText: serialised,
      fingerprint: createHash('sha256').update(serialised).digest('hex'),
      rlsTables: 12,
      cascadingForeignKeys: 0,
      unsafeFunctions: 0,
      historyInvokesCaller: true,
    })
  })
})

describe('final lifecycle regression checks on real Supabase', () => {
  it('consumes an incomplete final draft with reviewed replacement content (covers: AC-4, AC-5, AC-8, AC-9, AC-12)', async () => {
    const { admin, coach, player } = fixture
    const id = await finalCampaign(fixture)
    const draft = idOf(
      await rpc(
        coach,
        'save_feedback_draft',
        feedback(id, player.id, 'final', {
          content: { ...content, observations: null, observed_on: null },
        }),
      ),
    )
    await rejected(
      coach,
      'submit_feedback',
      feedback(id, player.id, 'final', {
        draft_id: draft,
        expected_version: 1,
        review_confirmed: false,
      }),
      'INVALID_INPUT',
    )
    const replacement = {
      ...content,
      observations: 'Synthetic reviewed final replacement.',
    }
    const submitted = await rpc(
      coach,
      'submit_feedback',
      feedback(id, player.id, 'final', {
        draft_id: draft,
        expected_version: 1,
        content: replacement,
      }),
    )
    expect(ref(submitted)).toMatchObject({
      id: draft,
      version: 2,
      exists: true,
    })
    const stored = await coach.client
      .from('feedback_entries')
      .select('observations,observed_on,status,version')
      .eq('id', draft)
      .single()
    checked(stored.error)
    expect(stored.data).toEqual({
      observations: replacement.observations,
      observed_on: content.observed_on,
      status: 'submitted',
      version: 2,
    })
    expect(
      await read(admin, 'get_campaign_completion', { campaign_id: id }),
    ).toMatchObject({ required: 1, submitted: 1, waived: 0, outstanding: 0 })
    await advance(admin, id, 4, 'closed')
  })

  it('rejects new coaches and players after the obligation freeze without adding audit events (covers: AC-6, AC-7, AC-15)', async () => {
    const { admin, coach, other, player, secondPlayer } = fixture
    const id = await finalCampaign(fixture, [coach], [player])
    for (const [action, person] of [
      ['set_campaign_coach', { coach_id: other.id }],
      ['set_campaign_player', { player_id: secondPlayer.id }],
    ] as const) {
      const key = randomUUID()
      await rejected(
        admin,
        action,
        {
          campaign_id: id,
          ...person,
          active: true,
          expected_version: null,
          reason: 'Synthetic late admission',
        },
        'STAGE_LOCKED',
        key,
      )
      expect(
        (
          await admin.client
            .from('audit_events')
            .select('id')
            .eq('mutation_id', key)
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
    }
    expect(await obligations(id)).toHaveLength(1)
  })

  it('keeps obligations, corrections, waivers, receipts and audits immutable even at the trusted fixture boundary (covers: AC-10, AC-14, AC-15)', async () => {
    const { admin, coach, player, secondPlayer, operator } = fixture
    const id = await finalCampaign(fixture, [coach], [player, secondPlayer])
    const submission = await rpc(
      coach,
      'submit_feedback',
      feedback(id, player.id),
    )
    const correction = await rpc(admin, 'correct_feedback', {
      feedback_id: idOf(submission),
      content,
      expected_revision: 0,
      reason: 'Synthetic retained correction',
    })
    const waiver = await rpc(admin, 'waive_final_obligation', {
      obligation_id: await obligationId(id, coach.id, secondPlayer.id),
      reason: 'Synthetic retained waiver',
    })
    const targets = [
      {
        table: 'feedback_entries',
        column: 'id',
        value: idOf(submission),
        update: { observations: 'Synthetic attempted rewrite' },
      },
      {
        table: 'feedback_corrections',
        column: 'id',
        value: idOf(correction),
        update: { reason: 'Synthetic attempted rewrite' },
      },
      {
        table: 'final_waivers',
        column: 'obligation_id',
        value: idOf(waiver),
        update: { reason: 'Synthetic attempted rewrite' },
      },
      {
        table: 'final_obligations',
        column: 'id',
        value: idOf(waiver),
        update: { frozen_at: '2026-01-01T00:00:00Z' },
      },
      {
        table: 'audit_events',
        column: 'mutation_id',
        value: submission.mutationId,
        update: { reason: 'Synthetic attempted rewrite' },
      },
      {
        table: 'mutation_receipts',
        column: 'mutation_id',
        value: submission.mutationId,
        update: { result_version: 9 },
      },
    ]
    for (const target of targets) {
      expect(
        (
          await operator
            .from(target.table)
            .update(target.update)
            .eq(target.column, target.value)
        ).error?.message,
        target.table,
      ).toBe('IMMUTABLE_RECORD')
      expect(
        (
          await operator
            .from(target.table)
            .delete()
            .eq(target.column, target.value)
        ).error?.message,
        target.table,
      ).toBe('IMMUTABLE_RECORD')
    }
    await advance(admin, id, 4, 'closed')
    expect(
      await read(admin, 'get_campaign_completion', { campaign_id: id }),
    ).toMatchObject({
      stage: 'closed',
      submitted: 1,
      waived: 1,
      outstanding: 0,
    })
  })

  it('rolls back a reused key with a different action and retains exactly one audit (covers: AC-12, AC-15)', async () => {
    const { admin } = fixture
    const key = randomUUID()
    const name = `Synthetic action binding ${randomUUID()}`
    const original = await rpc(
      admin,
      'create_competition',
      { name, starts_on: null, ends_on: null },
      key,
    )
    await rejected(
      admin,
      'update_competition',
      {
        competition_id: idOf(original),
        name: 'Synthetic changed label',
        starts_on: null,
        ends_on: null,
        expected_version: 1,
        reason: 'Synthetic conflicting action',
      },
      'IDEMPOTENCY_CONFLICT',
      key,
    )
    const row = await admin.client
      .from('competitions')
      .select('name,version')
      .eq('id', idOf(original))
      .single()
    checked(row.error)
    expect(row.data).toEqual({ name, version: 1 })
    expect(
      (
        await admin.client
          .from('audit_events')
          .select('id')
          .eq('mutation_id', key)
      ).data,
    ).toHaveLength(1)
  })

  it('filters obligation status within each coach scope and rejects malformed cursors (covers: AC-3, AC-9, AC-16)', async () => {
    const { admin, coach, other, player, secondPlayer } = fixture
    const id = await finalCampaign(
      fixture,
      [coach, other],
      [player, secondPlayer],
    )
    await rpc(coach, 'submit_feedback', feedback(id, player.id))
    await rpc(admin, 'waive_final_obligation', {
      obligation_id: await obligationId(id, coach.id, secondPlayer.id),
      reason: 'Synthetic status filter',
    })
    for (const status of ['submitted', 'waived', 'outstanding']) {
      const page = await read(coach, 'list_final_obligations', {
        campaign_id: id,
        status_filter: status,
      })
      expect(page.items).toHaveLength(status === 'outstanding' ? 0 : 1)
      for (const item of page.items as unknown[])
        expect(object(item)).toMatchObject({ coachId: coach.id, status })
    }
    const page = await read(other, 'list_final_obligations', {
      campaign_id: id,
      status_filter: 'outstanding',
    })
    expect(page.items).toHaveLength(2)
    for (const cursor of [
      [],
      {},
      { frozenAt: null, id: randomUUID() },
      { frozenAt: 'bad', id: randomUUID() },
    ]) {
      const result = await admin.client.rpc('list_final_obligations', {
        campaign_id: id,
        page_cursor: cursor,
      })
      expect(result.error?.message, JSON.stringify(cursor)).toBe(
        'INVALID_INPUT',
      )
      expect(result.error?.details).toBeNull()
      expect(result.error?.hint).toBeNull()
    }
  })

  it.each(['list_final_obligations', 'admin_list_profiles'] as const)(
    'validates %s cursor values before a generic database plan (covers: AC-3, AC-16)',
    async (name) => {
      const id = await finalCampaign(fixture)
      const timestampKey =
        name === 'list_final_obligations' ? 'frozenAt' : 'createdAt'
      const cursors = [
        { [timestampKey]: '2026-01-01T00:00:00Z', id: 'bad' },
        { [timestampKey]: '9999-01-01T00:00:00Z', id: 'bad' },
        { [timestampKey]: 'bad', id: randomUUID() },
        { [timestampKey]: null, id: randomUUID() },
        { [timestampKey]: '2026-01-01T00:00:00Z', id: null },
        { [timestampKey]: 17, id: randomUUID() },
      ]
      // Use the actual database with an explicit caller role and synthetic Auth claim.
      // A generic plan can avoid a later UUID cast when the date comparison is enough.
      // Rollback restores all session settings and creates no application records.
      for (const cursor of cursors) {
        const argumentsSql =
          name === 'list_final_obligations' ? `'${id}'::uuid,null,` : 'null,'
        const evidence = object(
          localSql(`\\set QUIET on
begin;
set local role authenticated;
set local plan_cache_mode = force_generic_plan;
do $$ begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','${fixture.admin.id}','role','authenticated')::text,true);
  begin
    perform public.${name}(${argumentsSql}'${JSON.stringify(cursor)}'::jsonb,20);
    perform set_config('sfda_test.cursor_result','ACCEPTED',true);
  exception when others then
    perform set_config('sfda_test.cursor_result',sqlerrm,true);
    perform set_config('sfda_test.cursor_state',sqlstate,true);
  end;
end $$;
select jsonb_build_object('code',current_setting('sfda_test.cursor_result'),'state',current_setting('sfda_test.cursor_state',true));
rollback;`),
        )
        expect(evidence, JSON.stringify(cursor)).toEqual({
          code: 'INVALID_INPUT',
          state: 'PT422',
        })
      }
    },
  )
})
