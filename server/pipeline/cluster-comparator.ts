/**
 * Phase 6 — Cluster comparator.
 *
 * Locked by Samir 2026-04-20 (rev 2):
 *   - Compare current window's cluster signature against the most recent
 *     prior cluster under the SAME dna_id (baseline retrieved by caller).
 *   - "Theme set" = the set of theme_token strings.
 *   - themesShifted = themes in BOTH sets where |currentShare − baselineShare| ≥ 0.20
 *     (20 percentage points, §6.11).
 *   - Verdict precedence (first match wins):
 *       1. baseline missing                          → no_baseline
 *       2. added>0 AND removed>0                     → clusters_unstable
 *       3. added>0                                   → new_clusters
 *       4. removed>0                                 → clusters_disappeared
 *       5. shifted>0                                 → clusters_shifted
 *       6. otherwise                                 → clusters_unchanged
 *   - Empty-on-both windows short-circuit to clusters_unchanged with reason
 *     "both_windows_empty" (R-6.4 mitigation).
 *
 * Anti-scope: this module emits a DESCRIPTIVE verdict only. Promotion to Q1
 * WORKING/DEGRADED happens in dna-working.ts via the joined three-layer rule.
 */
import type { ClusterSignature } from "./cluster-producer";

export type ClusterComparisonVerdict =
  | "no_baseline"
  | "clusters_unchanged"
  | "clusters_shifted"
  | "new_clusters"
  | "clusters_disappeared"
  | "clusters_unstable";

export interface ClusterComparison {
  verdict: ClusterComparisonVerdict;
  baselineWindowId: string | null;
  currentWindowId: string;
  themesAdded: string[];
  themesRemoved: string[];
  themesShifted: { token: string; baselineShare: number; currentShare: number }[];
  reasons: string[];
}

const SHIFT_THRESHOLD = 0.20; // §6.11 — locked, single tunable.

function shareMap(sig: ClusterSignature): Map<string, number> {
  const m = new Map<string, number>();
  if (!sig || sig.post_count <= 0) return m;
  for (const t of sig.themes ?? []) {
    m.set(t.theme_token, t.post_count / sig.post_count);
  }
  return m;
}

export function compareClusters(opts: {
  current: { windowId: string; signature: ClusterSignature };
  baseline: { windowId: string; signature: ClusterSignature } | null;
}): ClusterComparison {
  const { current, baseline } = opts;

  if (!baseline) {
    return {
      verdict: "no_baseline",
      baselineWindowId: null,
      currentWindowId: current.windowId,
      themesAdded: [],
      themesRemoved: [],
      themesShifted: [],
      reasons: ["no_prior_cluster_under_dna"],
    };
  }

  // R-6.4 short-circuit.
  if ((current.signature.themes ?? []).length === 0 && (baseline.signature.themes ?? []).length === 0) {
    return {
      verdict: "clusters_unchanged",
      baselineWindowId: baseline.windowId,
      currentWindowId: current.windowId,
      themesAdded: [],
      themesRemoved: [],
      themesShifted: [],
      reasons: ["both_windows_empty"],
    };
  }

  const curSet = new Set((current.signature.themes ?? []).map((t) => t.theme_token));
  const baseSet = new Set((baseline.signature.themes ?? []).map((t) => t.theme_token));

  const added = [...curSet].filter((t) => !baseSet.has(t)).sort();
  const removed = [...baseSet].filter((t) => !curSet.has(t)).sort();

  const curShares = shareMap(current.signature);
  const baseShares = shareMap(baseline.signature);

  const shifted: { token: string; baselineShare: number; currentShare: number }[] = [];
  for (const token of [...curSet].filter((t) => baseSet.has(t)).sort()) {
    const cs = curShares.get(token) ?? 0;
    const bs = baseShares.get(token) ?? 0;
    if (Math.abs(cs - bs) >= SHIFT_THRESHOLD) {
      shifted.push({ token, baselineShare: bs, currentShare: cs });
    }
  }

  let verdict: ClusterComparisonVerdict;
  const reasons: string[] = [];
  if (added.length > 0 && removed.length > 0) {
    verdict = "clusters_unstable";
    reasons.push(`themes_added:${added.length}`, `themes_removed:${removed.length}`);
  } else if (added.length > 0) {
    verdict = "new_clusters";
    reasons.push(`themes_added:${added.length}`);
  } else if (removed.length > 0) {
    verdict = "clusters_disappeared";
    reasons.push(`themes_removed:${removed.length}`);
  } else if (shifted.length > 0) {
    verdict = "clusters_shifted";
    reasons.push(`themes_shifted:${shifted.length}@>=${SHIFT_THRESHOLD}`);
  } else {
    verdict = "clusters_unchanged";
    reasons.push("signature_unchanged_within_threshold");
  }

  return {
    verdict,
    baselineWindowId: baseline.windowId,
    currentWindowId: current.windowId,
    themesAdded: added,
    themesRemoved: removed,
    themesShifted: shifted,
    reasons,
  };
}
