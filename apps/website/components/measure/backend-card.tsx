'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
}

export function BackendCard({ className }: Props) {
  const backend = useStore((s) => s.backend);

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
      <AlertDescription className="flex flex-col gap-3">
        <span className="text-sm">
          <span className="font-medium">No runner detected.</span> To measure live, install the Chrome extension or run the CLI locally, then click Measure to check again.
        </span>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={`${process.env['NEXT_PUBLIC_BASE_PATH'] ?? ''}/downloads/ohmyperf-extension-v0.2.0.zip`}
              download
            >
              Download Chrome extension (54 KB)
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="https://github.com/hoainho/ohmyperf#install" rel="noopener noreferrer">
              Install the CLI
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href="/viewer/" rel="noopener noreferrer">
              Drop a report.json instead
            </a>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
