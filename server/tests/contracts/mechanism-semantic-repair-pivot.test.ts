import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeRepairedMechanismName,
  validateMechanismName,
} from "../../mechanism-engine/engine";

describe("Contract: mechanism-semantic-repair-pivot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Candidate-level sanitization strips axis label leakage without forcing deterministic action words", () => {
    // Does not require 'Validation', 'Extraction', 'Diagnostic'
    // Pure structural sanitization
    const dirty = "Curated Silhouette Architecture Whitespace Positioning";
    const clean = sanitizeRepairedMechanismName(dirty, "whitespace_positioning");
    expect(clean).toBe("Curated Silhouette Architecture");

    const check = validateMechanismName(clean);
    expect(check.valid).toBe(true);
  });

  it("2. Validates legitimate curation and design mechanism names without keyword presence gates", () => {
    // None of these contain the old required words like 'Extraction', 'Diagnostic', 'Audit'
    const modernNames = [
      "Curated Silhouette Architecture",
      "Two-Stage Fabric Selection Model",
      "Direct Artisan Curation Standard",
      "Double-Layer Modest Standard",
      "Full-Coverage Style Matrix",
    ];

    for (const name of modernNames) {
      const result = validateMechanismName(name);
      expect(result.valid).toBe(true);
    }
  });

  it("3. Rejects empty or placeholder names as structural hygiene failure", () => {
    expect(validateMechanismName("").valid).toBe(false);
    expect(validateMechanismName("   ").valid).toBe(false);
    expect(validateMechanismName("Unnamed Mechanism").valid).toBe(false);
    expect(validateMechanismName("Pending Mechanism").valid).toBe(false);
  });
});
