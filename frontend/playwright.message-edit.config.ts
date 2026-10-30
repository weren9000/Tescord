import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: 'message-editing.spec.ts',
  use: { baseURL: 'http://127.0.0.1:4229' },
  webServer: {
    command: 'npm run start -- --host 127.0.0.1 --port 4229',
    url: 'http://127.0.0.1:4229',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
