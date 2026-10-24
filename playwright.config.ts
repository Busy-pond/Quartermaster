import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test against a production build with PayPal and the AI model mocked (see scripts/e2e.mjs, which
 * builds, sets the environment and calls this). Run it with `npm run test:e2e`.
 */
const PORT = 3200;
/** Point at an app that is already running (for example `next dev`) to skip the build and the servers below. */
const EXISTING = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: EXISTING ?? `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: EXISTING ? undefined : [
    { command: "node scripts/mock-paypal.mjs", url: "http://localhost:4010/health", reuseExistingServer: !process.env.CI, timeout: 30_000 },
    { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}/api/health`, reuseExistingServer: false, timeout: 120_000 },
  ],
});
