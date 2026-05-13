import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { IntlProvider } from '@/components/intl-provider';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const CSP = [
  "default-src 'self'",
  "connect-src 'self' http://localhost:5174 http://127.0.0.1:5174",
  "img-src 'self' data: https:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const metadata: Metadata = {
  metadataBase: new URL('https://ohmyperf.dev'),
  title: {
    default: 'OhMyPerf — Real-machine web performance measurement',
    template: '%s · OhMyPerf',
  },
  description:
    'Real-machine, real-browser web performance measurement with ~99% cross-origin iframe coverage. Runs on your hardware, not a synthetic datacenter CPU.',
  applicationName: 'OhMyPerf',
  authors: [{ name: 'OhMyPerf' }],
  openGraph: {
    type: 'website',
    siteName: 'OhMyPerf',
    title: 'OhMyPerf — Real-machine web performance measurement',
    description:
      'CWV measurement on your hardware. Cross-origin iframe deep-inspection. Honest variance.',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1020' },
  ],
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <IntlProvider>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </IntlProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
