import { describe, it, expect } from "vitest";

/**
 * The hook builder is internal to engine.ts; we test its observable contract
 * through stripInternalTokens + the validator pattern documented in the
 * builder. These tests pin the contract a hook MUST satisfy.
 */
import { stripInternalTokens } from "../shared/text-policy";

const HOOK_VERBS = [
  "eliminate", "remove", "cut", "stop", "end", "prevent",
  "deliver", "achieve", "unlock", "build", "grow", "scale",
  "reach", "close", "convert", "win", "drive", "reduce",
  "shorten", "compress", "double", "triple", "replace", "automate",
];

function validateHook(h: string): { ok: boolean; reason?: string } {
  if (!h) return { ok: false, reason: "empty" };
  if (h.length > 90) return { ok: false, reason: "too_long" };
  if (/\[(RC|BB|CC|[A-Z]{2,3})\d+\]/.test(h)) return { ok: false, reason: "internal_token" };
  if (/\b(objection|desire|pain)_\d+\b/i.test(h)) return { ok: false, reason: "synthetic_key" };
  if (/_/.test(h)) return { ok: false, reason: "axis_underscore" };
  if (!HOOK_VERBS.some((v) => new RegExp(`\\b${v}`, "i").test(h))) return { ok: false, reason: "no_benefit_verb" };
  return { ok: true };
}

describe("hook quality contract", () => {
  it("accepts a claim-derived benefit-verb hook", () => {
    expect(validateHook("Eliminate churn — Onboarding flow that activates in 7 days").ok).toBe(true);
    expect(validateHook("Compress sales cycle from 90 to 30 days").ok).toBe(true);
    expect(validateHook("Reduce drop-off by removing friction at activation").ok).toBe(true);
  });

  it("rejects axis-underscore-only hooks (the legacy weak shape)", () => {
    expect(validateHook("retention_axis: improve numbers").ok).toBe(false);
  });

  it("rejects hooks containing internal tokens", () => {
    expect(validateHook("Eliminate churn [RC1]").ok).toBe(false);
  });

  it("rejects hooks containing synthetic indexed keys", () => {
    expect(validateHook("Reduce objection_0 from buyers").ok).toBe(false);
  });

  it("rejects hooks lacking a benefit verb", () => {
    expect(validateHook("retention").ok).toBe(false);
    expect(validateHook("a process for sales").ok).toBe(false);
  });

  it("rejects hooks longer than 90 chars", () => {
    expect(validateHook("a".repeat(91)).ok).toBe(false);
  });

  it("stripInternalTokens leaves a valid hook intact", () => {
    const raw = "Eliminate churn [RC1] via fast activation";
    const clean = stripInternalTokens(raw)!;
    expect(validateHook(clean).ok).toBe(true);
    expect(clean).toBe("Eliminate churn via fast activation");
  });
});
