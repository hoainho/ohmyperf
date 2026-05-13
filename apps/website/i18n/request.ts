import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { defaultLocale } from './routing';

export default getRequestConfig(async () => {
  const locale = defaultLocale;
  const messages = (await import(`./messages/${locale}.json`)).default as AbstractIntlMessages;
  return { locale, messages };
});
