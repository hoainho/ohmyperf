import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit/integration tests only. The Playwright E2E specs under
    // tests/playwright-e2e/ are owned by playwright.config.ts (testDir) and
    // must NOT be collected by vitest — doing so triggers
    // "Playwright Test did not expect test.beforeAll() to be called here".
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/playwright-e2e/**", "node_modules/**", "extension-dist/**"],
  },
});
