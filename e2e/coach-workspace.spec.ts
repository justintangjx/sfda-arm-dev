import { expect, test, type Page } from '@playwright/test'

const campaignId = '10000000-0000-4000-8000-000000000001'
const coachId = '00000000-0000-4000-8000-000000000001'
const playerId = 'a0000001-0000-4000-8000-000000000001'
const nextPlayerId = 'a0000002-0000-4000-8000-000000000002'
const campaignPath = `/coach/campaigns/${campaignId}`
const playerPath = `${campaignPath}/players/${playerId}`

// Auth and data replies are synthetic. These checks prove browser behavior only.
const enterWorkspace = async (page: Page) => {
  const access = {
    id: coachId,
    displayName: 'Synthetic coach',
    role: 'coach',
    enabled: true,
    version: 1,
  }
  const campaign = {
    campaignId,
    name: 'Synthetic workspace campaign',
    teamName: 'Synthetic team',
    competitionName: 'Synthetic competition',
    stage: 'preparation',
    version: 1,
    membershipVersion: 1,
    membershipActive: true,
    accessLabel: 'Current assignment',
    requirements: { scope: 'self', frozen: false, frozenRequiredCount: null },
    writeKinds: ['preparation'],
    correctionSupport: 'unavailable',
  }
  const players = [
    { playerId, displayName: 'Synthetic player one' },
    { playerId: nextPlayerId, displayName: 'Synthetic player two' },
  ].map((player) => ({
    ...player,
    membershipActive: true,
    membershipVersion: 1,
    hasSavedPreparationDraft: false,
    preparationSubmissionCount: '0',
    latestPreparationSubmittedAt: null,
  }))
  const controls = {
    accessReads: 0,
    campaignReads: 0,
    holdTarget: false,
    releaseTarget: undefined as (() => void) | undefined,
  }
  const envelope = (items: readonly unknown[]) => ({
    items,
    nextCursor: null,
    queryFingerprint: 'synthetic-query',
    readAt: '2026-10-13T00:00:00Z',
  })
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appEnv: 'local',
        appOrigin: 'http://127.0.0.1:5173',
        releaseId: 'synthetic-workspace-test',
        supabaseUrl: 'http://127.0.0.1:5173/synthetic-supabase',
        supabasePublicKey: 'synthetic-placeholder',
        voiceEnabled: false,
      },
    }),
  )
  await page.route('**/synthetic-supabase/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/v1/token'))
      await route.fulfill({
        json: {
          access_token: 'synthetic-access-token',
          refresh_token: 'synthetic-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user: { id: coachId, aud: 'authenticated', role: 'authenticated' },
        },
      })
    else if (path.endsWith('/rpc/get_my_access')) {
      controls.accessReads++
      await route.fulfill({ json: access })
    } else if (path.endsWith('/rpc/list_coach_campaigns'))
      await route.fulfill({ json: envelope([campaign]) })
    else if (path.endsWith('/rpc/get_coach_campaign_context')) {
      controls.campaignReads++
      await route.fulfill({ json: campaign })
    } else if (path.endsWith('/rpc/list_coach_roster')) {
      const body = route.request().postDataJSON() as { query: string | null }
      await route.fulfill({
        json: envelope(
          players.filter((player) =>
            player.displayName.includes(body.query ?? ''),
          ),
        ),
      })
    } else if (path.endsWith('/rpc/get_coach_player_context')) {
      const body = route.request().postDataJSON() as {
        player_id: string
        query: string | null
      }
      if (body.player_id === nextPlayerId && controls.holdTarget)
        await new Promise<void>((resolve) => {
          controls.releaseTarget = resolve
        })
      const player = players.find((item) => item.playerId === body.player_id)!
      await route.fulfill({
        json: {
          ...player,
          campaignContext: campaign,
          filterMatch: player.displayName.includes(body.query ?? ''),
          preparationWritable: true,
          draft: null,
        },
      })
    } else if (path.endsWith('/rpc/get_coach_roster_neighbors'))
      await route.fulfill({
        json: {
          queryFingerprint: 'synthetic-query',
          selectedMatch: true,
          previous: null,
          next: { ...players[1] },
        },
      })
    else if (path.endsWith('/rpc/list_coach_feedback_history'))
      await route.fulfill({ json: envelope([]) })
    else await route.abort()
  })
  await page.goto('/login')
  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('Synthetic password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('link', { name: campaign.name, exact: true }).click()
  await page.getByRole('link', { name: 'Synthetic player one Ref' }).click()
  await expect(
    page.getByLabel('Observations (required to submit)', { exact: true }),
  ).toBeVisible()
  return controls
}

test('one focus event refreshes account access and campaign context once', async ({
  page,
}) => {
  const controls = await enterWorkspace(page)
  const accessBefore = controls.accessReads
  const campaignBefore = controls.campaignReads
  await page.evaluate("window.dispatchEvent(new Event('focus'))")
  // Observe a bounded interval to catch a self sustaining refresh loop.
  await page.waitForTimeout(450)
  expect(controls.accessReads - accessBefore).toBeLessThan(12)
  expect(controls.campaignReads - campaignBefore).toBe(1)
})

for (const branch of ['next', 'roster'] as const)
  test(`filter changes cancel a delayed ${branch} target check`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const controls = await enterWorkspace(page)
    controls.holdTarget = true
    if (branch === 'next')
      await page.getByRole('button', { name: 'Next player' }).click()
    else
      await page.getByRole('link', { name: 'Synthetic player two Ref' }).click()
    await expect.poll(() => Boolean(controls.releaseTarget)).toBe(true)
    const roster = page.getByRole('navigation', { name: 'Player roster' })
    await roster.getByLabel('Search players').fill('one')
    await roster.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(
      roster.getByRole('link', { name: 'Synthetic player two Ref' }),
    ).toHaveCount(0)
    controls.holdTarget = false
    controls.releaseTarget!()
    await expect(page.getByText(/Roster filters changed/)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${playerPath}$`))
  })

test('Stay during a delayed Discard check preserves local edits', async ({
  page,
}) => {
  const controls = await enterWorkspace(page)
  const observations = page.getByLabel('Observations (required to submit)', {
    exact: true,
  })
  await observations.fill('Synthetic local work')
  await page.getByRole('button', { name: 'Next player' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  controls.holdTarget = true
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect.poll(() => Boolean(controls.releaseTarget)).toBe(true)
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
  controls.holdTarget = false
  controls.releaseTarget!()
  await page.waitForTimeout(150)
  await expect(observations).toHaveValue('Synthetic local work')
  await expect(page).toHaveURL(new RegExp(`${playerPath}$`))
})
