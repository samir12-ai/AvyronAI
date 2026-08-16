import { describe, expect, it } from "vitest";
import { validateSnapshotSchema, buildFreshnessMetadata } from "../shared/snapshot-trust";

describe("Confidence and Freshness Validation", () => {
  it("A: MI snapshot validation requires MI fields", () => {
    const miSnap = { signalData: "{\"a\":1}", confidenceData: "{\"a\":1}", marketState: "STABLE", trajectoryData: "{\"a\":1}", dominanceData: "{\"a\":1}" };
    const result = validateSnapshotSchema(miSnap, 1, "market_intelligence");
    expect(result.compatible).toBe(true);
  });

  it("B: MI snapshot without MI fields is INCOMPATIBLE", () => {
    const badMiSnap = {};
    const result = validateSnapshotSchema(badMiSnap, 1, "market_intelligence");
    expect(result.compatible).toBe(false);
  });

  it("C: Audience snapshot schema validates Audience fields", () => {
    const audSnap = { audienceSegments: "[1]", audiencePains: "[1]", emotionalDrivers: "[1]" };
    const result = validateSnapshotSchema(audSnap, 1, "audience");
    expect(result.compatible).toBe(true);
  });

  it("D: Audience snapshot lacks MI fields but remains compatible", () => {
    const audSnap = { audienceSegments: "[1]", audiencePains: "[1]", emotionalDrivers: "[1]" };
    const fm = buildFreshnessMetadata(audSnap, "audience");
    expect(fm.schemaCompatible).toBe(true);
    expect(fm.freshnessClass).not.toBe("INCOMPATIBLE");
  });

  it("E: Awareness snapshot requires primaryRoute", () => {
    const snap = { primaryRoute: "{}" };
    const result = validateSnapshotSchema(snap, 1, "awareness");
    expect(result.compatible).toBe(true);
  });

  it("F: Persuasion snapshot requires primaryRoute", () => {
    const snap = { primaryRoute: "{}" };
    const result = validateSnapshotSchema(snap, 1, "persuasion");
    expect(result.compatible).toBe(true);
  });

  it("G: Positioning snapshot requires positioningArchetype", () => {
    const snap = { positioningArchetype: "{}" };
    const result = validateSnapshotSchema(snap, 1, "positioning");
    expect(result.compatible).toBe(true);
  });

  it("H: Differentiation snapshot requires marketGaps", () => {
    const snap = { marketGaps: "{}" };
    const result = validateSnapshotSchema(snap, 1, "differentiation");
    expect(result.compatible).toBe(true);
  });

  it("I: Mechanism snapshot requires primaryMechanism", () => {
    const snap = { primaryMechanism: "{}" };
    const result = validateSnapshotSchema(snap, 1, "mechanism");
    expect(result.compatible).toBe(true);
  });

  it("J: Offer snapshot requires primaryOffer", () => {
    const snap = { primaryOffer: "{}" };
    const result = validateSnapshotSchema(snap, 1, "offer");
    expect(result.compatible).toBe(true);
  });

  it("K: Funnel snapshot requires primaryFunnel", () => {
    const snap = { primaryFunnel: "{}" };
    const result = validateSnapshotSchema(snap, 1, "funnel");
    expect(result.compatible).toBe(true);
  });

  it("L: Integrity snapshot requires overallIntegrityScore", () => {
    const snap = { overallIntegrityScore: 0.85 };
    const result = validateSnapshotSchema(snap, 1, "integrity");
    expect(result.compatible).toBe(true);
  });
});
