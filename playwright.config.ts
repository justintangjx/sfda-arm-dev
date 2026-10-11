import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 2,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium_desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
      },
    },
    {
      name: 'chromium_mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
      },
    },
    {
      name: 'webkit_desktop',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'webkit_mobile',
      use: {
        browserName: 'webkit',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'pnpm build:preview && pnpm preview',
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
