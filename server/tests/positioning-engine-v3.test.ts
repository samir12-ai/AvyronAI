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
  computeSpecificityScore,
  validateNarrativeOutput,
  computeSemanticSaturation,
  checkCrossCampaignDiversity,
  compressTerritories,
  evaluateCompressionQuality,
  classifyTerritoryLevel,
  validateTerritorySpecificity,
  filterAudienceTerritories,
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

  describe('Generic Territory Penalty (Hardening Item 1)', () => {
    it('should penalize generic cross-industry territories', () => {
      const genericScore = computeSpecificityScore('financial improvement', 'fitness');
      const specificScore = computeSpecificityScore('revenue-driven marketing vs vanity metrics', 'marketing');
      expect(specificScore).toBeGreaterThan(genericScore);
    });

    it('should penalize single-word territories', () => {
      const singleWord = computeSpecificityScore('efficiency', 'marketing');
      const multiWord = computeSpecificityScore('content efficiency framework', 'marketing');
      expect(multiWord).toBeGreaterThan(singleWord);
    });

    it('should reward category-specific territories', () => {
      const noCategory = computeSpecificityScore('better outcomes for clients', 'fitness');
      const withCategory = computeSpecificityScore('fitness transformation methodology', 'fitness');
      expect(withCategory).toBeGreaterThan(noCategory);
    });

    it('should reward contrast-phrased territories', () => {
      const plain = computeSpecificityScore('data nutrition approach', 'health');
      const contrast = computeSpecificityScore('evidence-driven nutrition vs fad diets', 'health');
      expect(contrast).toBeGreaterThan(plain);
    });

    it('should detect known generic patterns', () => {
      const patterns = ['save time', 'social recognition', 'personal growth', 'wellness', 'lifestyle'];
      for (const p of patterns) {
        const score = computeSpecificityScore(p, 'general');
        expect(score).toBeLessThan(1.0);
      }
    });

    it('should integrate specificity into opportunity scoring', () => {
      const audience = {
        audiencePains: JSON.stringify([
          { canonical: 'revenue-driven marketing methodology', frequency: 15, evidence: ['e1'] },
          { canonical: 'financial improvement', frequency: 15, evidence: ['e2'] },
        ]),
        desireMap: JSON.stringify([]),
      };
      const sat = {};
      const mp = [{ competitorName: 'A', authorityScore: 0.3, contentDominanceScore: 0.2, narrativeOwnershipIndex: 0.1, engagementStrength: 0.1 }];
      const gaps = layer7_opportunityGapDetection(sat, audience, mp, 'marketing');
      const specific = gaps.find(g => g.territory.includes('revenue-driven'));
      const generic = gaps.find(g => g.territory.includes('financial improvement'));
      if (specific && generic) {
        expect(specific.opportunityScore).toBeGreaterThanOrEqual(generic.opportunityScore);
      }
    });
  });

  describe('Narrative Validation Filter (Hardening Item 2)', () => {
    it('should reject first-person promotional language', () => {
      expect(validateNarrativeOutput('We elevate your professional status').valid).toBe(false);
      expect(validateNarrativeOutput('We help businesses grow faster').valid).toBe(false);
      expect(validateNarrativeOutput('We transform lives daily').valid).toBe(false);
    });

    it('should reject imperative CTAs', () => {
      expect(validateNarrativeOutput('Get started with our platform today').valid).toBe(false);
      expect(validateNarrativeOutput('Join thousands of happy customers').valid).toBe(false);
      expect(validateNarrativeOutput('Discover the secret to success').valid).toBe(false);
    });

    it('should reject unsubstantiated superlatives', () => {
      expect(validateNarrativeOutput('The best fitness coaching in the world').valid).toBe(false);
      expect(validateNarrativeOutput('World-class nutrition program').valid).toBe(false);
      expect(validateNarrativeOutput('Guaranteed results in 30 days').valid).toBe(false);
    });

    it('should reject promotional CTA patterns', () => {
      expect(validateNarrativeOutput('Your transformation awaits').valid).toBe(false);
      expect(validateNarrativeOutput('Your journey starts here').valid).toBe(false);
    });

    it('should accept strategic framing', () => {
      expect(validateNarrativeOutput('Performance-driven marketing that replaces vanity metrics with measurable revenue outcomes').valid).toBe(true);
      expect(validateNarrativeOutput('Data-backed methodology targeting underserved audience segments in competitive fitness markets').valid).toBe(true);
      expect(validateNarrativeOutput('Strategic positioning against commoditized coaching through evidence-based differentiation').valid).toBe(true);
    });

    it('should reject too-short outputs', () => {
      expect(validateNarrativeOutput('Buy now').valid).toBe(false);
      expect(validateNarrativeOutput('Click here').valid).toBe(false);
    });
  });

  describe('Improved Saturation Detection (Hardening Item 3)', () => {
    it('should detect saturation via semantic similarity, not just exact match', () => {
      const narrativeMap = {
        'Comp1': ['fitness coaching transformation'],
        'Comp2': ['body transformation program'],
      };
      const contentDna = [
        { competitorName: 'Comp1', hookArchetypes: ['transformation'], topCaptions: ['Transform your body with our fitness coaching'] },
        { competitorName: 'Comp2', hookArchetypes: ['results'], topCaptions: ['Get real body transformation results'] },
      ];
      const sat = computeSemanticSaturation('body transformation coaching', narrativeMap, contentDna, 2);
      expect(sat).toBeGreaterThan(0);
    });

    it('should apply minimum saturation floor based on competitor count', () => {
      const sat = computeSemanticSaturation('completely unique niche xyz123', {}, [], 5);
      expect(sat).toBeGreaterThan(0);
      expect(sat).toBeGreaterThanOrEqual(5 * 0.03);
    });

    it('should not report 0% saturation in markets with 3+ competitors', () => {
      const narrativeMap = {
        'C1': ['content strategy'],
        'C2': ['marketing approach'],
        'C3': ['audience growth'],
      };
      const sat = computeSemanticSaturation('marketing strategy', narrativeMap, [], 3);
      expect(sat).toBeGreaterThan(0);
    });

    it('should handle empty inputs gracefully', () => {
      const sat = computeSemanticSaturation('test', {}, [], 0);
      expect(sat).toBe(0);
    });
  });

  describe('Narrative Distance Realism (Hardening Item 4)', () => {
    it('should cap distance at 0.75 when keyword overlap exceeds 25%', () => {
      const distance = layer9_narrativeDistanceScoring('fitness coaching program', {
        'Comp1': ['fitness coaching methodology', 'training program design'],
      });
      expect(distance).toBeLessThanOrEqual(0.75);
    });

    it('should not produce 100% distance for overlapping terms', () => {
      const distance = layer9_narrativeDistanceScoring('marketing strategy framework', {
        'Comp1': ['strategic marketing approach', 'marketing framework for growth'],
      });
      expect(distance).toBeLessThan(1.0);
    });

    it('should detect substring matches', () => {
      const distance = layer9_narrativeDistanceScoring('personalized nutrition coaching', {
        'Comp1': ['nutrition programs', 'personalization in health'],
      });
      expect(distance).toBeLessThan(1.0);
    });

    it('should still return 1.0 for truly unrelated narratives', () => {
      const distance = layer9_narrativeDistanceScoring('quantum computing', {
        'Comp1': ['organic farming', 'sustainable agriculture'],
      });
      expect(distance).toBe(1.0);
    });
  });

  describe('Flanking Mode Sensitivity (Hardening Item 5)', () => {
    it('should trigger flanking when competitor has multi-signal dominance', () => {
      const mi = {
        dominanceData: JSON.stringify([
          { competitor: 'DomPlayer', dominanceScore: 40 },
          { competitor: 'SmallOne', dominanceScore: 35 },
        ]),
        contentDnaData: JSON.stringify([
          { competitorName: 'DomPlayer', hookArchetypes: ['a', 'b', 'c', 'd', 'e', 'f'], narrativeFrameworks: ['x', 'y', 'z', 'w'] },
          { competitorName: 'SmallOne', hookArchetypes: ['a'], narrativeFrameworks: ['x'] },
        ]),
      };
      const competitors = [
        { name: 'DomPlayer', engagementRatio: 0.08 },
        { name: 'SmallOne', engagementRatio: 0.01 },
      ];
      const { flankingMode } = layer6_marketPowerAnalysis(mi, competitors);
      expect(flankingMode).toBe(true);
    });

    it('should not trigger flanking for low-signal competitors', () => {
      const mi = {
        dominanceData: JSON.stringify([
          { competitor: 'A', dominanceScore: 40 },
          { competitor: 'B', dominanceScore: 35 },
        ]),
        contentDnaData: JSON.stringify([
          { competitorName: 'A', hookArchetypes: ['a'], narrativeFrameworks: ['x'] },
          { competitorName: 'B', hookArchetypes: ['b'], narrativeFrameworks: ['y'] },
        ]),
      };
      const competitors = [
        { name: 'A', engagementRatio: 0.02 },
        { name: 'B', engagementRatio: 0.02 },
      ];
      const { flankingMode } = layer6_marketPowerAnalysis(mi, competitors);
      expect(flankingMode).toBe(false);
    });
  });

  describe('Cross-Campaign Territory Diversity (Hardening Item 6)', () => {
    it('should penalize territories similar to recent campaign territories', () => {
      const territories = [
        { name: 'fitness coaching methodology', opportunityScore: 0.8 },
        { name: 'quantum nutrition science', opportunityScore: 0.7 },
      ];
      const recent = ['fitness coaching methodology', 'body transformation system'];
      const penalties = checkCrossCampaignDiversity(territories, recent);
      const fitnessPenalty = penalties.find(p => p.name.includes('fitness'));
      const quantumPenalty = penalties.find(p => p.name.includes('quantum'));
      expect(fitnessPenalty?.penalty).toBeGreaterThan(0);
      expect(quantumPenalty?.penalty).toBe(0);
    });

    it('should not penalize unique territories', () => {
      const territories = [{ name: 'completely unique positioning xyz', opportunityScore: 0.7 }];
      const recent = ['fitness coaching', 'marketing strategy', 'nutrition program'];
      const penalties = checkCrossCampaignDiversity(territories, recent);
      expect(penalties[0].penalty).toBe(0);
    });

    it('should use Jaccard similarity for comparison', () => {
      const territories = [
        { name: 'a b c d', opportunityScore: 0.7 },
      ];
      const recent = ['a b c d'];
      const penalties = checkCrossCampaignDiversity(territories, recent);
      expect(penalties[0].penalty).toBeGreaterThan(0);
    });

    it('should handle empty recent territory list', () => {
      const territories = [{ name: 'test territory', opportunityScore: 0.7 }];
      const penalties = checkCrossCampaignDiversity(territories, []);
      expect(penalties[0].penalty).toBe(0);
    });
  });

  describe('Compression Layer', () => {
    const makeTerritory = (overrides: Record<string, any> = {}) => ({
      name: 'test territory',
      confidenceScore: 0.6,
      stabilityNotes: [] as string[],
      enemyDefinition: '',
      narrativeDirection: '',
      domainFailure: '',
      operationalProblem: '',
      contrastAxis: '',
      opportunityScore: 0.5,
      painAlignment: [] as string[],
      desireAlignment: [] as string[],
      evidenceSignals: [] as string[],
      ...overrides,
    });

    describe('compressTerritories', () => {
      it('should return single territory unchanged', () => {
        const input = [makeTerritory({ name: 'cost concerns' })];
        const result = compressTerritories(input as any);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('cost concerns');
      });

      it('should merge territories with high token overlap', () => {
        const input = [
          makeTerritory({ name: 'cost affordability pricing concerns' }),
          makeTerritory({ name: 'cost affordability budget concerns' }),
          makeTerritory({ name: 'trust authority credibility' }),
        ];
        const result = compressTerritories(input as any);
        expect(result.length).toBeLessThanOrEqual(2);
        expect(result[0].name).toBe('cost affordability pricing concerns');
      });

      it('should preserve distinct territories', () => {
        const input = [
          makeTerritory({ name: 'cost concerns pricing' }),
          makeTerritory({ name: 'trust authority credibility' }),
        ];
        const result = compressTerritories(input as any);
        expect(result).toHaveLength(2);
      });

      it('should cap output to MAX_TERRITORIES', () => {
        const input = [
          makeTerritory({ name: 'alpha beta gamma' }),
          makeTerritory({ name: 'delta epsilon zeta' }),
          makeTerritory({ name: 'eta theta iota' }),
          makeTerritory({ name: 'kappa lambda mu' }),
        ];
        const result = compressTerritories(input as any);
        expect(result.length).toBeLessThanOrEqual(2);
      });
    });

    describe('evaluateCompressionQuality', () => {
      it('should score high for territory with system nouns and failure verbs', () => {
        const t = makeTerritory({
          enemyDefinition: 'The lead generation system fails to deliver measurable ROI',
          domainFailure: 'Lead pipeline system breakdown',
          operationalProblem: 'Users cannot track conversion metrics',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeGreaterThanOrEqual(0.80);
      });

      it('should score low for broad emotional territory', () => {
        const t = makeTerritory({
          enemyDefinition: 'People have trust issues and cost concerns',
          domainFailure: '',
          operationalProblem: '',
          narrativeDirection: 'Affordability and emotional connection matter',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeLessThan(0.60);
      });

      it('should penalize multiple broad markers', () => {
        const t = makeTerritory({
          enemyDefinition: 'cost concerns and trust issues with community needs',
          domainFailure: 'affordability',
          narrativeDirection: 'belonging needs drive emotional connection',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeLessThanOrEqual(0.50);
      });

      it('should give baseline score for empty territory', () => {
        const t = makeTerritory({});
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBe(0.50);
      });

      it('should give bonus for substantive domainFailure', () => {
        const t = makeTerritory({
          domainFailure: 'Lead attribution pipeline lacks cross-channel tracking',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeGreaterThan(0.50);
      });

      it('should penalize false specificity — system+failure vocab without domain anchor', () => {
        const t = makeTerritory({
          enemyDefinition: 'The engagement system fails to retain users',
          domainFailure: 'Engagement system breakdown',
          narrativeDirection: 'Our platform fixes the broken retention process',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeLessThanOrEqual(0.80);
      });

      it('should not penalize when domain anchor nouns are present', () => {
        const t = makeTerritory({
          enemyDefinition: 'The lead generation pipeline fails to deliver qualified prospects',
          domainFailure: 'Lead pipeline system failure',
          narrativeDirection: 'Our campaign intelligence system fixes broken funnel conversion',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeGreaterThanOrEqual(0.85);
      });

      it('should penalize cross-domain generic phrases without domain anchor', () => {
        const t = makeTerritory({
          enemyDefinition: 'The value delivery system fails to communicate ROI',
          domainFailure: 'value delivery system fails',
          narrativeDirection: 'We fix the broken customer experience',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeLessThan(0.80);
      });

      it('should heavily penalize audience-level territory names', () => {
        const t = makeTerritory({
          name: 'cost and affordability concerns',
          enemyDefinition: 'The pricing model lacks transparency',
          domainFailure: '',
          narrativeDirection: 'We help with cost issues',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeLessThan(0.55);
      });

      it('should not penalize system-level territory names', () => {
        const t = makeTerritory({
          name: 'ROI validation pipeline failure',
          enemyDefinition: 'The analytics pipeline fails to surface ROI data',
          domainFailure: 'analytics pipeline breaks before ROI reporting',
          narrativeDirection: 'We surface ROI before commitment',
        });
        const score = evaluateCompressionQuality(t as any);
        expect(score).toBeGreaterThan(0.70);
      });
    });

    describe('classifyTerritoryLevel', () => {
      it('should classify audience-level territories', () => {
        const t = makeTerritory({
          name: 'cost and affordability concerns',
          enemyDefinition: 'buyers worry about pricing',
          narrativeDirection: 'We address cost hesitation',
          domainFailure: '',
        });
        const result = classifyTerritoryLevel(t as any);
        expect(result.level).toBe('audience');
        expect(result.reasons.length).toBeGreaterThan(0);
      });

      it('should classify system-level territories', () => {
        const t = makeTerritory({
          name: 'ROI validation pipeline failure',
          enemyDefinition: 'The analytics pipeline fails to surface ROI metrics before the buyer commits',
          narrativeDirection: 'We fix the broken ROI visibility process',
          domainFailure: 'analytics pipeline lacks real-time ROI reporting',
        });
        const result = classifyTerritoryLevel(t as any);
        expect(result.level).toBe('system');
        expect(result.reasons).toHaveLength(0);
      });

      it('should classify mixed territories', () => {
        const t = makeTerritory({
          name: 'belonging and community',
          enemyDefinition: 'The onboarding process lacks community integration steps',
          narrativeDirection: 'We embed structured community access',
          domainFailure: '',
        });
        const result = classifyTerritoryLevel(t as any);
        expect(result.level).not.toBe('system');
      });
    });

    describe('validateTerritorySpecificity', () => {
      it('should pass for system-level territories', () => {
        const territories = [
          makeTerritory({
            name: 'ROI validation pipeline failure',
            enemyDefinition: 'The analytics pipeline fails to report ROI',
            narrativeDirection: 'Fix the ROI visibility process breakdown',
            domainFailure: 'analytics pipeline lacks ROI reporting',
          }),
        ];
        const result = validateTerritorySpecificity(territories as any);
        expect(result.passed).toBe(true);
        expect(result.systemCount).toBe(1);
        expect(result.audienceCount).toBe(0);
      });

      it('should fail for audience-level territories', () => {
        const territories = [
          makeTerritory({
            name: 'cost and affordability concerns',
            enemyDefinition: 'buyers worry about pricing',
            narrativeDirection: 'we address cost hesitation',
            domainFailure: '',
          }),
        ];
        const result = validateTerritorySpecificity(territories as any);
        expect(result.passed).toBe(false);
        expect(result.audienceCount).toBe(1);
        expect(result.rejections.length).toBeGreaterThan(0);
      });

      it('should pass mixed territories with domain failure detail', () => {
        const territories = [
          makeTerritory({
            name: 'trust concerns in AI tools',
            enemyDefinition: 'buyers hesitate to trust AI',
            narrativeDirection: 'transparent AI with proof',
            domainFailure: 'AI marketing tools lack transparent methodology documentation and verifiable case studies',
          }),
        ];
        const result = validateTerritorySpecificity(territories as any);
        expect(result.passed).toBe(true);
      });
    });

    describe('computeSpecificityScore — audience-level penalty', () => {
      it('should penalize audience-level territory names without system nouns', () => {
        const audienceScore = computeSpecificityScore('cost and affordability concerns', 'marketing');
        const systemScore = computeSpecificityScore('ROI validation pipeline failure in marketing tools', 'marketing');
        expect(systemScore).toBeGreaterThan(audienceScore);
        expect(audienceScore).toBeLessThan(0.55);
      });

      it('should penalize belonging/community audience markers', () => {
        const score = computeSpecificityScore('belonging and community needs', 'fitness');
        expect(score).toBeLessThan(0.50);
      });

      it('should not penalize system-level names that happen to mention audience words', () => {
        const score = computeSpecificityScore('trust validation process breaks for AI tool buyers', 'marketing');
        expect(score).toBeGreaterThan(0.50);
      });
    });
  });

  describe('filterAudienceTerritories — Layer 10 Upstream Filter', () => {
    function makeTerr(name: string): any {
      return {
        name,
        opportunityScore: 0.5,
        narrativeDistanceScore: 0.5,
        painAlignment: [],
        desireAlignment: [],
        enemyDefinition: "The status quo",
        contrastAxis: "unique_approach",
        narrativeDirection: "Position around territory",
        isStable: true,
        stabilityNotes: [],
        evidenceSignals: [],
        confidenceScore: 0.5,
      };
    }

    it('should reject pure audience territory: "belonging / community"', () => {
      const { systemLevel, rejected } = filterAudienceTerritories([makeTerr("belonging / community")]);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].name).toBe("belonging / community");
      expect(systemLevel).toHaveLength(0);
    });

    it('should reject pure audience territory: "cost and affordability concerns"', () => {
      const { systemLevel, rejected } = filterAudienceTerritories([makeTerr("cost and affordability concerns")]);
      expect(rejected).toHaveLength(1);
      expect(systemLevel).toHaveLength(0);
    });

    it('should reject "desires and needs driven by trust"', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("desires and needs driven by trust")]);
      expect(rejected).toHaveLength(1);
    });

    it('should pass system-level territory: "pipeline automation failure"', () => {
      const { systemLevel, rejected } = filterAudienceTerritories([makeTerr("pipeline automation failure")]);
      expect(systemLevel).toHaveLength(1);
      expect(rejected).toHaveLength(0);
    });

    it('should pass territory with failure verb: "lead scoring breaks under scale"', () => {
      const { systemLevel } = filterAudienceTerritories([makeTerr("lead scoring breaks under scale")]);
      expect(systemLevel).toHaveLength(1);
    });

    it('should pass territory with system noun: "onboarding process inefficiency"', () => {
      const { systemLevel } = filterAudienceTerritories([makeTerr("onboarding process inefficiency")]);
      expect(systemLevel).toHaveLength(1);
    });

    it('should correctly split mixed batch of territories', () => {
      const territories = [
        makeTerr("belonging / community"),
        makeTerr("pipeline automation failure"),
        makeTerr("cost and affordability concerns"),
        makeTerr("conversion flow bottleneck"),
      ];
      const { systemLevel, rejected } = filterAudienceTerritories(territories);
      expect(systemLevel).toHaveLength(2);
      expect(rejected).toHaveLength(2);
      expect(systemLevel.map(t => t.name)).toContain("pipeline automation failure");
      expect(systemLevel.map(t => t.name)).toContain("conversion flow bottleneck");
    });

    it('should pass territory with mixed signals if system noun present', () => {
      const { systemLevel } = filterAudienceTerritories([makeTerr("trust validation process for community")]);
      expect(systemLevel).toHaveLength(1);
    });

    it('should handle empty input', () => {
      const { systemLevel, rejected } = filterAudienceTerritories([]);
      expect(systemLevel).toHaveLength(0);
      expect(rejected).toHaveLength(0);
    });

    it('should reject "transformation and empowerment"', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("transformation and empowerment")]);
      expect(rejected).toHaveLength(1);
    });

    it('should pass "workflow integration gap" with gap as failure marker', () => {
      const { systemLevel } = filterAudienceTerritories([makeTerr("workflow integration gap")]);
      expect(systemLevel).toHaveLength(1);
    });

    it('should reject "desperation / urgency" as audience-level', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("desperation / urgency")]);
      expect(rejected).toHaveLength(1);
    });

    it('should reject "overwhelm and confusion" as audience-level', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("overwhelm and confusion")]);
      expect(rejected).toHaveLength(1);
    });

    it('should reject "skepticism and resistance" as audience-level', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("skepticism and resistance")]);
      expect(rejected).toHaveLength(1);
    });

    it('should reject "Desired transformation: weak → strong" as audience-level', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("Desired transformation: weak → strong")]);
      expect(rejected).toHaveLength(1);
    });

    it('should not reject system territory with "weak" as failure verb: "weak pipeline validation"', () => {
      const { systemLevel } = filterAudienceTerritories([makeTerr("weak pipeline validation")]);
      expect(systemLevel).toHaveLength(1);
    });

    it('should reject "status / social proof" as audience-level', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("status / social proof")]);
      expect(rejected).toHaveLength(1);
    });

    it('should reject data labels with signal counts', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("Dominant intent: comparison-shopping (115 signals classified)")]);
      expect(rejected).toHaveLength(1);
    });

    it('should reject data labels with numeric patterns', () => {
      const { rejected } = filterAudienceTerritories([makeTerr("Top pain (42 signals)")]);
      expect(rejected).toHaveLength(1);
    });
  });
});
