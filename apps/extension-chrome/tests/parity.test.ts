import { describe, expect, it } from "vitest";

describe.skip("phase δ parity: extension-host vs bundled Report.meta.browser.source", () => {
  it("extension path produces Report.meta.browser.source === 'extension-host'", () => {
    // Deferred to manual smoke test per phase-delta-extension.md §M.
    // Playwright extension-loading is flaky in CI; SPA-driven E2E is the integration test of record.
    expect.fail("manual smoke only");
  });

  it("runner path produces Report.meta.browser.source === 'bundled'", () => {
    expect.fail("manual smoke only");
  });

  it("CWV CoV across paths is within 30% bound for v1 single-run", () => {
    expect.fail("manual smoke only");
  });
});
