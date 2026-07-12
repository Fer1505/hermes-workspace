import { defineConfig } from 'playwright/test'

const port = Number(process.env.E2E_PORT || 3102)
const baseURL = `http://127.0.0.1:${port}`
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : undefined,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      HOST: '127.0.0.1',
      PORT: String(port),
    },
  },
})
