import { Globe } from 'lucide-react';
import clsx from 'clsx';
import { useSession } from '../lib/session.tsx';
import { LANGS, LANG_CODE, LANG_NAME, t } from '../lib/i18n/index.ts';
import type { Lang } from '../lib/i18n/index.ts';

/**
 * Two-option switch: AM = Amharic, ENG = English. The active option is spelled
 * out as an endonym on the label row so the meaning of the codes is discoverable
 * without a tooltip, which matters because the codes themselves are ambiguous
 * across locales.
 */
export function LangSwitch({ className }: { className?: string }) {
  const { lang, toggleLang } = useSession();

  return (
    <div
      className={clsx('inline-flex items-center rounded-md border border-line bg-surface p-0.5', className)}
      role="group"
      aria-label={t('Language')}
    >
      {LANGS.map((code) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => {
              if (!active) toggleLang();
            }}
            aria-pressed={active}
            title={LANG_NAME[code]}
            lang={code}
            className={clsx(
              'rounded px-2 py-1 text-[11px] font-bold transition-colors',
              active ? 'bg-brand text-white' : 'text-ink-3 hover:text-ink',
            )}
          >
            {LANG_CODE[code]}
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">
        {lang === 'am' ? 'የአማርኛ እይታ' : 'English view'}
      </span>
    </div>
  );
}

/** Compact globe button for tight header rows. Shows the target language. */
export function LangButton() {
  const { lang, toggleLang } = useSession();
  const target: Lang = lang === 'am' ? 'en' : 'am';

  return (
    <button
      type="button"
      onClick={toggleLang}
      title={t(target === 'am' ? 'Switch to Amharic' : 'Switch to English')}
      aria-label={t('Switch language')}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Globe className="size-3.5" />
      <span className="text-[11px] font-bold">{LANG_CODE[target]}</span>
    </button>
  );
}