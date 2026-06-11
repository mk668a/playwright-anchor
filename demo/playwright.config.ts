import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // generous: first heal includes local model cold-load (the red step in the
  // demo tape uses PLAYWRIGHT_ANCHOR_MODE=off, which fails on the locator
  // timeout below, not this)
  timeout: 60_000,
  reporter: [['list']],
  // actionTimeout keeps the PLAYWRIGHT_ANCHOR_MODE=off step of the demo tape
  // failing fast (~5s) instead of waiting out the full test timeout
  use: { headless: true, actionTimeout: 5_000 },
});
