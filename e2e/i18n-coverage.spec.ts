import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guard on the Amharic dictionary, run in-process so it costs nothing.
 *
 * The dictionary is keyed by English source string, which makes coverage
 * checkable: any `t('…')` literal in the UI that has no Amharic entry is a gap.
 * A missing entry degrades to readable English, so nothing breaks at runtime —
 * this test is what stops the gaps from accumulating.
 */

const SRC = 'src';
const DICT = 'src/lib/i18n/am.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : [];
  });
}

/** Every `t('…')` / `t("…")` first argument that is a plain literal. */
function usedKeys(): string[] {
  const re = /\bt\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  const keys: string[] = [];
  for (const file of walk(SRC)) {
    if (file === DICT) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) keys.push(m[1] ?? m[2]);
  }
  return keys;
}

/** Keys declared in the Amharic dictionary file. */
function declaredKeys(): Set<string> {
  const src = readFileSync(DICT, 'utf8');
  const re = /^\s{2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*))\s*:/gm;
  const keys = new Set<string>();
  for (const m of src.matchAll(re)) keys.add(m[1] ?? m[2] ?? m[3]!);
  return keys;
}

test.describe('translation coverage', () => {
  test('every literal passed to t() has an Amharic entry', () => {
    const used = [...new Set(usedKeys())];
    const declared = declaredKeys();
    const missing = used.filter((k) => !declared.has(k)).sort();

    expect(
      missing,
      `${missing.length} string(s) render in English when the UI is in Amharic.\n` +
        missing.map((m) => `  - ${m}`).join('\n'),
    ).toEqual([]);
  });

  test('the dictionary has no duplicate keys', async () => {
    // TS1117 catches duplicates at build time; this asserts the file still parses
    // as a dictionary rather than something else.
    const declared = declaredKeys();
    const dict = readFileSync(DICT, 'utf8');
    const re = /^\s{2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*))\s*:/gm;
    const total = [...dict.matchAll(re)].length;
    expect(total).toBe(declared.size);
  });

  test('interpolation placeholders are preserved in every translation', async () => {
    const src = readFileSync(DICT, 'utf8');
    const re = /^\s{2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*))\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gm;
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

    const mismatched: string[] = [];
    for (const m of src.matchAll(re)) {
      const key = m[1] ?? m[2] ?? m[3]!;
      const value = m[4] ?? m[5]!;
      const a = placeholders(key).join(',');
      const b = placeholders(value).join(',');
      if (a !== b) mismatched.push(`${key}: expected {${a}}, got {${b}}`);
    }

    expect(mismatched, `mismatched placeholders:\n${mismatched.join('\n')}`).toEqual([]);
  });
});