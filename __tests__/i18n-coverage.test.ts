import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSLATIONS_DIR = resolve(__dirname, '../lib/translations');
const PRIORITY = new Set(['en', 'es', 'fr', 'de', 'pt', 'ar']);

// Namespaces in scope for the beta-UX i18n pass (frontend-copy audit 2026-05).
// Priority languages MUST have full coverage for these. Other namespaces
// (e.g. `videoEditor`) have pre-existing gaps tracked as follow-up — they are
// reported as INFO but do not fail the suite.
const IN_SCOPE_NAMESPACES = new Set([
  'intro',
  'loginPage',
  'upgrade',
  'agent',
  'notFound',
  'trust',
  'planStatus',
  'narrative',
  'errors',
]);

function collectKeys(obj: any, prefix = ''): string[] {
  const keys: string[] = [];
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

function isInScope(key: string): boolean {
  return IN_SCOPE_NAMESPACES.has(key.split('.')[0]);
}

async function loadLocale(code: string) {
  const mod = await import(`../lib/translations/${code}`);
  return mod.default ?? mod[code] ?? mod;
}

describe('i18n coverage', () => {
  it('priority languages have all in-scope keys; other gaps are reported as INFO', async () => {
    const en = await loadLocale('en');
    const baseKeys = collectKeys(en);
    const files = readdirSync(TRANSLATIONS_DIR)
      .filter(f => f.endsWith('.ts') && f !== 'en.ts')
      .map(f => f.replace(/\.ts$/, ''));

    const priorityInScopeMisses: Record<string, string[]> = {};
    const priorityOutOfScopeInfo: Record<string, number> = {};
    const otherInfo: Record<string, number> = {};

    for (const code of files) {
      const locale = await loadLocale(code);
      const keys = new Set(collectKeys(locale));
      const missing = baseKeys.filter(k => !keys.has(k));
      if (PRIORITY.has(code)) {
        priorityInScopeMisses[code] = missing.filter(isInScope);
        priorityOutOfScopeInfo[code] = missing.length - priorityInScopeMisses[code].length;
      } else {
        otherInfo[code] = missing.length;
      }
    }

    // Pre-existing out-of-scope gaps in priority languages.
    for (const [code, count] of Object.entries(priorityOutOfScopeInfo)) {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.log(`[i18n INFO] priority "${code}" has ${count} pre-existing out-of-scope keys missing (tracked as follow-up).`);
      }
    }
    // Non-priority languages fall back to en.
    for (const [code, count] of Object.entries(otherInfo)) {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.log(`[i18n INFO] ${code} missing ${count} keys (falls back to en).`);
      }
    }

    // Strict: priority languages MUST cover every in-scope key.
    for (const [code, missing] of Object.entries(priorityInScopeMisses)) {
      expect(
        missing,
        `priority language "${code}" is missing in-scope keys: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? `... (+${missing.length - 10} more)` : ''}`
      ).toEqual([]);
    }
  });
});
