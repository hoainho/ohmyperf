import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-semibold text-sm tracking-tight">
          OhMyPerf
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/viewer/" className="hover:text-foreground transition-colors">Viewer</Link>
          <Link href="/report/" className="hover:text-foreground transition-colors">History</Link>
          <a
            href="https://github.com/ohmyperf/ohmyperf"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
