/**
 * Deterministic semantic similarity utility using concept canonicalization.
 *
 * Algorithm:
 *   1. Tokenize text (lowercase, strip punctuation, remove stop words)
 *   2. Map each token to a canonical concept ID using CONCEPT_MAP
 *      (covers ~200 word forms across 13 marketing/strategy concept clusters)
 *   3. Tokens not in CONCEPT_MAP are kept as-is after basic suffix stripping
 *   4. Compute cosine similarity on the resulting concept-token TF vectors
 *
 * This handles synonym substitution in paraphrases:
 *   - "distrust" and "skeptical" both map to CONCEPT_trust
 *   - "hidden fees" and "undisclosed costs" both map to CONCEPT_transparency + CONCEPT_cost
 *
 * Calibrated test cases (verified with actual implementation):
 *
 *   Test 1 — Aligned paraphrase (MUST PASS, score > threshold):
 *     AEL:    "users distrust the company because of hidden fees and lack of transparency in pricing"
 *     Output: "audience is skeptical due to undisclosed costs and unclear billing structure"
 *     Shared concepts: CONCEPT_audience, CONCEPT_trust, CONCEPT_transparency (×2), CONCEPT_cost (×2)
 *     Result: 0.870  →  PASS (score >> SEMANTIC_MATCH_THRESHOLD = 0.35)
 *
 *   Test 2 — True semantic drift (MUST FAIL, score < threshold):
 *     AEL:    "users distrust the company because of hidden fees and lack of transparency"
 *     Output: "innovation drives growth and empowers users to achieve their goals faster"
 *     Shared concepts: only CONCEPT_audience (both contain "users")
 *     Result: 0.118  →  FAIL (score < SEMANTIC_MATCH_THRESHOLD = 0.35)
 *
 *   Test 3 — Keyword stuffing (acceptable pass; structural incoherence caught separately
 *             by GENERIC_FALLBACK_PATTERNS + SHALLOW_OUTPUT_PATTERNS in CEL):
 *     AEL:    "users distrust hidden fees"
 *     Output: "trust distrust fees hidden users transparency company"
 *     Result: ~0.91  →  PASS (bag-of-words cosine cannot penalize word-order violations
 *             without a parser; LLM engine outputs are grammatically structured in practice)
 *
 * Threshold 0.35 sits between paraphrase (~0.87) and true drift (~0.14).
 */

export const SEMANTIC_MATCH_THRESHOLD = 0.35;

// ─────────────────────────────────────────────────────────────────────────────
// Concept cluster IDs (13 clusters covering marketing/strategy vocabulary)
// ─────────────────────────────────────────────────────────────────────────────
const C_TRUST        = "CONCEPT_trust";
const C_COST         = "CONCEPT_cost";
const C_TRANSPARENCY = "CONCEPT_transparency";
const C_RISK         = "CONCEPT_risk";
const C_PROBLEM      = "CONCEPT_problem";
const C_AUDIENCE     = "CONCEPT_audience";
const C_CONVERSION   = "CONCEPT_conversion";
const C_VALUE        = "CONCEPT_value";
const C_CAUSE        = "CONCEPT_cause";
const C_ABSENCE      = "CONCEPT_absence";
const C_PERCEPTION   = "CONCEPT_perception";
const C_EVIDENCE     = "CONCEPT_evidence";
const C_BEHAVIOR     = "CONCEPT_behavior";

/**
 * Maps ~220 word forms to canonical concept IDs.
 * Covers the most frequent synonyms and morphological variants in this domain.
 * Keys are lowercase words (look-up happens before stemming for exact matches,
 * and after suffix stripping for morphological variants).
 */
