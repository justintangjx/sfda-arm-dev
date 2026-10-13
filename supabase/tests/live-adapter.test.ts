import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, it } from 'vitest'
import type { ApplicationDatabase } from '../../src/domain/database.ts'
import { createLiveCoachAdapter } from '../../src/app/data/coach.ts'
import {
  createFixture,
  createCompetition,
  createCampaign,
  advance,
  rpc,
  feedback,
} from './fixture.ts'

it('reads a committed preparation entry through the actual caller adapter', async () => {
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
  const adapter = createLiveCoachAdapter(
    fixture.coach.client as SupabaseClient<ApplicationDatabase>,
  )
  const result = await adapter.loadHistory(
    { id: fixture.coach.id, displayName: 'Synthetic coach', accessVersion: 2 },
    campaignId,
    fixture.player.id,
    undefined,
    new AbortController().signal,
  )
  expect(result.ok, result.ok ? undefined : result.code).toBe(true)
  if (result.ok) expect(result.value.rows.length).toBe(1)
})
