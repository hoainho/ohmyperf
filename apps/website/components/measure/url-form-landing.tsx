'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap } from 'lucide-react';

interface Props {
  autoFocus?: boolean;
}

export function UrlFormLanding({ autoFocus }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [privateWarning, setPrivateWarning] = useState<string | null>(null);

  function isPrivate(rawUrl: string): { isPrivate: true; hint: string } | { isPrivate: false } {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.toLowerCase();
      const privateHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
      if (privateHosts.has(host)) return { isPrivate: true, hint: `${host} won't be reachable from the runner. Measure a public URL or run locally.` };
      if (/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
        return { isPrivate: true, hint: `${host} is a private IP. The runner will refuse this unless OHMYPERF_RUNNER_ALLOW_PRIVATE=1.` };
      }
      return { isPrivate: false };
    } catch {
      return { isPrivate: false };
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = inputRef.current?.value.trim() ?? '';
    if (!url) { setError('Enter a URL to measure'); return; }
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        setError('Must be a valid http(s) URL');
        return;
      }
    } catch {
      setError('Must be a valid http(s) URL');
      return;
    }
    const check = isPrivate(url);
    if (check.isPrivate && !privateWarning) {
      setPrivateWarning(check.hint);
      setError(null);
      return;
    }
    setError(null);
    setPrivateWarning(null);
    router.push(`/measure/?url=${encodeURIComponent(url)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={inputRef}
          type="url"
          inputMode="url"
          placeholder="https://example.com"
          autoComplete="url"
          autoFocus={autoFocus}
          aria-label="URL to measure"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 flex-1"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-6"
        >
          <Zap className="mr-2 h-4 w-4" />
          Measure
        </button>
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {privateWarning && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
          {privateWarning} <strong>Click Measure again to proceed.</strong>
        </div>
      )}
    </form>
  );
}
