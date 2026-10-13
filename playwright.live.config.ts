import { defineConfig } from '@playwright/test'
import preview from './playwright.config.ts'

export default defineConfig({
  ...preview,
  testMatch: 'first-feedback.live.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  preserveOutput: 'never',
  timeout: 120000,
  use: { ...preview.use, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5173/api/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
})
