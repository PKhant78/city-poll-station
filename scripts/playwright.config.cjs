const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.cjs',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
});
