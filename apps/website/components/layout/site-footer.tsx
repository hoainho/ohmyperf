export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-muted-foreground flex flex-wrap gap-4 items-center justify-between">
        <span>OhMyPerf · Apache-2.0</span>
        <div className="flex gap-4">
          <a href="https://github.com/ohmyperf/ohmyperf" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}
