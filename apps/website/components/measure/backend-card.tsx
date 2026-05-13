'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { type Backend, detectBackend } from '@/lib/backend-detector';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
}

export function BackendCard({ className }: Props) {
  const [backend, setLocalBackend] = useState<Backend | null>(null);
  const [detecting, setDetecting] = useState(true);
  const setStoreBackend = useStore((s) => s.setBackend);

  useEffect(() => {
    const ac = new AbortController();
    detectBackend(ac.signal)
      .then((b) => {
        setLocalBackend(b);
        setStoreBackend(b);
        setDetecting(false);
      })
      .catch(() => {
        const none: Backend = { kind: 'none' };
        setLocalBackend(none);
        setStoreBackend(none);
        setDetecting(false);
      });
    return () => { ac.abort(); };
  }, [setStoreBackend]);

  if (detecting) {
    return (
      <Card className={cn('border-dashed', className)}>
        <CardContent className="py-3 text-sm text-muted-foreground">
          Detecting backend…
        </CardContent>
      </Card>
    );
  }

  if (backend?.kind === 'extension') {
    return (
      <Card className={cn('border-green-500/30 bg-green-500/5', className)}>
        <CardContent className="py-3 flex items-center gap-2 text-sm">
          <Badge variant="default" className="bg-green-600 hover:bg-green-600">Extension ready</Badge>
          <span className="text-muted-foreground">v{backend.version}</span>
        </CardContent>
      </Card>
    );
  }

  if (backend?.kind === 'runner') {
    return (
      <Card className={cn('border-blue-500/30 bg-blue-500/5', className)}>
        <CardContent className="py-3 flex items-center gap-2 text-sm">
          <Badge variant="default" className="bg-blue-600 hover:bg-blue-600">Local runner ready</Badge>
          <span className="text-muted-foreground">v{backend.version}</span>
          {backend.engine && <span className="text-muted-foreground">{backend.engine}</span>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Alert className={cn(className)}>
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
        <span className="text-sm">
          No backend detected. Install the Chrome extension or start the local runner to measure.
        </span>
        <div className="flex gap-2 flex-shrink-0">
          <Button asChild variant="outline" size="sm">
            <a href="https://chrome.google.com/webstore/detail/ohmyperf" rel="noopener noreferrer">
              Install extension
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="https://github.com/ohmyperf/ohmyperf/tree/main/apps/runner" rel="noopener noreferrer">
              Local runner
            </a>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
