import { defineConfig } from '@playwright/test';

// Browser checks on the demo stack (demo/demo.sh check). They are not screenshots: nothing is written to docs/.
export default defineConfig({
  testDir: './checks',
  timeout: 240_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'UTC' },
});
