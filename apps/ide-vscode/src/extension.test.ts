import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: (_k: string, def: unknown) => def }) },
  window: {
    createWebviewPanel: vi.fn(() => ({ webview: { html: "" } })),
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showOpenDialog: vi.fn(),
    withProgress: vi.fn(),
  },
  commands: { registerCommand: vi.fn() },
  ViewColumn: { Active: 1 },
  ProgressLocation: { Notification: 15 },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

describe("ide-vscode extension", () => {
  it("renderReportHtml wiring: showReportInWebview puts HTML on webview.html", async () => {
    const vscode = (await import("vscode")) as unknown as {
      window: { createWebviewPanel: ReturnType<typeof vi.fn> };
    };
    const ext = await import("./extension.js");

    const dir = await mkdtemp(join(tmpdir(), "ohmyperf-vscode-test-"));
    const reportPath = join(dir, "report.json");
    const report = {
      schemaVersion: "1.0.0",
      meta: {
        url: "https://example.com",
        startedAt: "2026-05-11T00:00:00.000Z",
        durationMs: 1000,
        runs: 1,
        mode: "real",
        browser: { name: "chromium", version: "147.0", source: "bundled" },
        host: { os: "linux", arch: "x64", nodeVersion: "v22" },
        parity: { mode: "headless", knownDeltas: {} },
        emulation: false,
        pluginCapabilityUses: [],
        measurementId: "m_test",
      },
      runs: [],
      aggregated: {},
      frames: { root: "r", nodes: { r: { frameId: "r", url: "https://x", origin: "https://x", parentFrameId: null, isOOPIF: false, isCrossOrigin: false, attachedAt: 0, metrics: {}, children: [] } } },
      audits: [],
      artifacts: {},
      pluginData: {},
    };
    await writeFile(reportPath, JSON.stringify(report));

    vscode.window.createWebviewPanel.mockClear();
    const panel = { webview: { html: "" } };
    vscode.window.createWebviewPanel.mockReturnValue(panel);

    const fakeContext = { extensionPath: "/fake", subscriptions: [] } as unknown as Parameters<typeof ext.openReportCommand>[0];
    const showOpen = (await import("vscode")) as unknown as { window: { showOpenDialog: ReturnType<typeof vi.fn> } };
    showOpen.window.showOpenDialog.mockResolvedValueOnce([{ fsPath: reportPath }]);
    await ext.openReportCommand(fakeContext);

    expect(panel.webview.html).toContain("<!doctype html>");
    expect(panel.webview.html).toContain("OhMyPerf v1.0.0 report");
    expect(panel.webview.html).toContain("https://example.com");
  });

  it("activate registers both commands", async () => {
    const vscode = (await import("vscode")) as unknown as {
      commands: { registerCommand: ReturnType<typeof vi.fn> };
    };
    vscode.commands.registerCommand.mockClear();
    const ext = await import("./extension.js");
    const fakeContext = { extensionPath: "/fake", subscriptions: [] } as unknown as Parameters<typeof ext.activate>[0];
    ext.activate(fakeContext);
    const calls = vscode.commands.registerCommand.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain("ohmyperf.measureUrl");
    expect(calls).toContain("ohmyperf.openReport");
  });
});
