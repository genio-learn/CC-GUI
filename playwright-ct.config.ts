import { defineConfig, devices } from "@playwright/test";

// The .iwft layer: the whole frontend in a real browser with the backend faked
// (see plans/testing.md). Named playwright-ct.config.ts for parity with genio's
// iwft config, though there's no component-test runner — vanilla TS boots the
// real index.html via Vite (webServer) and the TauriSimulator fakes the IPC.
export default defineConfig({
  testDir: "./src/playwright/iwft/scenarios",
  testMatch: "**/*.iwft.ts",
  globalSetup: "./src/playwright/iwft/support/globalSetup.testHelper.ts",
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:1420",
    testIdAttribute: "data-test",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