const CONCEPT_MAP: Record<string, string> = {
  // ── Trust / Credibility ───────────────────────────────────────────────────
  trust: C_TRUST, trusting: C_TRUST, trusted: C_TRUST, trustworthy: C_TRUST,
  distrust: C_TRUST, distrusts: C_TRUST, distrusted: C_TRUST, distrusting: C_TRUST,
  mistrust: C_TRUST, mistrusts: C_TRUST, mistrusted: C_TRUST,
  skeptical: C_TRUST, skeptic: C_TRUST, skepticism: C_TRUST, skeptics: C_TRUST,
  sceptical: C_TRUST, sceptic: C_TRUST, scepticism: C_TRUST,
  doubt: C_TRUST, doubts: C_TRUST, doubtful: C_TRUST, doubted: C_TRUST,
  credibility: C_TRUST, credible: C_TRUST, incredible: C_TRUST,
  reliability: C_TRUST, reliable: C_TRUST, unreliable: C_TRUST,
  confidence: C_TRUST, confident: C_TRUST, unconfident: C_TRUST,
  authentic: C_TRUST, authenticity: C_TRUST, inauthentic: C_TRUST,
  legitimate: C_TRUST, legitimacy: C_TRUST, illegitimate: C_TRUST,
  verify: C_TRUST, verified: C_TRUST, verifiable: C_TRUST, verification: C_TRUST,
  proof: C_TRUST, proven: C_TRUST, prove: C_TRUST, proving: C_TRUST,
  uncertain: C_TRUST, uncertainty: C_TRUST, unsure: C_TRUST,
  hesitant: C_TRUST, hesitate: C_TRUST, hesitation: C_TRUST, hesitating: C_TRUST,
  wary: C_TRUST, wariness: C_TRUST,
  suspicious: C_TRUST, suspicion: C_TRUST, suspect: C_TRUST,
  apprehensive: C_TRUST, apprehension: C_TRUST,
  cautious: C_TRUST, caution: C_TRUST,

  // ── Cost / Financial ──────────────────────────────────────────────────────
  cost: C_COST, costs: C_COST, costly: C_COST,
  fee: C_COST, fees: C_COST,
  price: C_COST, prices: C_COST, pricing: C_COST, priced: C_COST,
  expense: C_COST, expenses: C_COST, expensive: C_COST, inexpensive: C_COST,
  billing: C_COST, billed: C_COST, bill: C_COST, bills: C_COST,
  charge: C_COST, charges: C_COST, charged: C_COST, charging: C_COST,
  payment: C_COST, payments: C_COST, pay: C_COST, paying: C_COST, paid: C_COST,
  financial: C_COST, financially: C_COST, finance: C_COST, finances: C_COST,
  money: C_COST, monetary: C_COST, funds: C_COST, fund: C_COST,
  budget: C_COST, budgetary: C_COST, budgeting: C_COST,
  affordable: C_COST, affordability: C_COST, afford: C_COST,
  costly: C_COST, pricey: C_COST,
  subscription: C_COST, subscriptions: C_COST,
  invoice: C_COST, invoiced: C_COST, invoices: C_COST,

  // ── Transparency / Visibility ─────────────────────────────────────────────
  transparent: C_TRANSPARENCY, transparency: C_TRANSPARENCY,
  opaque: C_TRANSPARENCY, opacity: C_TRANSPARENCY, opaqueness: C_TRANSPARENCY,
  hidden: C_TRANSPARENCY, hiding: C_TRANSPARENCY, hide: C_TRANSPARENCY,
  undisclosed: C_TRANSPARENCY, undisclosed: C_TRANSPARENCY,
  concealed: C_TRANSPARENCY, conceal: C_TRANSPARENCY, conceals: C_TRANSPARENCY,
  obscure: C_TRANSPARENCY, obscured: C_TRANSPARENCY, obscuring: C_TRANSPARENCY,
  visible: C_TRANSPARENCY, visibility: C_TRANSPARENCY, invisible: C_TRANSPARENCY,
  clear: C_TRANSPARENCY, clarity: C_TRANSPARENCY, clearly: C_TRANSPARENCY,
  unclear: C_TRANSPARENCY, clarify: C_TRANSPARENCY,
  disclose: C_TRANSPARENCY, disclosed: C_TRANSPARENCY, disclosure: C_TRANSPARENCY,
  honest: C_TRANSPARENCY, honesty: C_TRANSPARENCY, dishonest: C_TRANSPARENCY,
  deceptive: C_TRANSPARENCY, deceive: C_TRANSPARENCY, deception: C_TRANSPARENCY,
  mislead: C_TRANSPARENCY, misleading: C_TRANSPARENCY, misleads: C_TRANSPARENCY,
  vague: C_TRANSPARENCY, vagueness: C_TRANSPARENCY,
  ambiguous: C_TRANSPARENCY, ambiguity: C_TRANSPARENCY,
  buried: C_TRANSPARENCY, bury: C_TRANSPARENCY,

  // ── Risk / Safety ─────────────────────────────────────────────────────────
  risk: C_RISK, risks: C_RISK, risky: C_RISK, risking: C_RISK, riskier: C_RISK,
  danger: C_RISK, dangerous: C_RISK, dangerously: C_RISK,
  safe: C_RISK, safely: C_RISK, safety: C_RISK, safeguard: C_RISK,
  secure: C_RISK, security: C_RISK, insecure: C_RISK, insecurity: C_RISK,
  vulnerable: C_RISK, vulnerability: C_RISK, vulnerabilities: C_RISK,
  exposed: C_RISK, exposure: C_RISK, expose: C_RISK,
  protect: C_RISK, protection: C_RISK, protected: C_RISK,
  loss: C_RISK, losses: C_RISK, lose: C_RISK, losing: C_RISK, lost: C_RISK,
  threat: C_RISK, threatened: C_RISK, threatening: C_RISK,
  gamble: C_RISK, gambling: C_RISK, gambled: C_RISK,

  // ── Pain / Problem / Challenge ────────────────────────────────────────────
  pain: C_PROBLEM, pains: C_PROBLEM, painful: C_PROBLEM,
  problem: C_PROBLEM, problems: C_PROBLEM, problematic: C_PROBLEM,
  issue: C_PROBLEM, issues: C_PROBLEM,
  challenge: C_PROBLEM, challenges: C_PROBLEM, challenging: C_PROBLEM,
  barrier: C_PROBLEM, barriers: C_PROBLEM,
  obstacle: C_PROBLEM, obstacles: C_PROBLEM,
  hurdle: C_PROBLEM, hurdles: C_PROBLEM,
  friction: C_PROBLEM, frictional: C_PROBLEM,
  difficulty: C_PROBLEM, difficult: C_PROBLEM, difficulties: C_PROBLEM,
  struggle: C_PROBLEM, struggles: C_PROBLEM, struggling: C_PROBLEM,
  frustrate: C_PROBLEM, frustrated: C_PROBLEM, frustrating: C_PROBLEM, frustration: C_PROBLEM,
  concern: C_PROBLEM, concerns: C_PROBLEM, concerned: C_PROBLEM, concerning: C_PROBLEM,
  worry: C_PROBLEM, worried: C_PROBLEM, worrying: C_PROBLEM, worries: C_PROBLEM,
  fear: C_PROBLEM, fears: C_PROBLEM, feared: C_PROBLEM, fearing: C_PROBLEM, fearful: C_PROBLEM,
  afraid: C_PROBLEM, anxious: C_PROBLEM, anxiety: C_PROBLEM,
  reluctant: C_PROBLEM, reluctance: C_PROBLEM, reluctantly: C_PROBLEM,
  resist: C_PROBLEM, resistance: C_PROBLEM, resistant: C_PROBLEM, resisting: C_PROBLEM,
  objection: C_PROBLEM, objections: C_PROBLEM, object: C_PROBLEM,

  // ── Audience / User ───────────────────────────────────────────────────────
  user: C_AUDIENCE, users: C_AUDIENCE,
  audience: C_AUDIENCE, audiences: C_AUDIENCE,
  customer: C_AUDIENCE, customers: C_AUDIENCE,
  client: C_AUDIENCE, clients: C_AUDIENCE,
  prospect: C_AUDIENCE, prospects: C_AUDIENCE,
  buyer: C_AUDIENCE, buyers: C_AUDIENCE, buying: C_AUDIENCE,
  consumer: C_AUDIENCE, consumers: C_AUDIENCE,
  person: C_AUDIENCE, people: C_AUDIENCE,
  visitor: C_AUDIENCE, visitors: C_AUDIENCE,
  lead: C_AUDIENCE, leads: C_AUDIENCE,
  subscriber: C_AUDIENCE, subscribers: C_AUDIENCE,

  // ── Conversion / Purchase Action ──────────────────────────────────────────
  buy: C_CONVERSION, buys: C_CONVERSION, bought: C_CONVERSION,
  purchase: C_CONVERSION, purchases: C_CONVERSION, purchased: C_CONVERSION,
  convert: C_CONVERSION, converts: C_CONVERSION, converted: C_CONVERSION, conversion: C_CONVERSION,
  commit: C_CONVERSION, commits: C_CONVERSION, committed: C_CONVERSION, commitment: C_CONVERSION,
  decide: C_CONVERSION, decides: C_CONVERSION, decided: C_CONVERSION, decision: C_CONVERSION,
  choose: C_CONVERSION, chosen: C_CONVERSION, chose: C_CONVERSION, choice: C_CONVERSION,
  select: C_CONVERSION, selects: C_CONVERSION, selected: C_CONVERSION, selection: C_CONVERSION,
  signup: C_CONVERSION, enroll: C_CONVERSION, enrolled: C_CONVERSION, enrollment: C_CONVERSION,
  action: C_CONVERSION, click: C_CONVERSION, clicked: C_CONVERSION,

  // ── Value / Benefit ───────────────────────────────────────────────────────
  value: C_VALUE, values: C_VALUE, valued: C_VALUE, valuable: C_VALUE,
  benefit: C_VALUE, benefits: C_VALUE, beneficial: C_VALUE,
  advantage: C_VALUE, advantages: C_VALUE, advantageous: C_VALUE,
  solution: C_VALUE, solutions: C_VALUE, solve: C_VALUE, solved: C_VALUE, solves: C_VALUE,
  result: C_VALUE, results: C_VALUE, resulting: C_VALUE,
  outcome: C_VALUE, outcomes: C_VALUE,
  roi: C_VALUE, return: C_VALUE, returns: C_VALUE, returning: C_VALUE,
  worth: C_VALUE, worthwhile: C_VALUE, worthless: C_VALUE,
  reward: C_VALUE, rewards: C_VALUE, rewarding: C_VALUE,

  // ── Causal Reasoning ─────────────────────────────────────────────────────
  // Excludes generic connectors (because, drives, driver) — they are too
  // high-frequency across unrelated texts and inflate drift scores as noise.
  cause: C_CAUSE, causes: C_CAUSE, caused: C_CAUSE, causing: C_CAUSE, causal: C_CAUSE,
  reason: C_CAUSE, reasons: C_CAUSE, reasoning: C_CAUSE,
  root: C_CAUSE, underlying: C_CAUSE,
  stem: C_CAUSE, stems: C_CAUSE,
  originate: C_CAUSE, origin: C_CAUSE,
  mechanism: C_CAUSE, mechanisms: C_CAUSE,
  trigger: C_CAUSE, triggers: C_CAUSE, triggered: C_CAUSE,

  // ── Absence / Gap ─────────────────────────────────────────────────────────
  lack: C_ABSENCE, lacking: C_ABSENCE, lacks: C_ABSENCE,
  absent: C_ABSENCE, absence: C_ABSENCE,
  missing: C_ABSENCE, miss: C_ABSENCE, missed: C_ABSENCE,
  gap: C_ABSENCE, gaps: C_ABSENCE,
  insufficient: C_ABSENCE, insufficiency: C_ABSENCE,
  deficient: C_ABSENCE, deficiency: C_ABSENCE, deficit: C_ABSENCE,
  void: C_ABSENCE, empty: C_ABSENCE, emptiness: C_ABSENCE,
  unfulfilled: C_ABSENCE, unmet: C_ABSENCE,

  // ── Perception / Belief ───────────────────────────────────────────────────
  perceive: C_PERCEPTION, perceives: C_PERCEPTION, perceived: C_PERCEPTION, perception: C_PERCEPTION,
  believe: C_PERCEPTION, believes: C_PERCEPTION, believed: C_PERCEPTION, belief: C_PERCEPTION,
  think: C_PERCEPTION, thinks: C_PERCEPTION, thought: C_PERCEPTION, thinking: C_PERCEPTION,
  feel: C_PERCEPTION, feels: C_PERCEPTION, feeling: C_PERCEPTION, felt: C_PERCEPTION,
  assume: C_PERCEPTION, assumes: C_PERCEPTION, assumed: C_PERCEPTION, assumption: C_PERCEPTION,
  expect: C_PERCEPTION, expects: C_PERCEPTION, expected: C_PERCEPTION, expectation: C_PERCEPTION,
  opinion: C_PERCEPTION, opinions: C_PERCEPTION,
  attitude: C_PERCEPTION, attitudes: C_PERCEPTION,
  mindset: C_PERCEPTION, mindsets: C_PERCEPTION,
  impression: C_PERCEPTION, impressions: C_PERCEPTION,

  // ── Evidence / Proof ─────────────────────────────────────────────────────
  evidence: C_EVIDENCE, evidenced: C_EVIDENCE,
  data: C_EVIDENCE, dataset: C_EVIDENCE,
  statistic: C_EVIDENCE, statistics: C_EVIDENCE, statistical: C_EVIDENCE,
  testimonial: C_EVIDENCE, testimonials: C_EVIDENCE,
  review: C_EVIDENCE, reviews: C_EVIDENCE, reviewed: C_EVIDENCE,
  case: C_EVIDENCE, cases: C_EVIDENCE, case_study: C_EVIDENCE,
  study: C_EVIDENCE, studies: C_EVIDENCE,
  record: C_EVIDENCE, records: C_EVIDENCE, recorded: C_EVIDENCE,
  track: C_EVIDENCE, tracked: C_EVIDENCE,

  // ── Behavior / Psychological Impact ───────────────────────────────────────
  behavior: C_BEHAVIOR, behaviors: C_BEHAVIOR, behavioral: C_BEHAVIOR, behaviour: C_BEHAVIOR,
  psychological: C_BEHAVIOR, psychology: C_BEHAVIOR,
  cognitive: C_BEHAVIOR, cognition: C_BEHAVIOR,
  emotional: C_BEHAVIOR, emotion: C_BEHAVIOR, emotions: C_BEHAVIOR,
  habit: C_BEHAVIOR, habits: C_BEHAVIOR, habitual: C_BEHAVIOR,
  pattern: C_BEHAVIOR, patterns: C_BEHAVIOR, patterned: C_BEHAVIOR,
  response: C_BEHAVIOR, respond: C_BEHAVIOR, responds: C_BEHAVIOR, responded: C_BEHAVIOR,
  reaction: C_BEHAVIOR, react: C_BEHAVIOR,
};

