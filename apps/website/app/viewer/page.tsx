import { SiteHeader } from '@/components/layout/site-header';

export default function ViewerPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold mb-2">Report Viewer</h1>
        <p className="text-muted-foreground mb-8">
          Drag and drop a <code className="text-sm bg-muted px-1 rounded">report.json</code> file to view it locally (Phase γ).
        </p>
        <div className="rounded-lg border-2 border-dashed border-border p-16 text-center text-muted-foreground">
          <p className="text-lg mb-2">Drop report.json here</p>
          <p className="text-sm">No upload — runs entirely in your browser.</p>
        </div>
      </main>
    </>
  );
}
