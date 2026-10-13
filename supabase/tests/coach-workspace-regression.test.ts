import { expect, it } from 'vitest'
import {
  advance,
  checked,
  createCampaign,
  createCompetition,
  createFixture,
  feedback,
  object,
  read,
  rpc,
} from './fixture.ts'
import { localSql } from './sql.ts'

it('reads campaign and player context with only the coach own draft and frozen count', async () => {
  const fixture = await createFixture()
  const campaignId = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
    [fixture.coach, fixture.other],
  )
  await advance(fixture.admin, campaignId, 1, 'preparation')
  await rpc(
    fixture.other,
    'save_feedback_draft',
    feedback(campaignId, fixture.player.id, 'preparation'),
  )
  const context = await read(fixture.coach, 'get_coach_campaign_context', {
    campaign_id: campaignId,
  })
  expect(object(context.requirements)).toEqual({
    scope: 'self',
    frozen: false,
    frozenRequiredCount: null,
  })
  const player = await read(fixture.coach, 'get_coach_player_context', {
    campaign_id: campaignId,
    player_id: fixture.player.id,
  })
  expect(player.draft).toBeNull()
  expect(player.preparationWritable).toBe(true)
  await rpc(
    fixture.coach,
    'save_feedback_draft',
    feedback(campaignId, fixture.player.id, 'preparation'),
  )
  const own = await read(fixture.coach, 'get_coach_player_context', {
    campaign_id: campaignId,
    player_id: fixture.player.id,
  })
  expect(object(own.draft).observations).toBe('Synthetic reviewed observation.')
  await advance(fixture.admin, campaignId, 2, 'competition')
  const frozen = await read(fixture.coach, 'get_coach_campaign_context', {
    campaign_id: campaignId,
  })
  expect(object(frozen.requirements)).toEqual({
    scope: 'self',
    frozen: true,
    frozenRequiredCount: 1,
  })
})

it.each(['campaigns', 'roster', 'history'] as const)(
  'round trips %s cursors without duplicates and rejects changed query or malformed tuples',
  async (list) => {
    const fixture = await createFixture()
    const campaignId = await createCampaign(
      fixture,
      await createCompetition(fixture.admin),
      [fixture.coach],
      [fixture.player, fixture.secondPlayer],
    )
    await advance(fixture.admin, campaignId, 1, 'preparation')
    await createCampaign(fixture, await createCompetition(fixture.admin))
    for (let index = 0; index < 2; index += 1)
      await rpc(
        fixture.coach,
        'submit_feedback',
        feedback(campaignId, fixture.player.id, 'preparation'),
      )
    const name =
      list === 'campaigns'
        ? 'list_coach_campaigns'
        : list === 'roster'
          ? 'list_coach_roster'
          : 'list_coach_feedback_history'
    const inputs =
      list === 'campaigns'
        ? { mode: 'current' }
        : list === 'roster'
          ? { campaign_id: campaignId }
          : { campaign_id: campaignId, player_id: fixture.player.id }
    const first = await read(fixture.coach, name, { ...inputs, page_size: 1 })
    expect(typeof first.nextCursor).toBe('string')
    const second = await read(fixture.coach, name, {
      ...inputs,
      page_size: 1,
      cursor: first.nextCursor,
    })
    const firstItems = first.items as Record<string, unknown>[]
    const secondItems = second.items as Record<string, unknown>[]
    expect(firstItems).toHaveLength(1)
    expect(secondItems).toHaveLength(1)
    expect(secondItems[0]).not.toEqual(firstItems[0])
    expect(second.nextCursor).toBeNull()
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    const changed =
      list === 'history'
        ? { observed_from: '2026-01-01' }
        : { query: 'changed' }
    const mismatch = await fixture.coach.client.rpc(name, {
      ...inputs,
      ...changed,
      cursor: first.nextCursor,
    })
    expect(mismatch.error?.message).toBe('INVALID_CURSOR')
    const decoded = JSON.parse(
      Buffer.from(String(first.nextCursor), 'base64url').toString(),
    ) as Record<string, unknown>
    for (const tuple of [
      { ...decoded, version: 'invalid' },
      {
        ...decoded,
        [list === 'history' ? 'submittedAt' : 'createdAt']: 'not-a-timestamp',
      },
      { ...decoded, [list === 'roster' ? 'playerId' : 'id']: null },
      {
        ...decoded,
        [list === 'history' ? 'submittedAt' : 'createdAt']: 'infinity',
      },
    ]) {
      const malformed = await fixture.coach.client.rpc(name, {
        ...inputs,
        cursor: Buffer.from(JSON.stringify(tuple)).toString('base64url'),
      })
      expect(malformed.error?.message).toBe('INVALID_CURSOR')
    }
  },
)

