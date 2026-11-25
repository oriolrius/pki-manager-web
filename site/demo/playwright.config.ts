import { defineConfig } from '@playwright/test';

// Doc screenshots and screencasts from the demo stack (demo/demo.sh up).
// Specs run in file order, one worker: later guides build on data created by earlier ones.
export default defineConfig({
  testDir: './shots',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:47380',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
});
