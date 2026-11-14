import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm --workspace @fintech-wallet/web run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
