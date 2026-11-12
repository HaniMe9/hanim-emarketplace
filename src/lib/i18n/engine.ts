/**
 * Minimal runtime i18n. No dependency, no async loading.
 *
 * Keys are the English source strings verbatim. That keeps call sites readable
 * (`t('Add to cart')` greps straight back to the dictionary) and makes coverage
 * auditable: any string present in the code but absent from the Amharic
 * dictionary is a missing translation, and `auditTranslations()` reports them.
 */

export type Lang = 'am' | 'en';

export type Vars = Record<string, string | number>;

export type Dict = Record<string, string>;

/** Short codes shown in the language switcher. AM = Amharic, ENG = English. */
export const LANG_CODE: Record<Lang, string> = { am: 'AM', en: 'ENG' };

/** Endonyms, so the switcher names each language in its own script. */
export const LANG_NAME: Record<Lang, string> = { am: 'አማርኛ', en: 'English' };

export const LANGS: Lang[] = ['am', 'en'];

/** The dictionary is English-keyed, so English is the identity mapping. */
const dictionaries: Record<Lang, Dict> = { en: {}, am: {} };

/** Merge an extra dictionary into a language. */
export function register(lang: Lang, dict: Dict): void {
  Object.assign(dictionaries[lang], dict);
}

export function dict(lang: Lang): Dict {
  return dictionaries[lang] ?? {};
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Translate `key` into `lang`. An unknown key falls back to the key itself,
 * which is the English string — a missing translation degrades to readable
 * English instead of blank UI or a crash.
 */
export function tr(lang: Lang, key: string, vars?: Vars): string {
  const table = dictionaries[lang];
  const hit = table[key];
  if (hit === undefined) return interpolate(key, vars);
  return interpolate(hit, vars);
}

/* ------------------------------ active locale ---------------------------- */

/**
 * The language currently being rendered. Set by `<I18nBridge>` during render so
 * that non-React helpers (notably `format.ts`) can localise numbers, dates and
 * status names without every call site having to thread `lang` through.
 */
let active: Lang = 'en';

export function activeLang(): Lang {
  return active;
}

/**
 * Deliberately called during render rather than in an effect: an effect runs
 * after the DOM is painted, which would render the new language's strings with
 * the previous language's date and number formats until something forced a
 * second paint.
 */
export function setActiveLang(lang: Lang): void {
  active = lang;
}

/** Translate using the language currently being rendered. */
export function t(key: string, vars?: Vars): string {
  return tr(active, key, vars);
}

/** BCP-47 tag for `Intl`, so Ethiopic digits and month names come out right. */
export function localeFor(lang: Lang): string {
  return lang === 'am' ? 'am-ET' : 'en-ET';
}

/* -------------------------------- auditing ------------------------------- */

/** Keys used in the UI but missing from the Amharic dictionary. */
export function auditTranslations(referenced: Iterable<string>, lang: Lang = 'am'): string[] {
  const table = dictionaries[lang];
  return [...new Set(referenced)].filter((key) => table[key] === undefined).sort();
}

/** Amharic entries whose value is still identical to the English key. */
export function untranslated(lang: Lang = 'am'): string[] {
  return Object.keys(dictionaries[lang])
    .filter((key) => dictionaries[lang][key] === key)
    .sort();
}