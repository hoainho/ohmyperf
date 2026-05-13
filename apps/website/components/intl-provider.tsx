'use client';

import { NextIntlClientProvider } from 'next-intl';
import type { AbstractIntlMessages } from 'next-intl';
import { useEffect, useState } from 'react';
import { defaultLocale, locales, type Locale } from '@/i18n/routing';
import enMessages from '@/i18n/messages/en.json';

type MessageBundle = AbstractIntlMessages;

function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return defaultLocale;
  const stored = typeof localStorage !== 'undefined'
    ? (localStorage.getItem('omo:locale') as Locale | null)
    : null;
  if (stored && locales.includes(stored)) return stored;
  const nav = navigator.language.slice(0, 2).toLowerCase() as Locale;
  return locales.includes(nav) ? nav : defaultLocale;
}

export function IntlProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [messages, setMessages] = useState<MessageBundle>(enMessages as MessageBundle);

  useEffect(() => {
    const detected = detectLocale();
    if (detected === defaultLocale) return;
    let cancelled = false;
    import(`@/i18n/messages/${detected}.json`)
      .then((mod: { default: AbstractIntlMessages }) => {
        if (!cancelled) {
          setLocale(detected);
          setMessages(mod.default);
        }
      })
      .catch(() => { /* empty */ });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
