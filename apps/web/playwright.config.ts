import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const WEB_PORT = 3100;
const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgres://weight_api:weight_api_local@localhost:5432/weight_ai_test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @weight-ai/api e2e-server',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: TEST_DB,
        AUTH_PROVIDER: 'local',
        LOCAL_JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0001',
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
        RATE_LIMIT_PER_MINUTE: '10000',
        CHAT_RATE_LIMIT_PER_MINUTE: '10000',
        AUTH_RATE_LIMIT_PER_MINUTE: '10000',
      },
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
