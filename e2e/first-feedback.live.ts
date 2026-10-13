import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { record } from '../src/domain/accounts.ts'

const fillSecret = async (locator: Locator, value: string) => {
  try {
    await locator.fill(value)
  } catch {
    throw new Error('A sensitive form field could not be filled.')
  }
}
const login = async (page: Page, email: string, password: string) => {
  await page.goto('/login')
  await fillSecret(page.getByLabel('Email', { exact: true }), email)
  await fillSecret(page.getByLabel('Password', { exact: true }), password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
const captureLink = async (email: string) => {
  const url = process.env.SFDA_TEST_SUPABASE_MAIL_URL
  if (!url) throw new Error('Local mail capture prerequisite is missing.')
  try {
    const search = record(
      await (
        await fetch(
          `${url}/api/v1/search?${new URLSearchParams({ query: `to:${email}` })}`,
        )
      ).json(),
    )
    const messages = search?.messages
    if (!Array.isArray(messages) || !messages.length)
      throw new Error('Capture missing.')
    const id = record(messages[0])?.ID
    if (typeof id !== 'string') throw new Error('Capture identity missing.')
    const message = record(
      await (await fetch(`${url}/api/v1/message/${id}`)).json(),
    )
    if (typeof message?.HTML !== 'string')
      throw new Error('Capture HTML missing.')
    const href = /href="([^"]+)"/.exec(message.HTML)?.[1]
    if (!href) throw new Error('Capture proof missing.')
    return { link: href.replaceAll('&amp;', '&'), id, url }
  } catch {
    throw new Error(
      'The local setup email could not be read. No email or proof was retained.',
    )
  }
}
test('real admin setup, coach password, reviewed preparation submission and separate session readback (spec 0005)', async ({
  page,
  browser,
}) => {
  const adminEmail = process.env.SFDA_LIVE_ADMIN_EMAIL
  const adminPassword = process.env.SFDA_LIVE_ADMIN_PASSWORD
  const apiUrl = process.env.SFDA_TEST_SUPABASE_URL
  const publicKey = process.env.SFDA_TEST_SUPABASE_PUBLIC_KEY
  if (!adminEmail || !adminPassword || !apiUrl || !publicKey)
    throw new Error('The clean local live prerequisites are missing.')
  const coachEmail = `synthetic-${randomUUID()}@example.invalid`
  const playerEmail = `synthetic-${randomUUID()}@example.invalid`
  const coachPassword = ` ${randomUUID()} `
  const suffix = randomUUID().slice(0, 8)
  const coachName = `Synthetic coach ${suffix}`
  const playerName = `Synthetic player ${suffix}`
  await login(page, adminEmail, adminPassword)
  await expect(
    page.getByRole('heading', { name: 'Accounts', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Admin sections' })
    .getByRole('link', { name: 'Setup workspace' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Prepare the first feedback path.' }),
  ).toBeVisible()
  const accounts = page.getByRole('group', {
    name: 'Create an account',
    exact: true,
  })
  for (const item of [
    { email: coachEmail, name: coachName, role: 'coach' },
    { email: playerEmail, name: playerName, role: 'player' },
  ]) {
    await accounts.getByLabel('Display name').fill(item.name)
    await fillSecret(accounts.getByLabel('Account email'), item.email)
    await accounts.getByLabel('Role', { exact: true }).selectOption(item.role)
    await accounts
      .getByRole('button', { name: 'Create account and request link' })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Access enabled' }),
    ).toBeVisible()
  }
  const email = await captureLink(coachEmail)
  const setup = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const setupPage = await setup.newPage()
  try {
    try {
      await setupPage.goto(email.link)
    } catch {
      throw new Error(
        'Password setup navigation failed. No proof URL was retained.',
      )
    }
    await expect(
      setupPage.getByRole('heading', { name: 'Choose your password.' }),
    ).toBeVisible()
    expect(
      new URL(setupPage.url()).search.length,
      'Setup must remove its proof query before routing',
    ).toBe(0)
    await fillSecret(
      setupPage.getByLabel('Password', { exact: true }),
      coachPassword,
    )
    await fillSecret(setupPage.getByLabel('Confirm password'), coachPassword)
    await setupPage
      .getByRole('button', { name: 'Set password', exact: true })
      .click()
    await expect(
      setupPage
        .getByRole('status')
        .filter({ hasText: 'Your password is set.' }),
    ).toBeVisible()
    expect(
      await setupPage.evaluate(() =>
        Object.keys(localStorage).some((key) => key.startsWith('sb-')),
      ),
      'Setup must not persist a session',
    ).toBe(false)
  } finally {
    await setup.close()
    await fetch(`${email.url}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: [email.id] }),
    })
  }
  const competition = page.getByRole('group', {
    name: 'Create a competition',
    exact: true,
  })
  await competition
    .getByLabel('Competition name')
    .fill(`Synthetic competition ${suffix}`)
  await competition
    .getByRole('button', { name: 'Create competition', exact: true })
    .click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved competition' }),
  ).toBeVisible()
  const campaign = page.getByRole('group', {
    name: 'Create a campaign',
    exact: true,
  })
  await campaign
    .getByLabel('Campaign name')
    .fill(`Synthetic campaign ${suffix}`)
  await campaign.getByLabel('Team name').fill(`Synthetic team ${suffix}`)
  await campaign
    .getByRole('button', { name: 'Create campaign', exact: true })
    .click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved campaign.' }),
  ).toBeVisible()
  const coachOption = await page
    .getByLabel('Coach', { exact: true })
    .locator('option')
    .filter({ hasText: coachName })
    .getAttribute('value')
  const playerOption = await page
    .getByLabel('Player', { exact: true })
    .locator('option')
    .filter({ hasText: playerName })
    .getAttribute('value')
  if (!coachOption || !playerOption)
    throw new Error('Enabled assignment choices were not available.')
  await page.getByLabel('Coach', { exact: true }).selectOption(coachOption)
  await page.getByRole('button', { name: 'Assign coach', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved coach assignment' }),
  ).toBeVisible()
  await page.getByLabel('Player', { exact: true }).selectOption(playerOption)
  await page.getByRole('button', { name: 'Add player', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved player assignment' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Open preparation', exact: true })
    .scrollIntoViewIfNeeded()
  await page
    .getByRole('button', { name: 'Open preparation', exact: true })
    .click({ timeout: 10000 })
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved campaign.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await login(page, coachEmail, coachPassword)
  await expect(
    page.getByRole('heading', { name: 'Your campaigns' }),
  ).toBeVisible()
  await page
    .getByRole('link')
    .filter({ hasText: `Synthetic campaign ${suffix}` })
    .first()
    .click()
  await page.getByRole('link').filter({ hasText: playerName }).first().click()
  await page
    .getByLabel('Observations (required to submit)', { exact: true })
    .fill('Synthetic reviewed preparation observation.')
  await page
    .getByLabel('Observation date (required to submit)', { exact: true })
    .fill('2026-01-01')
  await page
    .getByRole('button', { name: 'Submit feedback', exact: true })
    .click()
  await expect(
    page.getByText('Feedback submitted.', { exact: true }),
  ).toBeVisible()
  const playerPath = new URL(page.url()).pathname
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Sign in', exact: true }),
  ).toBeVisible()
  await login(page, coachEmail, coachPassword)
  await expect(
    page.getByRole('heading', { name: 'Your campaigns' }),
  ).toBeVisible()
  await page
    .getByRole('link')
    .filter({ hasText: `Synthetic campaign ${suffix}` })
    .first()
    .click()
  await page.getByRole('link').filter({ hasText: playerName }).first().click()
  expect(
    new URL(page.url()).pathname === playerPath,
    'Readback must return to the same player',
  ).toBe(true)
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.locator('#history-panel')).toBeVisible()
  const historyError = page
    .locator('#history-panel')
    .getByText(/^(INVALID_RESPONSE|DATABASE_ERROR|NETWORK_ERROR|FORBIDDEN)/)
  if (await historyError.count()) {
    throw new Error(
      `History read failed: ${(await historyError.innerText()).split(',')[0]}`,
    )
  }
  await expect(
    page
      .locator('#history-panel')
      .getByText('Synthetic reviewed preparation observation.', { exact: true })
      .first(),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Write feedback', exact: true }).click()
  await page
    .getByLabel('Observations (required to submit)', { exact: true })
    .fill('Synthetic partial draft restored across sessions.')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await page.reload()
  await login(page, coachEmail, coachPassword)
  await page
    .getByRole('link')
    .filter({ hasText: `Synthetic campaign ${suffix}` })
    .first()
    .click()
  await page.getByRole('link').filter({ hasText: playerName }).first().click()
  await expect(
    page.getByLabel('Observations (required to submit)', { exact: true }),
  ).toHaveValue('Synthetic partial draft restored across sessions.')
  await page
    .getByLabel('Observation date (required to submit)', { exact: true })
    .fill('2026-01-02')
  await page
    .getByRole('button', { name: 'Submit feedback', exact: true })
    .click()
  await expect(
    page.getByText('Feedback submitted.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(
    page
      .locator('#history-panel')
      .getByText('Synthetic partial draft restored across sessions.', {
        exact: true,
      }),
  ).toBeVisible()
  await expect(
    page
      .locator('#history-panel')
      .getByText('Synthetic reviewed preparation observation.', {
        exact: true,
      }),
  ).toBeVisible()
  const anonymous = createClient(apiUrl, publicKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const denied = await anonymous
    .from('feedback_entries')
    .select('id')
    .eq('player_id', playerOption)
  expect(
    Boolean(denied.error) || denied.data?.length === 0,
    'Anonymous direct reads must not obtain feedback',
  ).toBe(true)
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) => key.startsWith('sb-')),
    ),
    'Normal login must remain in memory',
  ).toBe(false)
})
