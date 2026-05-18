import { describe, expect, it } from "vitest";
import { isInteractiveContext } from "./run-interactive.js";

describe("isInteractiveContext", () => {
  it("returns false in test environment (vitest is not a TTY)", () => {
    expect(isInteractiveContext()).toBe(false);
  });
});
