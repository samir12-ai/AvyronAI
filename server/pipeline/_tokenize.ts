/**
 * Phase 6 — Tokenizer for cluster theme extraction.
 *
 * Locked by Samir 2026-04-20 §6.6: TRANSCRIBED from
 * server/market-intelligence-v3/narrative-clustering.ts (lines ~3-60) so the
 * pipeline overlay does NOT depend on the MIv3 stable engine. Drift here will
 * NOT affect MIv3 and vice versa — that's intentional.
 *
 * If MIv3 evolves its tokenization, that's a Phase 7+ alignment decision; do
 * not import from MIv3 to "stay in sync."
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "such", "no", "only", "own", "same", "than",
  "too", "very", "just", "because", "if", "when", "while", "it",
  "its", "this", "that", "these", "those", "i", "me", "my", "we",
  "our", "you", "your", "he", "she", "they", "them", "their", "his", "her",
]);

const SYNONYM_GROUPS: string[][] = [
  ["grow", "growth", "scale", "scaling", "expand", "expansion"],
  ["fast", "faster", "quick", "quickly", "rapid", "rapidly", "speed"],
  ["revenue", "income", "profit", "earnings", "money", "sales"],
  ["business", "company", "brand", "enterprise"],
  ["increase", "boost", "raise", "improve", "elevate", "amplify"],
  ["client", "customer", "buyer", "consumer", "audience"],
  ["strategy", "plan", "approach", "method", "framework", "system"],
  ["result", "results", "outcome", "outcomes", "impact"],
  ["content", "post", "posts", "publishing", "media"],
  ["engage", "engagement", "interact", "interaction"],
  ["lead", "leads", "prospect", "prospects", "pipeline"],
  ["convert", "conversion", "conversions", "transform"],
  ["authority", "expert", "expertise", "credibility", "trust"],
  ["social", "online", "digital", "internet"],
  ["free", "complimentary", "no-cost", "gratis"],
  ["premium", "exclusive", "luxury", "high-end"],
  ["easy", "simple", "effortless", "straightforward"],
  ["proven", "tested", "validated", "verified"],
];

const synonymMap = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0];
  for (const word of group) {
    synonymMap.set(word.toLowerCase(), canonical);
  }
}

const MIN_TOKEN_LENGTH = 3;

export function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(t));
}

export function normalize(token: string): string {
  return synonymMap.get(token) || token;
}

/** Normalize-then-dedupe a list of tokens (preserves first-seen order). */
export function canonicalTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokenize(text)) {
    const c = normalize(tok);
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}
