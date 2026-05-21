import Link from 'next/link';
import { getShareEndpoint } from '@/lib/env';

export function SiteHeader() {
  const endpoint = getShareEndpoint();
  return (
    <header className="border-b border-border">
      <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-semibold text-sm tracking-tight">
          OhMyPerf
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/viewer/" className="hover:text-foreground transition-colors">Viewer</Link>
          <Link href="/report/" className="hover:text-foreground transition-colors">History</Link>
          {endpoint ? (
            <span
              className="hidden sm:inline-block rounded-full border border-border bg-card px-2 py-0.5 text-xs"
              title={endpoint}
            >
              <span aria-hidden className="mr-1">●</span>Share connected
            </span>
          ) : (
            <a
              href="https://github.com/hoainho/ohmyperf/issues/9"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-block rounded-full border border-border bg-muted px-2 py-0.5 text-xs hover:text-foreground transition-colors"
              title="Share-server hosted endpoint pending — see issue #9"
            >
              Share pending
            </a>
          )}
          <a
            href="https://github.com/hoainho/ohmyperf"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