it('treats percent underscore and backslash literally across discovery, context and neighbors', async () => {
  const fixture = await createFixture()
  const campaignId = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
    [fixture.coach],
    [fixture.player, fixture.secondPlayer],
  )
  await createCampaign(fixture, await createCompetition(fixture.admin))
  await rpc(fixture.admin, 'update_profile_name', {
    profile_id: fixture.player.id,
    display_name: 'Synthetic %_\\ marker',
    expected_version: 2,
    reason: 'Synthetic search fixture',
  })
  await rpc(fixture.admin, 'update_campaign_metadata', {
    campaign_id: campaignId,
    name: 'Synthetic %_\\ marker',
    team_name: 'Synthetic search team',
    planned_preparation_start_on: null,
    expected_version: 1,
    reason: 'Synthetic search fixture',
  })
  for (const query of ['%', '_', '\\']) {
    const campaigns = await read(fixture.coach, 'list_coach_campaigns', {
      mode: 'current',
      query,
    })
    expect(
      (campaigns.items as Record<string, unknown>[]).map(
        (row) => row.campaignId,
      ),
    ).toEqual([campaignId])
    const roster = await read(fixture.coach, 'list_coach_roster', {
      campaign_id: campaignId,
      query,
    })
    expect(
      (roster.items as Record<string, unknown>[]).map((row) => row.playerId),
    ).toEqual([fixture.player.id])
    const hidden = await read(fixture.coach, 'get_coach_player_context', {
      campaign_id: campaignId,
      player_id: fixture.secondPlayer.id,
      query,
    })
    expect(hidden.filterMatch).toBe(false)
    const neighbors = await read(fixture.coach, 'get_coach_roster_neighbors', {
      campaign_id: campaignId,
      player_id: fixture.player.id,
      query,
    })
    expect(neighbors.selectedMatch).toBe(true)
    expect(neighbors.previous).toBeNull()
    expect(neighbors.next).toBeNull()
  }
})

it('keeps all seven read RPCs invoker scoped and preserves private profile columns', async () => {
  const functions = [
    'list_coach_campaigns',
    'get_coach_campaign_context',
    'list_coach_roster',
    'get_coach_player_context',
    'get_coach_roster_neighbors',
    'list_coach_feedback_history',
    'get_coach_feedback_entry',
  ]
  const security = localSql(
    `select jsonb_agg(jsonb_build_object('name', proname, 'definer', prosecdef, 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'anonymous', has_function_privilege('anon', p.oid, 'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${functions.map((name) => `'${name}'`).join(',')});`,
  ) as {
    name: string
    definer: boolean
    authenticated: boolean
    anonymous: boolean
  }[]
  expect(security).toHaveLength(7)
  for (const row of security)
    expect(row).toMatchObject({
      definer: false,
      authenticated: true,
      anonymous: false,
    })
  const fixture = await createFixture()
  const result = await fixture.coach.client
    .from('profiles')
    .select('id,display_name,role')
  expect(result.error?.code).toBe('42501')
  checked(
    (await fixture.coach.client.from('profiles').select('id,display_name'))
      .error,
  )
})

