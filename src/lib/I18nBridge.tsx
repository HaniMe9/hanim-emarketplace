import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { setActiveLang } from './i18n/index.ts';
import type { Lang } from './i18n/index.ts';
import { useSession } from './session.tsx';

/**
 * Publishes the session's language to the non-React helpers in `i18n` and
 * `format`. Set during render rather than in an effect so the very first paint
 * in a new language already has matching number and date formats.
 */
export function I18nBridge({ children }: { children: ReactNode }) {
  const { lang } = useSession();
  setActiveLang(lang as Lang);
  useEffect(() => {
    document.documentElement.lang = lang === 'am' ? 'am' : 'en';
  }, [lang]);
  return <>{children}</>;
}