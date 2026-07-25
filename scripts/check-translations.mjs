#!/usr/bin/env -S npx tsx
// Walks `lib/translations/en.ts` keys recursively and asserts the same keys
// exist in every other language file. Reports missing keys per language.
// Priority languages (en, es, fr, de, pt, ar) → missing keys FAIL.
// Other supported languages → missing keys INFO only (fallback to en).
//
// Run with: npx tsx scripts/check-translations.mjs

import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_DIR = resolve(__dirname, '../lib/translations');
const PRIORITY = new Set(['en', 'es', 'fr', 'de', 'pt', 'ar']);
// In-scope namespaces for the beta-UX i18n pass (frontend-copy audit 2026-05).
// Priority languages MUST cover these. Out-of-scope namespaces (e.g.
// `videoEditor`) have pre-existing gaps tracked as follow-up; they are
// surfaced as INFO and do not fail the script.
const IN_SCOPE_NAMESPACES = new Set([
  'intro', 'loginPage', 'upgrade', 'agent', 'notFound',
  'trust', 'planStatus', 'narrative', 'errors',
]);
const isInScope = (key) => IN_SCOPE_NAMESPACES.has(key.split('.')[0]);

async function loadLocale(code) {
  const path = resolve(TRANSLATIONS_DIR, `${code}.ts`);
  const mod = await import(pathToFileURL(path).href);
  return mod.default ?? mod[code] ?? mod;
}

function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function diffKeys(baseKeys, otherKeys) {
  const otherSet = new Set(otherKeys);
  return baseKeys.filter(k => !otherSet.has(k));
}

export async function runCheck() {
  const en = await loadLocale('en');
  const baseKeys = collectKeys(en);
  const files = readdirSync(TRANSLATIONS_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'en.ts')
    .map(f => f.replace(/\.ts$/, ''));

  const results = { priority: {}, other: {}, totalEn: baseKeys.length };
  for (const code of files) {
    let missing = [];
    try {
      const locale = await loadLocale(code);
      missing = diffKeys(baseKeys, collectKeys(locale));
    } catch (err) {
      missing = [`__load_error__: ${err.message}`];
    }
    if (PRIORITY.has(code)) {
      results.priority[code] = missing;
    } else {
      results.other[code] = missing;
    }
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runCheck();
  console.log(`Source en.ts: ${r.totalEn} keys.\n`);
  let failed = false;
  console.log('Priority languages:');
  for (const [code, missing] of Object.entries(r.priority)) {
    const inScope = missing.filter(isInScope);
    const outOfScope = missing.filter(k => !isInScope(k));
    if (inScope.length === 0) {
      const tail = outOfScope.length
        ? ` (· ${outOfScope.length} out-of-scope missing — INFO only)`
        : '';
      console.log(`  ✓ ${code} — in-scope complete${tail}`);
    } else {
      failed = true;
      console.log(`  ✗ ${code} — ${inScope.length} in-scope missing keys:`);
      for (const k of inScope.slice(0, 20)) console.log(`      ${k}`);
      if (inScope.length > 20) console.log(`      ... and ${inScope.length - 20} more`);
      if (outOfScope.length) {
        console.log(`      · plus ${outOfScope.length} out-of-scope missing (INFO only)`);
      }
    }
  }
  console.log('\nOther languages (fallback to en):');
  for (const [code, missing] of Object.entries(r.other)) {
    console.log(`  · ${code} — ${missing.length} missing (uses en fallback)`);
  }
  process.exit(failed ? 1 : 0);
}