it('keeps another assigned coach drafts and activity private under invoker reads', async () => {
  const fixture = await createFixture()
  const campaignId = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
    [fixture.coach, fixture.other],
    [fixture.player, fixture.secondPlayer],
  )
  await advance(fixture.admin, campaignId, 1, 'preparation')
  await rpc(
    fixture.other,
    'save_feedback_draft',
    feedback(campaignId, fixture.player.id, 'preparation'),
  )
  const submitted = await rpc(
    fixture.other,
    'submit_feedback',
    feedback(campaignId, fixture.secondPlayer.id, 'preparation'),
  )
  const inputs = { campaign_id: campaignId, player_id: fixture.secondPlayer.id }
  const roster = await read(fixture.coach, 'list_coach_roster', {
    campaign_id: campaignId,
  })
  for (const row of roster.items as Record<string, unknown>[]) {
    expect(row.hasSavedPreparationDraft).toBe(false)
    expect(row.preparationSubmissionCount).toBe('0')
    expect(row.latestPreparationSubmittedAt).toBeNull()
  }
  expect(
    (
      await read(fixture.coach, 'list_coach_roster', {
        campaign_id: campaignId,
        drafts: 'saved',
      })
    ).items,
  ).toEqual([])
  expect(
    (await read(fixture.coach, 'list_coach_feedback_history', inputs)).items,
  ).toEqual([])
  const hidden = await fixture.coach.client.rpc('get_coach_feedback_entry', {
    ...inputs,
    feedback_id: object(submitted.result).id,
  })
  expect(hidden.error?.message).toBe('NOT_FOUND')
  const direct = await fixture.coach.client
    .from('feedback_entries')
    .select('id')
    .eq('campaign_id', campaignId)
  checked(direct.error)
  expect(direct.data).toEqual([])
  const own = await rpc(
    fixture.coach,
    'submit_feedback',
    feedback(campaignId, fixture.player.id, 'preparation'),
  )
  const wrongPlayer = await fixture.coach.client.rpc(
    'get_coach_feedback_entry',
    { ...inputs, feedback_id: object(own.result).id },
  )
  expect(wrongPlayer.error?.message).toBe('NOT_FOUND')
  const exact = await read(fixture.coach, 'get_coach_feedback_entry', {
    campaign_id: campaignId,
    player_id: fixture.player.id,
    feedback_id: object(own.result).id,
  })
  expect(exact.observations).toBe('Synthetic reviewed observation.')
  const dated = await read(fixture.coach, 'list_coach_feedback_history', {
    campaign_id: campaignId,
    player_id: fixture.player.id,
    observed_from: '2026-01-01',
    observed_to: '2026-01-01',
  })
  expect(dated.items).toHaveLength(1)
  await rpc(fixture.admin, 'set_campaign_coach', {
    campaign_id: campaignId,
    coach_id: fixture.coach.id,
    active: false,
    expected_version: 1,
    reason: 'Synthetic historical membership',
  })
  const historical = await read(fixture.coach, 'get_coach_player_context', {
    campaign_id: campaignId,
    player_id: fixture.player.id,
  })
  expect(historical.preparationWritable).toBe(false)
  expect(
    (
      await read(fixture.coach, 'list_coach_feedback_history', {
        campaign_id: campaignId,
        player_id: fixture.player.id,
      })
    ).items,
  ).toHaveLength(1)
})

it('denies anonymous, wrong role, unrelated and disabled callers across all seven reads', async () => {
  const fixture = await createFixture()
  const campaignId = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
  )
  await advance(fixture.admin, campaignId, 1, 'preparation')
  const submitted = await rpc(
    fixture.coach,
    'submit_feedback',
    feedback(campaignId, fixture.player.id, 'preparation'),
  )
  const context = { campaign_id: campaignId, player_id: fixture.player.id }
  const calls = [
    { name: 'list_coach_campaigns', inputs: { mode: 'current' } },
    { name: 'get_coach_campaign_context', inputs: { campaign_id: campaignId } },
    { name: 'list_coach_roster', inputs: { campaign_id: campaignId } },
    { name: 'get_coach_player_context', inputs: context },
    { name: 'get_coach_roster_neighbors', inputs: context },
    { name: 'list_coach_feedback_history', inputs: context },
    {
      name: 'get_coach_feedback_entry',
      inputs: { ...context, feedback_id: object(submitted.result).id },
    },
  ]
  for (const call of calls) {
    expect(
      (await fixture.anonymous.rpc(call.name, call.inputs)).error?.code,
    ).toBe('42501')
    for (const identity of [fixture.admin, fixture.player])
      expect(
        (await identity.client.rpc(call.name, call.inputs)).error?.message,
      ).toBe('FORBIDDEN')
    const unrelated = await fixture.other.client.rpc(call.name, call.inputs)
    if (call.name === 'list_coach_campaigns') {
      checked(unrelated.error)
      expect(object(unrelated.data).items).toEqual([])
    } else expect(unrelated.error?.message).toBe('NOT_FOUND')
  }
  await rpc(fixture.admin, 'set_profile_access', {
    profile_id: fixture.coach.id,
    enabled: false,
    expected_version: 2,
    reason: 'Synthetic disabled coach',
  })
  for (const call of calls)
    expect(
      (await fixture.coach.client.rpc(call.name, call.inputs)).error?.message,
    ).toBe('FORBIDDEN')
})
