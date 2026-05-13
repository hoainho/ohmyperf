'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { UrlForm } from '@/components/measure/url-form';
import { BackendCard } from '@/components/measure/backend-card';
import { SiteHeader } from '@/components/layout/site-header';

function MeasureContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get('url') ?? '';

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold mb-6">Measure</h1>

        <div className="space-y-4">
          <UrlForm defaultUrl={url} autoFocus={!url} />
          <BackendCard />
        </div>

        <div className="mt-8 rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <p className="text-sm">Measurement progress will appear here (Phase γ).</p>
        </div>
      </main>
    </>
  );
}

export default function MeasurePage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading…</div>}>
      <MeasureContent />
    </Suspense>
  );
}
