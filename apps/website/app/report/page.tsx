'use client';

import Link from 'next/link';
import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteHeader } from '@/components/layout/site-header';

function useReportId(): string | null {
  const search = useSearchParams();
  return useMemo(() => search.get('id'), [search]);
}

function ReportContent() {
  const id = useReportId();

  if (!id) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-12">
          <h1 className="text-2xl font-semibold mb-2">Report History</h1>
          <p className="text-muted-foreground mb-8">
            Your recent measurements will appear here (Phase γ).
          </p>
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
            <p className="text-sm">No reports yet.</p>
            <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-4 hover:text-foreground transition-colors">
              Measure a URL
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-muted-foreground">
          Report id: <code>{id}</code>
        </p>
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
