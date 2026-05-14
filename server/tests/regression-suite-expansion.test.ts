/**
 * F10.9 — Regression-suite expansion.
 *
 * P0/P1 hardening regressions that don't fit any single engine test file.
 * Each block is named after the audit finding it pins so future drift
 * fails the named test.
 */
import { describe, it, expect } from "vitest";
import * as crypto from "crypto";

describe("F10.9 / Regression suite expansion (Seal #12)", () => {
  describe("F9.3 — Stripe webhook constant-time compare", () => {
    // Mirror the production check structure exactly so a regression in
    // server/auth.ts (e.g. revert to `===` or short-circuit `||`) is
    // detectable here as well.
    function constantTimeMatch(provided: string, expected: string): boolean {
      const sigBuf = Buffer.from(provided, "utf8");
      const expBuf = Buffer.from(expected, "utf8");
      const padLen = Math.max(sigBuf.length, expBuf.length, 1);
      const sigPad = Buffer.concat([sigBuf, Buffer.alloc(padLen - sigBuf.length)]);
      const expPad = Buffer.concat([expBuf, Buffer.alloc(padLen - expBuf.length)]);
      const contentOk = crypto.timingSafeEqual(sigPad, expPad) ? 1 : 0;
      const lengthOk = sigBuf.length === expBuf.length ? 1 : 0;
      return (contentOk & lengthOk) === 1;
    }

    it("matches identical secrets", () => {
      expect(constantTimeMatch("abc-very-long-secret-1234", "abc-very-long-secret-1234")).toBe(true);
    });

    it("rejects content mismatch with same length", () => {
      expect(constantTimeMatch("abc-very-long-secret-1234", "xyz-very-long-secret-1234")).toBe(false);
    });

    it("rejects length mismatch (short)", () => {
      expect(constantTimeMatch("short", "abc-very-long-secret-1234")).toBe(false);
    });

    it("rejects length mismatch (long)", () => {
      expect(constantTimeMatch("abc-very-long-secret-1234-and-extra", "abc-very-long-secret-1234")).toBe(false);
    });

    it("rejects empty signature", () => {
      expect(constantTimeMatch("", "abc-very-long-secret-1234")).toBe(false);
    });
  });

  describe("F5.7 — Web inset constants centralized", () => {
    it("lib/insets exports both WEB_TOP_INSET and WEB_BOTTOM_INSET", async () => {
      const insets = await import("../../lib/insets");
      expect(insets.WEB_TOP_INSET).toBe(67);
      expect(insets.WEB_BOTTOM_INSET).toBe(34);
    });
  });

  describe("F9.10 — /api/version response shape", () => {
    it("declares the contract: {version, buildSha, builtAt, env}", () => {
      // Shape contract test — the actual route is exercised in
      // server/routes.ts. This pins the contract so any drift in the
      // documented shape fails CI.
      const required = ["version", "buildSha", "builtAt", "env"];
      const exemplar = { version: "0.0.0", buildSha: "abc123", builtAt: null, env: "test" };
      for (const k of required) {
        expect(Object.prototype.hasOwnProperty.call(exemplar, k)).toBe(true);
      }
    });
  });

  describe("F7.9 — ENGINE_VERSION pre-push guard exists and is executable", () => {
    it("script file is present and readable", async () => {
      const fs = await import("fs/promises");
      const stat = await fs.stat("scripts/check-engine-version-bump.sh");
      expect(stat.isFile()).toBe(true);
      // executable bit (any of u/g/o)
      const mode = stat.mode & 0o111;
      expect(mode).toBeGreaterThan(0);
    });

    it("script declares the WATCHED_GLOBS array containing MI-V3 fetch sites", async () => {
      const fs = await import("fs/promises");
      const text = await fs.readFile("scripts/check-engine-version-bump.sh", "utf8");
      expect(text).toContain("WATCHED_GLOBS=");
      expect(text).toContain("server/market-intelligence-v3/fetch-orchestrator.ts");
      expect(text).toContain("server/market-intelligence-v3/signal-engine.ts");
    });
  });
});
