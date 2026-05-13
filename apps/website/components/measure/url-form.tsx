'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { detectPrivateHost, urlFormSchema, type UrlFormValues } from '@/lib/url-validation';

interface Props {
  autoFocus?: boolean;
  defaultUrl?: string;
}

export function UrlForm({ autoFocus, defaultUrl = '' }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [privateWarning, setPrivateWarning] = useState<string | null>(null);

  const form = useForm<UrlFormValues>({
    resolver: zodResolver(urlFormSchema),
    defaultValues: { url: defaultUrl },
    mode: 'onSubmit',
  });

  function onSubmit({ url }: UrlFormValues) {
    const hint = detectPrivateHost(url);
    if (hint.kind !== 'none' && !privateWarning) {
      setPrivateWarning(
        hint.kind === 'loopback'
          ? `${hint.host} won't be reachable from the runner. Measure a public URL or run locally.`
          : `${hint.host} is a private IP. The runner will refuse this unless OHMYPERF_RUNNER_ALLOW_PRIVATE=1.`,
      );
      return;
    }
    setPrivateWarning(null);
    startTransition(() => {
      router.push(`/measure/?url=${encodeURIComponent(url)}`);
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <FormField
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormControl>
                  <Input
                    {...field}
                    type="url"
                    inputMode="url"
                    placeholder="https://example.com"
                    autoComplete="url"
                    autoFocus={autoFocus}
                    aria-label="URL to measure"
                    disabled={isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" disabled={isPending}>
            {isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Measuring</>
            ) : (
              <><Zap className="mr-2 h-4 w-4" />Measure</>
            )}
          </Button>
        </div>
        {privateWarning && (
          <Alert variant="default">
            <AlertDescription>
              {privateWarning} <strong>Click Measure again to proceed.</strong>
            </AlertDescription>
          </Alert>
        )}
      </form>
    </Form>
  );
}
