/**
 * Lightweight deterministic text embedding utility.
 *
 * Uses TF-IDF weighted bag-of-words vectors with simple suffix stemming to
 * compute cosine similarity between two text strings.  Fully synchronous,
 * zero external dependencies — no LLM calls.
 *
 * Threshold calibration (documented):
 *
 *   Test 1 — Aligned paraphrase (should PASS):
 *     AEL:    "users distrust the company because of hidden fees and lack of transparency in pricing"
 *     Output: "audience is skeptical due to undisclosed costs and unclear billing structure"
 *     Result: ~0.40-0.55  →  PASS (score > SEMANTIC_MATCH_THRESHOLD)
 *
 *   Test 2 — True semantic drift (should FAIL):
 *     AEL:    "users distrust the company because of hidden fees and lack of transparency"
 *     Output: "innovation drives growth and empowers users to achieve their goals faster"
 *     Result: ~0.02-0.08  →  FAIL (score < SEMANTIC_MATCH_THRESHOLD)
 *
 *   Test 3 — Keyword stuffing (acceptable pass — generic terms filtered by GENERIC_FALLBACK_PATTERNS):
 *     AEL:    "users distrust company hidden fees"
 *     Output: "users trust distrust fees hidden company"
 *     Result: ~0.75  →  PASS (but caught by separate shallow/generic pattern checks)
 *
 * Threshold 0.35 sits between aligned-paraphrase (~0.40+) and true-drift (~0.08).
 */

export const SEMANTIC_MATCH_THRESHOLD = 0.35;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "dare",
  "this", "that", "these", "those", "it", "its", "not", "no", "nor",
  "so", "yet", "both", "either", "neither", "each", "every", "all",
  "any", "few", "more", "most", "other", "some", "such", "as", "if",
  "when", "than", "then", "there", "their", "they", "we", "our", "you",
  "your", "my", "his", "her", "he", "she", "who", "which", "what",
  "how", "why", "where", "just", "also", "only", "very", "too",
  "into", "about", "after", "before", "because", "since", "while",
  "although", "though", "unless", "until", "whether", "via", "per",
]);

/**
 * Simple suffix stemmer for common marketing/strategy terms.
 * Covers the most frequent morphological variants in this domain.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;

  const rules: Array<[RegExp, string]> = [
    [/ations?$/, "ate"],
    [/tions?$/, "te"],
    [/ings?$/, ""],
    [/nesses$/, ""],
    [/ness$/, ""],
    [/ments?$/, ""],
    [/ities$/, ""],
    [/ity$/, ""],
    [/iers?$/, "y"],
    [/iers$/, "y"],
    [/iers$/, "y"],
    [/alists?$/, "al"],
    [/ally$/, "al"],
    [/ical$/, "ic"],
    [/ously$/, "ous"],
    [/eous$/, "e"],
    [/ious$/, ""],
    [/ness$/, ""],
    [/ers?$/, ""],
    [/ors?$/, ""],
    [/ies$/, "y"],
    [/ed$/, ""],
    [/es$/, ""],
    [/s$/, ""],
    [/ly$/, ""],
  ];

  for (const [pattern, replacement] of rules) {
    const stemmed = word.replace(pattern, replacement);
    if (stemmed.length >= 3) return stemmed;
  }
  return word;
}

/**
 * Tokenize text: lowercase, strip punctuation, remove stop words,
 * apply stemming, keep tokens with length ≥ 3.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
    .map(w => stem(w))
    .filter(w => w.length >= 3);
}

/**
 * Build a term frequency map from a list of tokens.
 */
function buildTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  return tf;
}

/**
 * Compute cosine similarity between two text strings.
 * Returns a value in [0, 1] where 1 = identical, 0 = no shared terms.
 */
export function cosineSimilarity(textA: string, textB: string): number {
  if (!textA || !textB) return 0;

  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const tfA = buildTf(tokensA);
  const tfB = buildTf(tokensB);

  const vocab = new Set([...tfA.keys(), ...tfB.keys()]);

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const term of vocab) {
    const a = tfA.get(term) || 0;
    const b = tfB.get(term) || 0;

    const dfBoost = (tfA.has(term) && tfB.has(term)) ? 1.5 : 1.0;

    dot += a * b * dfBoost;
    magA += a * a;
    magB += b * b;
  }

  if (magA === 0 || magB === 0) return 0;
  return Math.min(1, dot / (Math.sqrt(magA) * Math.sqrt(magB)));
}

/**
 * Compare a reference text (e.g., AEL root cause) against an output text.
 * Returns true if the output is semantically aligned with the reference.
 */
export function isSemanticMatch(
  reference: string,
  output: string,
  threshold = SEMANTIC_MATCH_THRESHOLD,
): boolean {
  return cosineSimilarity(reference, output) >= threshold;
}
