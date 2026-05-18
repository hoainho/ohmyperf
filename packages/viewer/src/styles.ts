import { PALETTE_CSS } from "@ohmyperf/design-tokens";

const STRUCTURAL_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--color-background);
  color: var(--color-foreground);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, system-ui, sans-serif;
  padding: 24px;
}
.container { max-width: 1100px; margin: 0 auto; }
h1, h2, h3 { margin-top: 0; }
h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.015em; margin-bottom: 4px; }
h2 { font-size: 16px; font-weight: 600; margin: 32px 0 12px; letter-spacing: -0.005em; }
h3 { font-size: 12px; font-weight: 600; margin: 0 0 8px; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.06em; }
.muted { color: var(--color-muted-foreground); }
.mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 12.5px; }
.panel {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 16px;
}
.hero { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; padding: 20px 22px; margin-bottom: 20px; }
.hero h1 { color: var(--color-foreground); }
.hero .url { color: var(--color-muted-foreground); font-family: ui-monospace, monospace; font-size: 13px; word-break: break-all; margin: 6px 0 14px; }
.hero .badges { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; background: var(--color-muted); color: var(--color-foreground); border: 1px solid var(--color-border); }
.badge.accent { background: color-mix(in srgb, var(--color-accent-primary) 12%, transparent); color: var(--color-accent-primary); border-color: color-mix(in srgb, var(--color-accent-primary) 30%, transparent); }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
.meta dt { color: var(--color-muted-foreground); }
.meta dd { margin: 0; word-break: break-all; }
.cwv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.cwv-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 14px 16px;
  border-left-width: 4px;
  position: relative;
}
.cwv-card .name { color: var(--color-muted-foreground); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; }
.cwv-card .value { font-size: 26px; font-weight: 600; margin-top: 6px; letter-spacing: -0.02em; }
.cwv-card .sub { color: var(--color-muted-foreground); font-size: 11.5px; margin-top: 4px; }
.cwv-card .icon { position: absolute; top: 14px; right: 16px; font-size: 16px; line-height: 1; }
.cwv-card[data-cwv-status="good"] { border-left-color: var(--color-accent-success); }
.cwv-card[data-cwv-status="good"] .icon { color: var(--color-accent-success); }
.cwv-card[data-cwv-status="needs-improvement"] { border-left-color: var(--color-accent-warning); }
.cwv-card[data-cwv-status="needs-improvement"] .icon { color: var(--color-accent-warning); }
.cwv-card[data-cwv-status="poor"] { border-left-color: var(--color-accent-danger); }
.cwv-card[data-cwv-status="poor"] .icon { color: var(--color-accent-danger); }
.cwv-card[data-cwv-status="unknown"] { border-left-color: var(--color-border); }
.cwv-card.unstable { border-style: dashed; }
.unstable-banner {
  background: color-mix(in srgb, var(--color-accent-warning) 15%, var(--color-card));
  border-left: 3px solid var(--color-accent-warning);
  padding: 12px 14px;
  border-radius: 6px;
  margin-bottom: 16px;
}
.empty-state {
  background: var(--color-card);
  border: 1px dashed var(--color-border);
  border-radius: 10px;
  padding: 14px 18px;
  margin-bottom: 16px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.empty-state[data-tone="success"] {
  border-color: color-mix(in srgb, var(--color-accent-success) 35%, transparent);
  background: color-mix(in srgb, var(--color-accent-success) 5%, var(--color-card));
}
.empty-state .icon { color: var(--color-accent-success); font-weight: 600; }
.third-parties { display: grid; grid-template-columns: 240px 1fr; gap: 24px; align-items: start; }
.third-parties svg { display: block; }
.third-parties .legend { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.third-parties .legend li { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.third-parties .legend .swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; background: var(--color-muted); }
.ohmyperf-donut [data-donut-empty="1"] { stroke: var(--color-muted); }
[data-donut-slice="0"] { stroke: var(--color-accent-primary); background: var(--color-accent-primary); }
[data-donut-slice="1"] { stroke: var(--color-accent-success); background: var(--color-accent-success); }
[data-donut-slice="2"] { stroke: var(--color-accent-warning); background: var(--color-accent-warning); }
[data-donut-slice="3"] { stroke: var(--color-accent-danger); background: var(--color-accent-danger); }
[data-donut-slice="4"] { stroke: var(--color-muted-foreground); background: var(--color-muted-foreground); }
[data-donut-slice="5"] { stroke: var(--color-foreground); background: var(--color-foreground); }
.ohmyperf-bars [data-bar="label"] { fill: var(--color-foreground); }
.ohmyperf-bars [data-bar="track"] { fill: var(--color-muted); }
.ohmyperf-bars [data-bar="filled"] { fill: var(--color-accent-primary); }
.ohmyperf-bars [data-bar="value-text"] { fill: var(--color-muted-foreground); }
.third-parties .legend .label { flex: 1; word-break: break-word; }
.third-parties .legend .pct { color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; font-size: 12px; }
@media (max-width: 640px) { .third-parties { grid-template-columns: 1fr; } }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--color-border); }
th { font-weight: 600; color: var(--color-muted-foreground); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; }
tbody tr:nth-child(even) { background: color-mix(in srgb, var(--color-muted) 50%, transparent); }
.tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.tag.pass { background: color-mix(in srgb, var(--color-accent-success) 18%, transparent); color: var(--color-accent-success); }
.tag.fail { background: color-mix(in srgb, var(--color-accent-danger)  20%, transparent); color: var(--color-accent-danger); }
.tag.warn { background: color-mix(in srgb, var(--color-accent-warning) 22%, transparent); color: var(--color-accent-warning); }
details { margin: 0; }
details > summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
pre.code {
  background: var(--color-muted);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  white-space: pre;
  margin: 8px 0 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12px;
}
.frame-tree ul { list-style: none; padding-left: 18px; margin: 4px 0; }
.frame-tree li { margin: 4px 0; }
.frame-tree .frame-url { color: var(--color-muted-foreground); font-family: ui-monospace, monospace; font-size: 11.5px; }
.foot { color: var(--color-muted-foreground); font-size: 12px; margin-top: 32px; }
.foot a { color: var(--color-accent-primary); }
@media print {
  body { background: #fff; color: #000; padding: 12mm; font-size: 11pt; }
  .panel, .hero, .cwv-card, .empty-state { background: #fff; border-color: #888; box-shadow: none; }
  .cwv-card[data-cwv-status="good"]::after { content: " (good)"; }
  .cwv-card[data-cwv-status="needs-improvement"]::after { content: " (needs improvement)"; }
  .cwv-card[data-cwv-status="poor"]::after { content: " (poor)"; }
  .cwv-card .icon { color: #000 !important; }
  table { page-break-inside: avoid; }
  a[href]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #555; }
  .foot { color: #555; }
  details > summary { font-weight: 600; }
  details:not([open]) > *:not(summary) { display: none; }
}
`;

export { STRUCTURAL_CSS };

export const VIEWER_CSS = `${PALETTE_CSS}
${STRUCTURAL_CSS}`;
