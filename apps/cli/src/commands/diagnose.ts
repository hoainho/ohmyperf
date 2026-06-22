import { defineCommand } from "citty";
import { runCommand } from "./run.js";

// `diagnose` is `run` with --diagnose and --rx forced on: measure the URL, then report WHY it is
// slow (component hotspots) and WHAT to fix (ranked, targeted remediations). It reuses the full
// `run` flag surface and handler so the two stay in lockstep.
export const diagnoseCommand = defineCommand({
  meta: {
    name: "diagnose",
    description:
      "Measure a URL, then report why it is slow (hotspots) and what to fix (ranked remediations). Equivalent to `run --rx`.",
  },
  args: runCommand.args ?? {},
  async run({ args }): Promise<void> {
    const run = runCommand.run;
    if (!run) return;
    // The run handler only reads `args`; cast the minimal context to satisfy citty's type.
    await run({ args: { ...args, diagnose: true, rx: true } } as unknown as Parameters<typeof run>[0]);
  },
});
