import * as fs from 'fs';

const dump = JSON.parse(fs.readFileSync('scripts/target_run_dump.json', 'utf8'));

const billingTerms = [
  'billing',
  'refund',
  'cancellation',
  'cancel',
  'pricing distrust',
  'predatory pricing',
  'customer service',
  'support issue',
  'payment',
  'hidden fees',
  'unauthorized charges'
];

function searchObj(obj: any, path: string, results: any[]) {
  if (!obj) return;
  if (typeof obj === 'string') {
    const lower = obj.toLowerCase();
    for (const term of billingTerms) {
      if (lower.includes(term)) {
        results.push({
          path,
          term,
          snippet: obj.length > 200 ? obj.substring(0, 200) + '...' : obj
        });
        break;
      }
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => searchObj(item, `${path}[${idx}]`, results));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      searchObj(v, `${path}.${k}`, results);
    }
  }
}

console.log("=== SCANNING FOR BILLING / STRANGE OUTPUT IN TARGET RUN ===");

for (const [snapName, snapData] of Object.entries(dump)) {
  const matches: any[] = [];
  searchObj(snapData, snapName, matches);
  console.log(`\n--- ${snapName} (${matches.length} matches) ---`);
  for (const m of matches.slice(0, 8)) {
    console.log(`[${m.term}] at ${m.path}:`);
    console.log(`  "${m.snippet}"`);
  }
  if (matches.length > 8) {
    console.log(`  ... and ${matches.length - 8} more occurrences.`);
  }
}
