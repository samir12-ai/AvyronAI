/**
 * Task #71 / Phase 8 — Operator-only engine label table.
 *
 * Contains the 13 internal engine names ("Positioning Engine",
 * "Differentiation Engine", …) imported ONLY by the `operator.enabled`
 * branch in `ai-management.tsx`. Customer builds never see these strings.
 *
 * This module lives in its own file so `scripts/check-engine-vocabulary.sh`
 * can scan `app/(tabs)/ai-management.tsx` itself for nav-copy regressions
 * (the highest-risk customer surface) without the operator branch
 * producing false positives. The script's `EXCLUDE_FILES` allowlists
 * this file path.
 *
 * D2 — `key` values are canonical engine identifiers, identical to the
 * customer-mode branch; only `label` / `description` differ.
 */

import type { Ionicons } from '@expo/vector-icons';

export type OperatorStrategyKey =
  | 'positioning' | 'differentiation' | 'mechanism' | 'offers'
  | 'awareness' | 'funnels' | 'integrity' | 'persuasion'
  | 'statistical_validation' | 'budget_governor' | 'channel_selection'
  | 'iteration' | 'retention';

export interface OperatorStrategyBranch {
  key: OperatorStrategyKey;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  description: string;
}

export const OPERATOR_STRATEGY_BRANCHES: OperatorStrategyBranch[] = [
  { key: 'positioning', icon: 'compass-outline', label: 'Positioning', color: '#10B981', description: 'Strategic territory discovery and narrative positioning' },
  { key: 'differentiation', icon: 'layers-outline', label: 'Differentiation', color: '#8B5CF6', description: '12-layer proof-backed differentiation analysis' },
  { key: 'mechanism', icon: 'construct-outline', label: 'Mechanism Engine', color: '#D946EF', description: 'Axis-aligned mechanism generation from positioning and differentiation' },
  { key: 'offers', icon: 'pricetag-outline', label: 'Offer Engine', color: '#F97316', description: '5-layer structured offer construction' },
  { key: 'awareness', icon: 'eye-outline', label: 'Awareness Engine', color: '#F97316', description: '8-layer awareness architecture — entry routes, readiness mapping, and trigger classes' },
  { key: 'funnels', icon: 'funnel-outline', label: 'Funnel Engine', color: '#14B8A6', description: '8-layer funnel decision with trust path and proof placement' },
  { key: 'integrity', icon: 'shield-checkmark-outline', label: 'Integrity Engine', color: '#6366F1', description: 'Final validation gate — 8-layer strategic consistency check before execution' },
  { key: 'persuasion', icon: 'megaphone-outline', label: 'Persuasion Engine', color: '#EC4899', description: '8-layer persuasion logic — influence drivers, objection mapping, and trust sequencing' },
  { key: 'statistical_validation', icon: 'stats-chart-outline', label: 'Statistical Validation', color: '#06B6D4', description: 'Evidence density evaluation — validates claims against real MI signals' },
  { key: 'budget_governor', icon: 'wallet-outline', label: 'Budget Governor', color: '#F59E0B', description: 'Multi-factor risk scoring — test/scale/hold/halt budget decisions' },
  { key: 'channel_selection', icon: 'git-branch-outline', label: 'Channel Selection', color: '#3B82F6', description: '16-channel scoring across 8 layers — audience density and mode compatibility' },
  { key: 'iteration', icon: 'repeat-outline', label: 'Iteration Engine', color: '#F43F5E', description: 'Optimization opportunities — test hypotheses and controlled experimentation' },
  { key: 'retention', icon: 'heart-outline', label: 'Retention Engine', color: '#059669', description: 'Retention leverage points — churn risks, LTV expansion, and upsell triggers' },
];
