import { expect, test } from '@playwright/test'

const campaignId = '10000000-0000-4000-8000-000000000001'
const playerId = 'a0000001-0000-4000-8000-000000000001'
const campaignPath = `/coach/campaigns/${campaignId}`
const playerPath = `${campaignPath}/players/${playerId}`
const enterPlayer = async (
  page: import('@playwright/test').Page,
  path = playerPath,
) => {
  await page.goto(path)
  await expect(
    page.getByLabel('Observations (required to submit)', { exact: true }),
  ).toBeVisible()
}

test('synthetic screen thread has responsive context, paging, unique references and no live calls', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/coach')
  await expect(
    page.getByRole('heading', { name: 'Your campaigns' }),
  ).toBeVisible()
  await expect(page.getByText('Preview: sample data')).toBeVisible()
  await page
    .getByRole('link', { name: 'Sample preparation campaign', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Choose a player' }),
  ).toBeVisible()
  const first = page.getByRole('link', { name: 'Sample Player One Ref' })
  await expect(first).toContainText(playerId)
  await page.getByRole('button', { name: 'Load more players' }).click()
  await expect(
    page.getByRole('link', { name: 'Sample Player 23 Ref' }),
  ).toBeVisible()
  await first.click()
  await expect(
    page.getByRole('heading', { name: 'Sample Player One', exact: true }),
  ).toBeFocused()
  await expect(
    page.getByRole('button', { name: 'Speak feedback' }),
  ).toHaveCount(0)
  if (testInfo.project.name.endsWith('mobile')) {
    await expect(
      page.getByRole('navigation', { name: 'Player roster' }),
    ).toBeHidden()
    await expect(
      page.getByRole('link', { name: 'Back to roster' }),
    ).toBeVisible()
  } else
    await expect(
      page.getByRole('navigation', { name: 'Player roster' }),
    ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('sfda-coach.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate<boolean>(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true)
  expect(
    requests.every((url) => url.startsWith('http://127.0.0.1:5173/')),
  ).toBe(true)
  expect(errors).toEqual([])
})
test('tabs use manual activation and preserve unsaved form text', async ({
  page,
}) => {
  await enterPlayer(page)
  await page
    .getByLabel('Observations (required to submit)', { exact: true })
    .fill('Sample retained observation')
  const write = page.getByRole('tab', { name: 'Write feedback' })
  const history = page.getByRole('tab', { name: 'History', exact: true })
  await write.focus()
  await page.keyboard.press('ArrowRight')
  await expect(history).toBeFocused()
  await expect(write).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(history).toHaveAttribute('aria-selected', 'true')
  const disclosure = page.getByRole('button', { name: 'Show full feedback' })
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await disclosure.click()
  await expect(
    page.getByText('Original submitted feedback', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Latest correction' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Hide full feedback' }),
  ).toHaveAttribute('aria-expanded', 'true')
  await write.click()
  await expect(
    page.getByLabel('Observations (required to submit)', { exact: true }),
  ).toHaveValue('Sample retained observation')
})
test('incomplete draft saves explicitly and automatically resumes on return', async ({
  page,
}) => {
  await enterPlayer(page)
  await expect(
    page.getByLabel('Observation date (required to submit)'),
  ).toHaveValue('')
  await page
    .getByLabel('Strengths (optional)', { exact: true })
    .fill('Sample incomplete draft')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(
    page.getByLabel('Strengths (optional)', { exact: true }),
  ).toHaveAttribute('readonly', '')
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to campaigns' }).click()
  await page
    .getByRole('link', { name: 'Sample preparation campaign', exact: true })
    .click()
  await page.getByRole('link', { name: 'Sample Player One Ref' }).click()
  await expect(
    page.getByLabel('Strengths (optional)', { exact: true }),
  ).toHaveValue('Sample incomplete draft')
  await expect(
    page
      .getByRole('tabpanel', { name: 'Write feedback' })
      .getByText('Saved draft', { exact: true }),
  ).toBeVisible()
})
test('navigation guard stays safely, saves before switching and local discard preserves saved draft', async ({
  page,
}) => {
  await enterPlayer(page)
  const observations = page.getByLabel('Observations (required to submit)', {
    exact: true,
  })
  await observations.fill('Sample saved baseline')
  await page.getByRole('link', { name: 'Back to campaigns' }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('button', { name: 'Stay', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(observations).toHaveValue('Sample saved baseline')
  await page.getByRole('link', { name: 'Back to campaigns' }).click()
  await dialog.getByRole('button', { name: 'Save draft and switch' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your campaigns' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Sample preparation campaign', exact: true })
    .click()
  await page.getByRole('link', { name: 'Sample Player One Ref' }).click()
  await observations.fill('Sample unsaved replacement')
  await page.getByRole('link', { name: 'Back to campaigns' }).click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await page
    .getByRole('link', { name: 'Sample preparation campaign', exact: true })
    .click()
  await page.getByRole('link', { name: 'Sample Player One Ref' }).click()
  await expect(observations).toHaveValue('Sample saved baseline')
})
test('preparation validation announces errors and success resets only after confirmed submission', async ({
  page,
}) => {
  await enterPlayer(page)
  await page
    .getByRole('button', { name: 'Submit feedback', exact: true })
    .click()
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(
    page.getByLabel('Observation date (required to submit)'),
  ).toHaveAttribute('aria-invalid', 'true')
  await page
    .getByLabel('Observation date (required to submit)')
    .fill('2026-10-01')
  await page
    .getByLabel('Observations (required to submit)', { exact: true })
    .fill('Sample new submission')
  await page
    .getByRole('button', { name: 'Submit feedback', exact: true })
    .click()
  await expect(
    page.getByText('Feedback submitted.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByLabel('Observations (required to submit)', { exact: true }),
  ).toHaveValue('')
  await expect(
    page.getByLabel('Observation date (required to submit)'),
  ).toHaveValue('')
  await page.getByRole('button', { name: 'View submitted feedback' }).click()
  await expect(
    page.getByText('Sample new submission', { exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${playerId}\\?tab=history$`))
})
test('final review focuses Cancel, traps focus and produces a fixed final assessment', async ({
  page,
}) => {
  await enterPlayer(
    page,
    `/coach/campaigns/10000000-0000-4000-8000-000000000002/players/${playerId}`,
  )
  await page
    .getByLabel('Observation date (required to submit)')
    .fill('2026-10-01')
  await page
    .getByLabel('Observations (required to submit)', { exact: true })
    .fill('Sample final assessment')
  await page
    .getByRole('button', { name: 'Review final assessment', exact: true })
    .press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Review final assessment' })
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(
    dialog.getByRole('button', { name: 'Submit final assessment' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Review final assessment', exact: true }),
  ).toBeFocused()
  await page
    .getByRole('button', { name: 'Review final assessment', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Submit final assessment' }).click()
  await expect(
    page.getByText('Your final assessment is submitted and fixed.'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Review final assessment', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText('Sample final assessment', { exact: true }).first(),
  ).toBeVisible()
})
test('paused campaign and unavailable routes expose no write actions', async ({
  page,
}) => {
  await enterPlayer(
    page,
    `/coach/campaigns/10000000-0000-4000-8000-000000000003/players/${playerId}`,
  )
  await expect(
    page.getByText('Feedback paused during competition.'),
  ).toBeVisible()
  await expect(
    page.getByLabel('Observations (required to submit)', { exact: true }),
  ).toHaveAttribute('readonly', '')
  await expect(
    page.getByRole('button', { name: 'Save draft', exact: true }),
  ).toHaveCount(0)
  await page.goto('/coach/campaigns/invalid/players/invalid')
  await expect(
    page.getByRole('heading', { name: 'This workspace is unavailable' }),
  ).toBeVisible()
})
test('offline preserves local editing and signing out clears work data', async ({
  page,
  context,
}) => {
  await enterPlayer(page)
  await context.setOffline(true)
  await page
    .getByLabel('Observations (required to submit)', { exact: true })
    .fill('Sample offline observation')
  await expect(
    page.getByRole('button', { name: 'Save draft', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Submit feedback', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page
    .getByRole('button', { name: 'Discard local edits and sign out' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Sample offline observation', { exact: true }),
  ).toHaveCount(0)
  await context.setOffline(false)
})
test('reflows at 320 pixels with 200 percent text and keeps controls usable', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await enterPlayer(page)
  await page.evaluate("document.documentElement.style.fontSize = '200%'")
  await page.screenshot({
    path: testInfo.outputPath('sfda-coach-reflow.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate<boolean>(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true)
  for (const button of await page.getByRole('button').all()) {
    if (await button.isVisible())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
})

test('live configuration cannot fall back to fixture data or enable unconnected voice', async ({
  page,
}) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appEnv: 'local',
        appOrigin: 'http://127.0.0.1:5173',
        releaseId: 'synthetic-config',
        supabaseUrl: 'https://example.invalid',
        supabasePublicKey: 'synthetic-public-key',
        voiceEnabled: true,
      },
    }),
  )
  await page.goto('/coach')
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeEnabled()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await expect(page.getByText('Preview: sample data')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Open sample workspace' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Speak feedback' }),
  ).toHaveCount(0)
})

test('invalid preview capabilities fail closed with a recovery action', async ({
  page,
}) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appEnv: 'preview',
        appOrigin: 'http://127.0.0.1:5173',
        releaseId: 'synthetic-config',
        supabaseUrl: null,
        supabasePublicKey: null,
        voiceEnabled: true,
      },
    }),
  )
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Workspace unavailable', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Your campaigns' }),
  ).toHaveCount(0)
})
