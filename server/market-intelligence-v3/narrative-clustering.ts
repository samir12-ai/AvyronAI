import { MI_NARRATIVE_CLUSTERING } from "./constants";

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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= MI_NARRATIVE_CLUSTERING.MIN_TOKEN_LENGTH && !STOP_WORDS.has(t));
}

function normalize(token: string): string {
  return synonymMap.get(token) || token;
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map(normalize));
  const setB = new Set(b.map(normalize));
  const intersection = [...setA].filter(t => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface NarrativeCluster {
  canonical: string;
  members: string[];
  size: number;
}

export function clusterNarratives(narratives: string[]): NarrativeCluster[] {
  if (narratives.length === 0) return [];

  const tokenized = narratives.map(n => ({ text: n, tokens: tokenize(n) }));
  const clusters: NarrativeCluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < tokenized.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: NarrativeCluster = {
      canonical: tokenized[i].text,
      members: [tokenized[i].text],
      size: 1,
    };
    assigned.add(i);

    for (let j = i + 1; j < tokenized.length; j++) {
      if (assigned.has(j)) continue;

      const overlap = tokenOverlap(tokenized[i].tokens, tokenized[j].tokens);
      if (overlap >= MI_NARRATIVE_CLUSTERING.TOKEN_OVERLAP_THRESHOLD) {
        cluster.members.push(tokenized[j].text);
        cluster.size++;
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

export function computeClusteredSaturation(
  narrativeSaturation: Record<string, number>,
): Record<string, number> {
  const keys = Object.keys(narrativeSaturation);
  if (keys.length === 0) return narrativeSaturation;

  const clusters = clusterNarratives(keys);
  const result: Record<string, number> = {};

  for (const cluster of clusters) {
    const maxSaturation = Math.max(...cluster.members.map(m => narrativeSaturation[m] || 0));
    const avgSaturation = cluster.members.reduce((s, m) => s + (narrativeSaturation[m] || 0), 0) / cluster.members.length;
    const clusterSaturation = maxSaturation * 0.7 + avgSaturation * 0.3;

    for (const member of cluster.members) {
      result[member] = Math.round(Math.max(narrativeSaturation[member] || 0, clusterSaturation) * 100) / 100;
    }
  }

  return result;
}
