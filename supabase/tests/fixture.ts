import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect } from 'vitest'

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
export type Identity = Readonly<{ id: string; client: SupabaseClient }>
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a database object.')
  return value as Record<string, unknown>
}
export const checked = (error: { code?: string } | null) => {
  if (error)
    throw new Error(`Database request failed (${error.code ?? 'UNKNOWN'}).`)
}
export const rpc = async (
  identity: Identity,
  name: string,
  inputs: Record<string, unknown>,
  mutationId = randomUUID(),
) => {
  const { data, error } = await identity.client.rpc(name, {
    ...inputs,
    mutation_id: mutationId,
  })
  checked(error)
  return object(data)
}
export const ref = (result: Record<string, unknown>) => object(result.result)
export const idOf = (result: Record<string, unknown>) => {
  const id = ref(result).id
  if (typeof id !== 'string')
    throw new Error('Expected a database record identity.')
  return id
}
export const rejected = async (
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
export const read = async (
  identity: Identity,
  name: string,
  inputs: Record<string, unknown>,
) => {
  const { data, error } = await identity.client.rpc(name, inputs)
  checked(error)
  return object(data)
}
export const content = {
  observations: 'Synthetic reviewed observation.',
  strengths: null,
  development_focus: null,
  observed_on: '2026-01-01',
}
export const feedback = (
  campaignId: string,
  playerId: string,
  kind: 'preparation' | 'final' = 'final',
  overrides: Record<string, unknown> = {},
) => ({
  campaign_id: campaignId,
  player_id: playerId,
  kind,
  content,
  review_confirmed: true,
  draft_id: null,
  expected_version: null,
  ...overrides,
})
export const createFixture = async () => {
  const url = process.env.SFDA_TEST_SUPABASE_URL
  const publicKey = process.env.SFDA_TEST_SUPABASE_PUBLIC_KEY
  const adminKey = process.env.SFDA_TEST_SUPABASE_ADMIN_KEY
  if (
    !url ||
    !publicKey ||
    !adminKey ||
    !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(url)
  )
    throw new Error('A verified local Supabase fixture target is required.')
  const operator = createClient(url, adminKey, options)
  const anonymous = createClient(url, publicKey, options)
  const account = async (): Promise<Identity> => {
    const email = `synthetic-${randomUUID()}@example.invalid`
    const password = `Synthetic!${randomUUID()}`
    const { data, error } = await operator.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    checked(error)
    if (!data.user) throw new Error('Synthetic Auth identity unavailable.')
    const client = createClient(url, publicKey, options)
    checked((await client.auth.signInWithPassword({ email, password })).error)
    return { id: data.user.id, client }
  }
  const admin = await account()
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
  const secondAdmin = await account()
  checked(
    (
      await operator.from('profiles').insert({
        id: secondAdmin.id,
        display_name: 'Synthetic second admin',
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
        target_id: secondAdmin.id,
        metadata: {},
      })
    ).error,
  )
  const provision = async (role: 'coach' | 'player') => {
    const identity = await account()
    await rpc(admin, 'create_profile', {
      profile_id: identity.id,
      display_name: 'Synthetic person',
      role,
    })
    await rpc(admin, 'set_profile_access', {
      profile_id: identity.id,
      enabled: true,
      expected_version: 1,
      reason: 'Synthetic test activation',
    })
    return identity
  }
  return {
    admin,
    secondAdmin,
    coach: await provision('coach'),
    other: await provision('coach'),
    player: await provision('player'),
    secondPlayer: await provision('player'),
    operator,
    anonymous,
    url,
    publicKey,
  }
}
export type Fixture = Awaited<ReturnType<typeof createFixture>>
export const createCompetition = async (admin: Identity) =>
  idOf(
    await rpc(admin, 'create_competition', {
      name: `Synthetic event ${randomUUID()}`,
      starts_on: null,
      ends_on: null,
    }),
  )
export const createCampaign = async (
  fixture: Fixture,
  competitionId: string,
  coaches: readonly Identity[] = [fixture.coach],
  players: readonly Identity[] = [fixture.player],
) => {
  const id = idOf(
    await rpc(fixture.admin, 'create_campaign', {
      competition_id: competitionId,
      name: 'Synthetic campaign',
      team_name: randomUUID(),
      planned_preparation_start_on: null,
    }),
  )
  for (const coach of coaches)
    await rpc(fixture.admin, 'set_campaign_coach', {
      campaign_id: id,
      coach_id: coach.id,
      active: true,
      expected_version: null,
      reason: 'Synthetic assignment',
    })
  for (const player of players)
    await rpc(fixture.admin, 'set_campaign_player', {
      campaign_id: id,
      player_id: player.id,
      active: true,
      expected_version: null,
      reason: 'Synthetic roster',
    })
  return id
}
export const advance = (
  admin: Identity,
  campaignId: string,
  version: number,
  stage: string,
  mutationId = randomUUID(),
) =>
  rpc(
    admin,
    'advance_campaign_stage',
    {
      campaign_id: campaignId,
      expected_version: version,
      next_stage: stage,
      reason: 'Synthetic stage transition',
    },
    mutationId,
  )
export const finalCampaign = async (
  fixture: Fixture,
  coaches?: readonly Identity[],
  players?: readonly Identity[],
) => {
  const id = await createCampaign(
    fixture,
    await createCompetition(fixture.admin),
    coaches,
    players,
  )
  await advance(fixture.admin, id, 1, 'preparation')
  await advance(fixture.admin, id, 2, 'competition')
  await advance(fixture.admin, id, 3, 'final_feedback')
  return id
}
