import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run start -- --host 127.0.0.1 --port 4217',
    url: 'http://127.0.0.1:4217',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
