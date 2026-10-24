import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node scripts/serve-like-cloudflare.mjs 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false, // always test a fresh build
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-ipad', use: { ...devices['iPad Pro 11'] } },
  ],
});
