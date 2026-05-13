'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { SiteHeader } from '@/components/layout/site-header';
import { ReportViewer } from '@/components/viewer/report-viewer';
import { CwvGauge } from '@/components/metrics/cwv-gauge';
import { listReports, deleteReport, clearAllReports, getReport } from '@/lib/storage';
import type { StoredReport } from '@/lib/storage';
import { shortenUrl } from '@/lib/format';
import type { Report } from '@ohmyperf/core';

function ReportContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');

  if (id) return <SingleReport id={id} />;
  return <ReportHistory />;
}

function SingleReport({ id }: { id: string }) {
  const [stored, setStored] = useState<StoredReport | null | undefined>(undefined);

  useEffect(() => {
    getReport(id).then((r) => setStored(r ?? null)).catch(() => setStored(null));
  }, [id]);

  if (stored === undefined) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-6 py-12">
          <div className="text-muted-foreground">Loading report…</div>
        </main>
      </>
    );
  }

  if (!stored) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-12 text-center">
          <p className="text-lg font-medium mb-2">Report not found</p>
          <p className="text-sm text-muted-foreground mb-4 font-mono">{id}</p>
          <p className="text-sm text-muted-foreground mb-6">
            Reports are stored locally in your browser and may have been cleared.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/report" className="text-sm underline underline-offset-4 hover:text-foreground transition-colors">All reports</Link>
            <Link href="/" className="text-sm underline underline-offset-4 hover:text-foreground transition-colors">Measure a URL</Link>
          </div>
        </main>
      </>
    );
  }

  return <ReportDisplay report={stored.report} />;
}

function ReportDisplay({ report }: { report: Report }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold truncate max-w-xl">{report.meta.url}</h1>
          <Link href="/report" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← All reports
          </Link>
        </div>
        <CwvGauge report={report} />
        <ReportViewer report={report} />
      </main>
    </>
  );
}

function ReportHistory() {
  const [reports, setReports] = useState<StoredReport[] | null>(null);

  useEffect(() => {
    listReports(100).then(setReports).catch(() => setReports([]));
  }, []);

  const handleDelete = async (id: string) => {
    await deleteReport(id);
    setReports((prev) => prev?.filter((r) => r.id !== id) ?? []);
    toast.success('Report deleted.');
  };

  const handleClearAll = async () => {
    await clearAllReports();
    setReports([]);
    toast.success('All reports cleared.');
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Report History</h1>
          {reports && reports.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-sm text-muted-foreground hover:text-destructive transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {reports === null ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
            <p className="text-sm">No reports yet.</p>
            <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-4 hover:text-foreground transition-colors">
              Measure a URL
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="rounded-lg border bg-card p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/report/?id=${encodeURIComponent(r.id)}`} className="text-sm font-medium hover:underline truncate block">
                    {shortenUrl(r.url)}
                  </Link>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{r.mode}</span>
                    <span>{new Date(r.createdAt).toLocaleString()}</span>
                    <span>{(r.sizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Delete report for ${r.url}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading…</div>}>
      <ReportContent />
    </Suspense>
  );
}
