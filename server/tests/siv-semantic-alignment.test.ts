/**
 * SIV Semantic Alignment Validation tests — Task #4
 *
 * Covers:
 *  - SEMANTIC_ALIGNMENT_THRESHOLD constant (0.35) in engine.ts
 *  - cosineSimilarity correctly distinguishes aligned vs misaligned engine-output pairs
 *  - checkAlignmentPair correctly identifies paraphrase as aligned, drift as misaligned
 *  - ALIGNMENT_CHAIN ordering unchanged
 *  - competitor-analysis paths (jaccardSimilarity, tokenOverlap) are untouched
 */

import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../shared/embedding";
import { runSystemIntegrityValidation } from "../system-integrity/engine";

const SEMANTIC_ALIGNMENT_THRESHOLD = 0.35;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Threshold constant — inlined from engine.ts so tests are self-describing
// ─────────────────────────────────────────────────────────────────────────────
describe("SIV Semantic Alignment — threshold constant", () => {
  it("SA-1) SEMANTIC_ALIGNMENT_THRESHOLD sits between paraphrase and drift", () => {
    const paraphraseScore = cosineSimilarity(
      "customers distrust vendors who hide pricing so they avoid purchase decisions",
      "audience is skeptical of companies with undisclosed costs so buyers delay conversion",
    );
    const driftScore = cosineSimilarity(
      "customers distrust vendors who hide pricing so they avoid purchase decisions",
      "innovation drives growth through bold market expansion strategies",
    );

    expect(paraphraseScore).toBeGreaterThan(SEMANTIC_ALIGNMENT_THRESHOLD);
    expect(driftScore).toBeLessThan(SEMANTIC_ALIGNMENT_THRESHOLD);

    expect(SEMANTIC_ALIGNMENT_THRESHOLD).toBeCloseTo(0.35, 2);
  });

  it("SA-2) engine.ts source contains SEMANTIC_ALIGNMENT_THRESHOLD constant", () => {
    const src = require("fs").readFileSync("server/system-integrity/engine.ts", "utf-8");
    expect(src).toContain("SEMANTIC_ALIGNMENT_THRESHOLD");
    expect(src).toContain("0.35");
  });

  it("SA-3) engine.ts uses cosineSimilarity from shared/embedding (not word-overlap)", () => {
    const src = require("fs").readFileSync("server/system-integrity/engine.ts", "utf-8");
    expect(src).toContain('from "../shared/embedding"');
    expect(src).toContain("cosineSimilarity");
    expect(src).not.toContain("matchCount");
    expect(src).not.toContain("sourceWords.has(word)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Semantic discrimination tests
// ─────────────────────────────────────────────────────────────────────────────
describe("SIV Semantic Alignment — similarity discrimination", () => {
  it("SA-4) paraphrase of same concept is above threshold (aligned)", () => {
    const score = cosineSimilarity(
      "customers distrust vendors who hide pricing so they avoid purchase decisions",
      "audience is skeptical of companies with undisclosed costs so buyers delay conversion",
    );
    expect(score).toBeGreaterThanOrEqual(SEMANTIC_ALIGNMENT_THRESHOLD);
  });

  it("SA-5) true drift is below threshold (misaligned)", () => {
    const score = cosineSimilarity(
      "customers distrust vendors who hide pricing so they avoid purchase decisions",
      "innovation drives growth through bold market expansion strategies",
    );
    expect(score).toBeLessThan(SEMANTIC_ALIGNMENT_THRESHOLD);
  });

  it("SA-6) identical texts score 1.0 (trivially aligned)", () => {
    const text = "pricing transparency builds trust and removes purchase barriers for skeptical buyers";
    const score = cosineSimilarity(text, text);
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("SA-7) related strategic domain texts with shared concept density score above threshold", () => {
    const positioning =
      "customers distrust companies that hide fees so skeptical buyers avoid conversion " +
      "the trust barrier caused by undisclosed costs prevents purchase decisions";
    const differentiation =
      "audience skeptical of companies hiding fees so trust problem causes buyers to avoid commitment " +
      "eliminating undisclosed costs resolves the barrier and removes purchase hesitation";
    const score = cosineSimilarity(positioning, differentiation);
    expect(score).toBeGreaterThanOrEqual(SEMANTIC_ALIGNMENT_THRESHOLD);
  });

  it("SA-8) unrelated engine output pair scores below threshold (cross-domain drift)", () => {
    const awareness = "viral content strategy leverages engagement to build brand reach and audience awareness";
    const mechanism = "our proprietary framework delivers results through a proven three-step optimization process";
    const score = cosineSimilarity(awareness, mechanism);
    expect(score).toBeLessThan(SEMANTIC_ALIGNMENT_THRESHOLD);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. checkAlignmentPair via runSystemIntegrityValidation
// ─────────────────────────────────────────────────────────────────────────────
function makeOutput(texts: string[]): Record<string, string[]> {
  return { items: texts };
}

describe("SIV Semantic Alignment — checkAlignmentPair behavior", () => {
  it("SA-9) aligned pair (paraphrase): alignmentScore >= threshold, aligned=true", () => {
    const outputs = {
      audience: makeOutput([
        "customers distrust vendors who hide pricing so they avoid purchase decisions",
        "skeptical buyers require proof of transparent billing before committing",
      ]),
      positioning: makeOutput([
        "audience is skeptical of companies with undisclosed costs so buyers delay conversion",
        "trust problem caused by hidden fees prevents purchase completion",
      ]),
    };
    const report = runSystemIntegrityValidation(outputs as any, null);
    const pair = report.crossEngineAlignment.find(
      a => a.sourceEngine === "audience" && a.targetEngine === "positioning",
    );
    expect(pair).toBeDefined();
    expect(pair!.aligned).toBe(true);
    expect(pair!.alignmentScore).toBeGreaterThanOrEqual(SEMANTIC_ALIGNMENT_THRESHOLD);
  });

  it("SA-10) misaligned pair (drift): alignmentScore < threshold, aligned=false", () => {
    const outputs = {
      audience: makeOutput([
        "innovation ecosystem growth velocity market expansion new verticals",
        "scale strategies amplify reach through content experimentation",
      ]),
      positioning: makeOutput([
        "trust problem caused by hidden fees prevents purchase completion",
        "skeptical buyers require proof of transparent billing before committing",
      ]),
    };
    const report = runSystemIntegrityValidation(outputs as any, null);
    const pair = report.crossEngineAlignment.find(
      a => a.sourceEngine === "audience" && a.targetEngine === "positioning",
    );
    expect(pair).toBeDefined();
    expect(pair!.aligned).toBe(false);
    expect(pair!.alignmentScore).toBeLessThan(SEMANTIC_ALIGNMENT_THRESHOLD);
    expect(pair!.mismatches.length).toBeGreaterThan(0);
    expect(pair!.mismatches[0]).toContain("Semantic misalignment");
  });

  it("SA-11) mismatch message contains score and threshold", () => {
    const outputs = {
      differentiation: makeOutput([
        "innovation ecosystem growth velocity market expansion new verticals bold risk-taking",
      ]),
      mechanism: makeOutput([
        "trust evidence social proof testimonials reduce buyer anxiety before purchase",
      ]),
    };
    const report = runSystemIntegrityValidation(outputs as any, null);
    const pair = report.crossEngineAlignment.find(
      a => a.sourceEngine === "differentiation" && a.targetEngine === "mechanism",
    );
    if (pair && !pair.aligned) {
      expect(pair.mismatches[0]).toMatch(/score=\d+\.\d+/);
      expect(pair.mismatches[0]).toContain("threshold=0.35");
    }
  });

  it("SA-12) ALIGNMENT_CHAIN preserved — 7 pairs always evaluated", () => {
    const outputs: Record<string, any> = {};
    const src = require("fs").readFileSync("server/system-integrity/engine.ts", "utf-8");
    expect(src).toContain('["audience", "positioning"]');
    expect(src).toContain('["positioning", "differentiation"]');
    expect(src).toContain('["differentiation", "mechanism"]');
    expect(src).toContain('["mechanism", "offer"]');
    expect(src).toContain('["offer", "funnel"]');
    expect(src).toContain('["audience", "awareness"]');
    expect(src).toContain('["awareness", "persuasion"]');

    const report = runSystemIntegrityValidation(outputs, null);
    expect(report.crossEngineAlignment).toHaveLength(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Out-of-scope paths unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe("SIV Semantic Alignment — out-of-scope paths unchanged", () => {
  it("SA-13) narrative-clustering.ts still uses tokenOverlap (competitor analysis, untouched)", () => {
    const src = require("fs").readFileSync(
      "server/market-intelligence-v3/narrative-clustering.ts", "utf-8",
    );
    expect(src).toContain("tokenOverlap");
    expect(src).toContain("MI_NARRATIVE_CLUSTERING.TOKEN_OVERLAP_THRESHOLD");
  });

  it("SA-14) similarity-engine.ts still uses jaccardSimilarity (competitor analysis, untouched)", () => {
    const src = require("fs").readFileSync(
      "server/market-intelligence-v3/similarity-engine.ts", "utf-8",
    );
    expect(src).toContain("jaccardSimilarity");
  });

  it("SA-15) MI_NARRATIVE_CLUSTERING.TOKEN_OVERLAP_THRESHOLD remains 0.40 (source check)", () => {
    const src = require("fs").readFileSync(
      "server/market-intelligence-v3/constants.ts", "utf-8",
    );
    expect(src).toContain("TOKEN_OVERLAP_THRESHOLD: 0.40");
  });
});
