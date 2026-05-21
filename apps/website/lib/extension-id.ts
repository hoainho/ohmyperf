import { env } from './env';

const STORAGE_KEY = 'ohmyperf:extension-id';

export function getExtensionId(): string {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && /^[a-p]{32}$/i.test(stored)) return stored;
    } catch {
      return env.NEXT_PUBLIC_EXTENSION_ID ?? '';
    }
  }
  return env.NEXT_PUBLIC_EXTENSION_ID ?? '';
}

export const EXTENSION_ID = env.NEXT_PUBLIC_EXTENSION_ID ?? '';
