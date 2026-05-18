import { escapeHtml } from "../escape.js";

export type EmptyStateTone = "success" | "info";

export function renderEmptyState(message: string, tone: EmptyStateTone = "info"): string {
  const icon = tone === "success" ? "✓" : "·";
  return `<div class="empty-state" data-tone="${escapeHtml(tone)}"><span class="icon" aria-hidden="true">${icon}</span><span>${escapeHtml(message)}</span></div>`;
}
