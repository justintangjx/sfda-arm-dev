import { expect, it } from 'vitest'
import {
  advance,
  checked,
  createCampaign,
  createCompetition,
  createFixture,
  feedback,
  rpc,
} from './fixture.ts'

it('lists current campaigns and roster activity for the authoring coach only', async () => {
  const fixture = await createFixture()
  const campaignId = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
  )
  await advance(fixture.admin, campaignId, 1, 'preparation')
  const draft = await rpc(
    fixture.coach,
    'save_feedback_draft',
    feedback(campaignId, fixture.player.id, 'preparation'),
  )
  expect(draft.outcome).toBe('committed')
  const campaigns = await fixture.coach.client.rpc('list_coach_campaigns', {
    mode: 'current',
  })
  checked(campaigns.error)
  expect((campaigns.data as { items: unknown[] }).items.length).toBe(1)
  const roster = await fixture.coach.client.rpc('list_coach_roster', {
    campaign_id: campaignId,
    drafts: 'saved',
  })
  checked(roster.error)
  const rosterItems = (roster.data as { items: Record<string, unknown>[] })
    .items
  expect(rosterItems.length).toBe(1)
  expect(rosterItems[0]?.hasSavedPreparationDraft).toBe(true)
  const otherRoster = await fixture.other.client.rpc('list_coach_roster', {
    campaign_id: campaignId,
    drafts: 'saved',
  })
  expect(otherRoster.error?.message).toBe('NOT_FOUND')
})

it('returns roster neighbors for the selected player in filtered order', async () => {
  const fixture = await createFixture()
  const campaignId = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
    [fixture.coach],
    [fixture.player, fixture.secondPlayer],
  )
  await advance(fixture.admin, campaignId, 1, 'preparation')
  const roster = await fixture.coach.client.rpc('list_coach_roster', {
    campaign_id: campaignId,
  })
  checked(roster.error)
  const items = (roster.data as { items: Record<string, unknown>[] }).items
  expect(items.length).toBeGreaterThanOrEqual(2)
  const neighbors = await fixture.coach.client.rpc(
    'get_coach_roster_neighbors',
    {
      campaign_id: campaignId,
      player_id: items[0]?.playerId,
    },
  )
  checked(neighbors.error)
  const neighborRow = neighbors.data as {
    next: { playerId: string } | null
    selectedMatch: boolean
  }
  expect(neighborRow.selectedMatch).toBe(true)
  expect(neighborRow.next?.playerId).toBe(items[1]?.playerId)
})

it('lists authored history for the selected campaign and player only', async () => {
  const fixture = await createFixture()
  const campaignId = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
  )
  await advance(fixture.admin, campaignId, 1, 'preparation')
  await rpc(
    fixture.coach,
    'submit_feedback',
    feedback(campaignId, fixture.player.id, 'preparation'),
  )
  const history = await fixture.coach.client.rpc(
    'list_coach_feedback_history',
    {
      campaign_id: campaignId,
      player_id: fixture.player.id,
    },
  )
  checked(history.error)
  const items = (history.data as { items: Record<string, unknown>[] }).items
  expect(items.length).toBe(1)
  expect(items[0]?.kind).toBe('preparation')
})
