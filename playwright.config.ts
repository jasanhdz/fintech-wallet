import 'dotenv/config';
import { defineConfig } from '@playwright/test';

const isolatedDatabaseUrl = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!isolatedDatabaseUrl) {
  throw new Error('E2E_DATABASE_URL or TEST_DATABASE_URL must target the isolated wallet_test database');
}

export default defineConfig({
  testDir: './web/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:3100/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        API_PORT: '3100',
        DATABASE_URL: isolatedDatabaseUrl,
        WEB_ORIGIN: 'http://127.0.0.1:5174',
      },
    },
    {
      command: 'npm --workspace @fintech-wallet/web run dev -- --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        VITE_API_URL: 'http://127.0.0.1:3100/v1',
        WEB_ORIGIN: 'http://127.0.0.1:5174',
      },
    },
  ],
});
