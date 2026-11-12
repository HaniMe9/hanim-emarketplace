import './am.ts';
import { t, tr, dict, activeLang, setActiveLang, localeFor, LANG_CODE, LANG_NAME, LANGS, auditTranslations, untranslated } from './engine.ts';

export {
  t,
  tr,
  dict,
  activeLang,
  setActiveLang,
  localeFor,
  LANG_CODE,
  LANG_NAME,
  LANGS,
  auditTranslations,
  untranslated,
};
export type { Lang, Vars, Dict } from './engine.ts';