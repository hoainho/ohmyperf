import { renderReportHtml } from "@ohmyperf/viewer";
import type { Report } from "@ohmyperf/core";

const card = document.getElementById("card") as HTMLDivElement | null;
const dropzone = document.getElementById("dropzone") as HTMLDivElement | null;
const fileInput = document.getElementById("file-input") as HTMLInputElement | null;
const errorEl = document.getElementById("error") as HTMLDivElement | null;

function showError(message: string): void {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError(): void {
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.hidden = true;
}

function parseAndRender(text: string): void {
  clearError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    showError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!isReport(parsed)) {
    showError("This file isn't a v1.0.0 OhMyPerf report.");
    return;
  }
  const html = renderReportHtml(parsed, { title: `OhMyPerf — ${parsed.meta.url}` });
  document.open();
  document.write(html);
  document.close();
}

function isReport(value: unknown): value is Report {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<Report>;
  if (r.schemaVersion !== "1.0.0") return false;
  if (!Array.isArray(r.runs)) return false;
  if (!r.meta || typeof r.meta !== "object") return false;
  return true;
}

if (fileInput) {
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => showError("Could not read file.");
    reader.onload = () => parseAndRender(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

if (dropzone && card) {
  for (const ev of ["dragenter", "dragover"] as const) {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.add("dragging");
    });
  }
  for (const ev of ["dragleave", "drop"] as const) {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("dragging");
    });
  }
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => showError("Could not read file.");
    reader.onload = () => parseAndRender(String(reader.result ?? ""));
    reader.readAsText(file);
  });
  document.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text");
    if (text && text.trim().startsWith("{")) {
      parseAndRender(text);
    }
  });
}

export {};