// ─────────────────────────────────────────────────────────────────────────────
// Stop words (excluded from tokenization entirely)
// ─────────────────────────────────────────────────────────────────────────────
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
  "into", "about", "after", "before", "since", "while", "because",
  "although", "though", "unless", "until", "whether", "via", "per",
  "due", "even", "up", "down", "out", "over", "under", "through",
  "without", "within", "between", "among", "across",
  "well", "much", "many", "often", "always", "never", "still",
  "already", "now", "then", "here", "there", "new", "old", "same",
  "high", "low", "long", "short", "large", "small", "big",
]);

/**
 * Strip a simple inflection suffix so that common morphological variants
 * collapse to the same base form when the word isn't in CONCEPT_MAP.
 * This is intentionally narrow — the CONCEPT_MAP handles semantic synonyms.
 */
function stripSuffix(word: string): string {
  if (word.length <= 4) return word;

  const rules: Array<[RegExp, string]> = [
    [/ations?$/, "ate"],
    [/tions?$/, "te"],
    [/nesses$/, ""],
    [/ness$/, ""],
    [/ments?$/, ""],
    [/ities$/, ""],
    [/ity$/, ""],
    [/ally$/, "al"],
    [/ical$/, "ic"],
    [/ously$/, "ous"],
    [/ings?$/, ""],
    [/ers?$/, ""],
    [/ors?$/, ""],
    [/ies$/, "y"],
    [/ed$/, ""],
    [/es$/, ""],
    [/s$/, ""],
    [/ly$/, ""],
  ];

  for (const [pattern, replacement] of rules) {
    const result = word.replace(pattern, replacement);
    if (result.length >= 3 && result !== word) return result;
  }
  return word;
}

/**
 * Tokenize text into canonical concept IDs (or stripped base forms).
 *
 * Pipeline:
 *   1. Lowercase and strip non-alphabetic characters
 *   2. Split on whitespace, filter stop words and length < 3
 *   3. Look up the original word in CONCEPT_MAP → use concept ID if found
 *   4. Otherwise strip suffix and look up again → use concept ID if found
 *   5. Otherwise keep the suffix-stripped form
 */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

  return words.map(word => {
    if (CONCEPT_MAP[word]) return CONCEPT_MAP[word];
    const stripped = stripSuffix(word);
    if (CONCEPT_MAP[stripped]) return CONCEPT_MAP[stripped];
    return stripped;
  });
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
 * Compute cosine similarity between two text strings using concept canonicalization.
 * Returns a value in [0, 1] where 1 = identical concept profile, 0 = no shared concepts.
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
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Returns true if the engine output is semantically aligned with the reference text.
 * Used by CEL enforceEngineDepthCompliance and SIV alignment validation.
 */
export function isSemanticMatch(
  reference: string,
  output: string,
  threshold = SEMANTIC_MATCH_THRESHOLD,
): boolean {
  return cosineSimilarity(reference, output) >= threshold;
}
