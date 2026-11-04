import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4217',
    storageState:
      process.env['KVA_INTERFACE_STYLE'] === 'constellation'
        ? {
            cookies: [],
            origins: [
              {
                origin: 'http://127.0.0.1:4217',
                localStorage: [{ name: 'kva.interface-style.v1', value: 'constellation' }],
              },
            ],
          }
        : undefined,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'npm run start -- --host 127.0.0.1 --port 4217',
    url: 'http://127.0.0.1:4217',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
