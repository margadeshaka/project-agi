// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './app/e2e',
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  // Spin the dev server up only when the harness asks (CI sets PLAYWRIGHT_WEBSERVER=1).
  webServer: process.env.PLAYWRIGHT_WEBSERVER
    ? {
        command: 'npm run dev',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
