import { describe, it, expect } from 'vitest';
import {
  layer1_categoryDetection,
  layer2_marketNarrativeMap,
  layer3_narrativeSaturationDetection,
  layer4_trustGapDetection,
  layer6_marketPowerAnalysis,
  layer7_opportunityGapDetection,
  layer8_differentiationAxisConstruction,
  layer9_narrativeDistanceScoring,
  layer12_stabilityGuard,
  deduplicateTerritories,
  generateStrategyCards,
  layer5_segmentPriorityResolution,
} from '../positioning-engine/engine';

describe('Positioning Engine V3 — Layer Tests', () => {
  describe('Layer 1: Category Detection', () => {
    it('should detect fitness category', () => {
      const mi = { marketState: 'Fitness workout gym industry' };
      expect(layer1_categoryDetection(mi)).toBe('fitness');
    });

    it('should detect marketing category', () => {
      const mi = { marketState: 'Social media marketing brand audience' };
      expect(layer1_categoryDetection(mi)).toBe('marketing');
    });

    it('should return general for unknown content', () => {
      const mi = { marketState: 'random gibberish xyz' };
      expect(layer1_categoryDetection(mi)).toBe('general');
    });

    it('should handle empty data', () => {
      const mi = {};
      expect(layer1_categoryDetection(mi)).toBe('general');
    });
  });

  describe('Layer 2: Market Narrative Map', () => {
    it('should extract competitor narratives from contentDnaData', () => {
      const mi = {
        contentDnaData: JSON.stringify([
          { competitorName: 'Comp1', hookArchetypes: ['authority', 'curiosity'], narrativeFrameworks: ['transformation'] },
          { competitorName: 'Comp2', hookArchetypes: ['social_proof'], narrativeFrameworks: [] },
        ]),
      };
      const map = layer2_marketNarrativeMap(mi);
      expect(Object.keys(map)).toHaveLength(2);
      expect(map['Comp1']).toContain('authority');
      expect(map['Comp1']).toContain('transformation');
      expect(map['Comp2']).toContain('social_proof');
    });

    it('should handle missing contentDnaData', () => {
      const mi = {};
      const map = layer2_marketNarrativeMap(mi);
      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe('Layer 3: Narrative Saturation', () => {
    it('should calculate saturation ratios correctly', () => {
      const narrativeMap = {
        'Comp1': ['authority', 'curiosity'],
        'Comp2': ['authority', 'social_proof'],
        'Comp3': ['authority'],
      };
      const sat = layer3_narrativeSaturationDetection(narrativeMap);
      expect(sat['authority']).toBe(1.0);
      expect(sat['curiosity']).toBeCloseTo(0.333, 1);
      expect(sat['social_proof']).toBeCloseTo(0.333, 1);
    });

    it('should handle empty narrative map', () => {
      const sat = layer3_narrativeSaturationDetection({});
      expect(Object.keys(sat)).toHaveLength(0);
    });
  });

  describe('Layer 4: Trust Gap Detection', () => {
    it('should extract trust gaps from objections', () => {
      const audience = {
        objectionMap: JSON.stringify([
          { canonical: 'too expensive', frequency: 15 },
          { canonical: 'no time', frequency: 8 },
        ]),
        awarenessLevel: JSON.stringify({ level: 'PROBLEM_AWARE' }),
      };
      const { trustGaps, trustGapScore } = layer4_trustGapDetection(audience);
      expect(trustGaps).toContain('too expensive');
      expect(trustGaps).toContain('no time');
      expect(trustGapScore).toBeGreaterThan(0);
    });

    it('should handle missing data', () => {
      const { trustGaps, trustGapScore } = layer4_trustGapDetection({});
      expect(trustGaps).toHaveLength(0);
      expect(trustGapScore).toBe(0);
    });
  });

  describe('Layer 5: Segment Priority Resolution', () => {
    it('should prioritize segments by density', () => {
      const audience = {
        audienceSegments: JSON.stringify([
          { name: 'Beginners', painProfile: ['lack of knowledge'] },
          { name: 'Advanced', painProfile: ['plateau'] },
        ]),
        segmentDensity: JSON.stringify([
          { segment: 'Beginners', densityScore: 60 },
          { segment: 'Advanced', densityScore: 40 },
        ]),
        audiencePains: JSON.stringify([
          { canonical: 'lack of knowledge', frequency: 10 },
        ]),
      };
      const result = layer5_segmentPriorityResolution(audience);
      expect(result[0].segment).toBe('Beginners');
      expect(result[0].priority).toBe(60);
    });
  });

  describe('Layer 6: Market Power Analysis', () => {
    it('should detect flanking mode when authority gap is large', () => {
      const mi = {
        dominanceData: JSON.stringify([
          { competitor: 'BigPlayer', dominanceScore: 100 },
          { competitor: 'SmallOne', dominanceScore: 2 },
          { competitor: 'TinyOne', dominanceScore: 1 },
          { competitor: 'MicroOne', dominanceScore: 1 },
        ]),
        contentDnaData: JSON.stringify([]),
      };
      const competitors = [
        { name: 'BigPlayer', engagementRatio: 0.05 },
        { name: 'SmallOne', engagementRatio: 0.02 },
        { name: 'TinyOne', engagementRatio: 0.01 },
        { name: 'MicroOne', engagementRatio: 0.01 },
      ];
      const { entries, flankingMode, authorityGap } = layer6_marketPowerAnalysis(mi, competitors);
      expect(entries).toHaveLength(4);
      expect(entries[0].competitorName).toBe('BigPlayer');
      expect(flankingMode).toBe(true);
      expect(authorityGap).toBeGreaterThan(0.6);
    });

    it('should not activate flanking mode when competitors are balanced', () => {
      const mi = {
        dominanceData: JSON.stringify([
          { competitor: 'A', dominanceScore: 50 },
          { competitor: 'B', dominanceScore: 45 },
        ]),
        contentDnaData: JSON.stringify([]),
      };
      const competitors = [
        { name: 'A', engagementRatio: 0.03 },
        { name: 'B', engagementRatio: 0.03 },
      ];
      const { flankingMode } = layer6_marketPowerAnalysis(mi, competitors);
      expect(flankingMode).toBe(false);
    });
  });

  describe('Layer 7: Opportunity Gap Detection', () => {
    it('should identify high-opportunity territories', () => {
      const audience = {
        audiencePains: JSON.stringify([
          { canonical: 'confusion', frequency: 25, evidence: ['ev1'] },
          { canonical: 'cost', frequency: 15, evidence: ['ev2'] },
        ]),
        desireMap: JSON.stringify([
          { canonical: 'simplicity', frequency: 20, evidence: ['ev3'] },
        ]),
      };
      const saturation = { 'confusion': 0.2, 'simplicity': 0.1 };
      const marketPower = [{ competitorName: 'A', authorityScore: 0.3, contentDominanceScore: 0.2, narrativeOwnershipIndex: 0.1, engagementStrength: 0.1 }];

      const gaps = layer7_opportunityGapDetection(saturation, audience, marketPower);
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps[0].opportunityScore).toBeGreaterThanOrEqual(0.3);
    });

    it('should filter out low-opportunity territories', () => {
      const audience = {
        audiencePains: JSON.stringify([
          { canonical: 'saturated topic', frequency: 2, evidence: [] },
        ]),
        desireMap: JSON.stringify([]),
      };
      const saturation = { 'saturated topic': 0.95 };
      const marketPower = [{ competitorName: 'A', authorityScore: 0.9, contentDominanceScore: 0.9, narrativeOwnershipIndex: 0.9, engagementStrength: 0.9 }];

      const gaps = layer7_opportunityGapDetection(saturation, audience, marketPower);
      const lowOpp = gaps.filter(g => g.opportunityScore < 0.3);
      expect(lowOpp).toHaveLength(0);
    });
  });

  describe('Layer 8: Differentiation Axis Construction', () => {
    it('should add flanking axes when in flanking mode', () => {
      const axes = layer8_differentiationAxisConstruction([], [], true);
      expect(axes).toContain('niche_expertise');
      expect(axes).toContain('underserved_audience_focus');
    });

    it('should add trust-gap-driven axes', () => {
      const trustGaps = ['too expensive', 'complexity / too hard'];
      const axes = layer8_differentiationAxisConstruction([], trustGaps, false);
      expect(axes).toContain('value_accessibility');
      expect(axes).toContain('simplicity_and_ease');
    });

    it('should add whitespace axis for low-saturation opportunities', () => {
      const opps = [{ territory: 'test', saturationLevel: 0.1, audienceDemand: 0.5, competitorAuthority: 0.3, opportunityScore: 0.7, painSignals: [], desireSignals: [] }];
      const axes = layer8_differentiationAxisConstruction(opps, [], false);
      expect(axes).toContain('whitespace_positioning');
    });
  });

  describe('Layer 9: Narrative Distance Scoring', () => {
    it('should return high distance for unrelated narratives', () => {
      const distance = layer9_narrativeDistanceScoring('premium coaching', {
        'Comp1': ['budget tools', 'free templates'],
      });
      expect(distance).toBeGreaterThan(0.5);
    });

    it('should return low distance for similar narratives', () => {
      const distance = layer9_narrativeDistanceScoring('fitness training', {
        'Comp1': ['fitness training program', 'workout guide'],
      });
      expect(distance).toBeLessThan(0.8);
    });

    it('should return 1.0 for empty narrative map', () => {
      const distance = layer9_narrativeDistanceScoring('anything', {});
      expect(distance).toBe(1.0);
    });
  });

  describe('Layer 12: Stability Guard', () => {
    it('should pass stable territories', () => {
      const territories = [{
        name: 'test territory',
        opportunityScore: 0.7,
        narrativeDistanceScore: 0.8,
        painAlignment: [],
        desireAlignment: [],
        enemyDefinition: 'status quo',
        contrastAxis: 'expertise',
        narrativeDirection: 'test',
        isStable: true,
        stabilityNotes: [],
        evidenceSignals: [],
        confidenceScore: 0.56,
      }];
      const narSat = { 'test territory': 0.3 };
      const power = [{ competitorName: 'A', authorityScore: 0.4, contentDominanceScore: 0.3, narrativeOwnershipIndex: 0.2, engagementStrength: 0.1 }];
      const segments = [{ segment: 'S1', priority: 50, painAlignment: 0.5 }];

      const { stabilityResult } = layer12_stabilityGuard(territories, narSat, power, segments);
      expect(stabilityResult.isStable).toBe(true);
      expect(stabilityResult.fallbackApplied).toBe(false);
    });

    it('should apply fallback when all territories are unstable', () => {
      const territories = [{
        name: 'saturated territory',
        opportunityScore: 0.7,
        narrativeDistanceScore: 0.8,
        painAlignment: [],
        desireAlignment: [],
        enemyDefinition: 'test',
        contrastAxis: 'test',
        narrativeDirection: 'test',
        isStable: true,
        stabilityNotes: [],
        evidenceSignals: [],
        confidenceScore: 0.56,
      }];
      const narSat = { 'saturated territory': 0.95 };
      const power = [{ competitorName: 'BigComp', authorityScore: 0.95, contentDominanceScore: 0.9, narrativeOwnershipIndex: 0.9, engagementStrength: 0.9 }];
      const segments = [{ segment: 'S1', priority: 50, painAlignment: 0.05 }];

      const { stabilityResult } = layer12_stabilityGuard(territories, narSat, power, segments);
      expect(stabilityResult.fallbackApplied).toBe(true);
      expect(stabilityResult.isStable).toBe(false);
    });
  });

  describe('Territory Deduplication', () => {
    it('should merge overlapping territories', () => {
      const territories = [
        { name: 'fitness training', opportunityScore: 0.8, narrativeDistanceScore: 0.5, painAlignment: [], desireAlignment: [], enemyDefinition: '', contrastAxis: '', narrativeDirection: '', isStable: true, stabilityNotes: [], evidenceSignals: [], confidenceScore: 0.4 },
        { name: 'fitness training program', opportunityScore: 0.6, narrativeDistanceScore: 0.5, painAlignment: [], desireAlignment: [], enemyDefinition: '', contrastAxis: '', narrativeDirection: '', isStable: true, stabilityNotes: [], evidenceSignals: [], confidenceScore: 0.3 },
        { name: 'nutrition advice', opportunityScore: 0.7, narrativeDistanceScore: 0.5, painAlignment: [], desireAlignment: [], enemyDefinition: '', contrastAxis: '', narrativeDirection: '', isStable: true, stabilityNotes: [], evidenceSignals: [], confidenceScore: 0.35 },
      ];
      const deduped = deduplicateTerritories(territories);
      expect(deduped.length).toBeLessThanOrEqual(3);
    });

    it('should keep distinct territories separate', () => {
      const territories = [
        { name: 'fitness', opportunityScore: 0.8, narrativeDistanceScore: 0.5, painAlignment: [], desireAlignment: [], enemyDefinition: '', contrastAxis: '', narrativeDirection: '', isStable: true, stabilityNotes: [], evidenceSignals: [], confidenceScore: 0.4 },
        { name: 'finance', opportunityScore: 0.7, narrativeDistanceScore: 0.5, painAlignment: [], desireAlignment: [], enemyDefinition: '', contrastAxis: '', narrativeDirection: '', isStable: true, stabilityNotes: [], evidenceSignals: [], confidenceScore: 0.35 },
      ];
      const deduped = deduplicateTerritories(territories);
      expect(deduped).toHaveLength(2);
    });
  });

  describe('Strategy Card Generation', () => {
    it('should mark first territory as primary', () => {
      const territories = [
        { name: 'T1', opportunityScore: 0.8, narrativeDistanceScore: 0.5, painAlignment: [], desireAlignment: [], enemyDefinition: 'Enemy1', contrastAxis: 'expertise', narrativeDirection: 'Dir1', isStable: true, stabilityNotes: [], evidenceSignals: ['ev1'], confidenceScore: 0.4 },
        { name: 'T2', opportunityScore: 0.6, narrativeDistanceScore: 0.5, painAlignment: [], desireAlignment: [], enemyDefinition: 'Enemy2', contrastAxis: 'speed', narrativeDirection: 'Dir2', isStable: true, stabilityNotes: [], evidenceSignals: ['ev2'], confidenceScore: 0.3 },
      ];
      const cards = generateStrategyCards(territories);
      expect(cards).toHaveLength(2);
      expect(cards[0].isPrimary).toBe(true);
      expect(cards[1].isPrimary).toBe(false);
      expect(cards[0].territoryName).toBe('T1');
    });
  });

  describe('Determinism', () => {
    it('should produce identical results for identical inputs (deterministic layers)', () => {
      const mi = {
        marketState: 'fitness workout gym',
        contentDnaData: JSON.stringify([
          { competitorName: 'A', hookArchetypes: ['authority'], narrativeFrameworks: ['transformation'] },
        ]),
      };

      const cat1 = layer1_categoryDetection(mi);
      const cat2 = layer1_categoryDetection(mi);
      expect(cat1).toBe(cat2);

      const map1 = layer2_marketNarrativeMap(mi);
      const map2 = layer2_marketNarrativeMap(mi);
      expect(JSON.stringify(map1)).toBe(JSON.stringify(map2));

      const sat1 = layer3_narrativeSaturationDetection(map1);
      const sat2 = layer3_narrativeSaturationDetection(map2);
      expect(JSON.stringify(sat1)).toBe(JSON.stringify(sat2));
    });
  });

  describe('Adversarial Inputs', () => {
    it('should handle null/undefined fields gracefully', () => {
      expect(layer1_categoryDetection({})).toBe('general');
      expect(layer2_marketNarrativeMap({})).toEqual({});
      expect(layer3_narrativeSaturationDetection({})).toEqual({});

      const { trustGaps } = layer4_trustGapDetection({});
      expect(trustGaps).toEqual([]);
    });

    it('should handle malformed JSON strings', () => {
      const mi = {
        contentDnaData: 'not valid json',
        dominanceData: '{broken',
      };
      const map = layer2_marketNarrativeMap(mi);
      expect(Object.keys(map)).toHaveLength(0);

      const { entries } = layer6_marketPowerAnalysis(mi, []);
      expect(entries).toHaveLength(0);
    });

    it('should handle empty arrays', () => {
      const audience = {
        objectionMap: JSON.stringify([]),
        awarenessLevel: JSON.stringify({}),
        audienceSegments: JSON.stringify([]),
        segmentDensity: JSON.stringify([]),
        audiencePains: JSON.stringify([]),
      };

      const { trustGaps } = layer4_trustGapDetection(audience);
      expect(trustGaps).toHaveLength(0);

      const segments = layer5_segmentPriorityResolution(audience);
      expect(segments).toHaveLength(0);
    });
  });
});
