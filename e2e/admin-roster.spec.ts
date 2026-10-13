import { expect, test, type Page } from '@playwright/test'

const campaignId = '10000000-0000-4000-8000-000000000001'
const adminId = '20000000-0000-4000-8000-000000000001'
const account = (index: number, role: 'coach' | 'player' = 'coach') => ({
  id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  displayName: `Synthetic ${role} ${index}`,
  role,
  enabled: true,
  version: 1,
  createdAt: '2026-10-13T00:00:00Z',
  setupStatus: 'ready',
  passwordInitialized: false,
})

// Every Auth and data response is synthetic and intercepted inside this test.
const enterRoster = async (page: Page, stage: string) => {
  const first = Array.from({ length: 100 }, (_, index) => account(index + 1))
  const later = [account(101), account(102, 'player')]
  const removed = [account(103), account(104, 'player')]
  const cursor = { createdAt: first[99]!.createdAt, id: first[99]!.id }
  const campaign = {
    id: campaignId,
    name: 'Synthetic roster campaign',
    team_name: 'Synthetic team',
    stage,
    version: 1,
    created_at: '2026-10-13T00:00:00Z',
    competitions: { name: 'Synthetic competition' },
  }
  const requests: unknown[] = []
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appEnv: 'local',
        appOrigin: 'http://127.0.0.1:5173',
        releaseId: 'synthetic-roster-test',
        supabaseUrl: 'http://127.0.0.1:5173/synthetic-supabase',
        supabasePublicKey: 'synthetic-placeholder',
        voiceEnabled: false,
      },
    }),
  )
  await page.route('**/synthetic-supabase/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const access = {
      id: adminId,
      displayName: 'Synthetic admin',
      role: 'admin',
      enabled: true,
      version: 1,
    }
    if (path.endsWith('/auth/v1/token')) {
      await route.fulfill({
        json: {
          access_token: 'synthetic-access-token',
          refresh_token: 'synthetic-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user: { id: adminId, aud: 'authenticated', role: 'authenticated' },
        },
      })
    } else if (path.endsWith('/rpc/get_my_access'))
      await route.fulfill({ json: access })
    else if (path.endsWith('/rpc/admin_list_accounts')) {
      const body: unknown = route.request().postDataJSON()
      requests.push(body)
      const after =
        typeof body === 'object' && body !== null && 'page_cursor' in body
          ? body.page_cursor
          : null
      await route.fulfill({
        json: after
          ? { items: later, nextCursor: null }
          : { items: first, nextCursor: cursor },
      })
    } else if (path.endsWith('/campaigns'))
      await route.fulfill({
        json: url.searchParams.has('id') ? campaign : [campaign],
      })
    else if (path.endsWith('/campaign_coaches'))
      await route.fulfill({
        json: [
          {
            coach_id: removed[0]!.id,
            is_active: false,
            version: 2,
            created_at: removed[0]!.createdAt,
          },
        ],
      })
    else if (path.endsWith('/campaign_players'))
      await route.fulfill({
        json: [
          {
            player_id: removed[1]!.id,
            is_active: false,
            version: 2,
            created_at: removed[1]!.createdAt,
          },
        ],
      })
    else if (path.endsWith('/profiles'))
      await route.fulfill({
        json: removed.map((item) => ({
          id: item.id,
          display_name: item.displayName,
        })),
      })
    else await route.abort()
  })
  await page.goto('/login')
  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('Synthetic password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Accounts', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('link', { name: 'Campaigns', exact: true })
    .click()
  await page.getByRole('link', { name: campaign.name, exact: true }).click()
  await expect(
    page.getByRole('heading', { name: campaign.name, exact: true }),
  ).toBeVisible()
  return { requests, cursor, later }
}

test('synthetic roster includes both roles beyond the first directory page (spec 0006, AC-4)', async ({
  page,
}) => {
  const { requests, cursor, later } = await enterRoster(page, 'preparation')
  await page.getByLabel('Coach', { exact: true }).selectOption(later[0]!.id)
  await page.getByLabel('Player', { exact: true }).selectOption(later[1]!.id)
  await expect(page.getByLabel('Coach', { exact: true })).toHaveValue(
    later[0]!.id,
  )
  await expect(page.getByLabel('Player', { exact: true })).toHaveValue(
    later[1]!.id,
  )
  expect(requests).toContainEqual({
    name_query: null,
    role_filter: null,
    enabled_filter: true,
    page_cursor: cursor,
    page_size: 100,
  })
})

test('synthetic frozen roster offers coach restoration and no new admission (spec 0006, AC-4)', async ({
  page,
}) => {
  await enterRoster(page, 'competition')
  await expect(
    page.getByRole('button', { name: 'Assign coach', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Add player', exact: true }),
  ).toHaveCount(0)
  await expect(
    page
      .getByRole('region', { name: 'Player roster', exact: true })
      .getByRole('button', { name: 'Restore', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('region', { name: 'Coach assignments', exact: true })
    .getByRole('button', { name: 'Restore', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Restore Synthetic coach 103?' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
})
