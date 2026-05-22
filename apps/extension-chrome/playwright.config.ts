import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-headed-with-extension",
      use: {},
    },
  ],
  webServer: {
    command: "pnpm --filter @ohmyperf/website dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
