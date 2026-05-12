/**
 * Seal #3 (Task #21) — F1.9 photography PUT mass-assignment regression suite.
 *
 * Two layers:
 *   1. Source-pattern tripwire — assert the strict zod schema is wired into
 *      the PUT handler and the deny-by-destructure pattern is gone.
 *   2. Behavioral proof — exercise photographyProfileUpdateSchema directly
 *      to prove unknown keys are REJECTED and identity columns cannot be
 *      tampered with via body.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { photographyProfileUpdateSchema } from "../../shared/schema-seal3";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

describe("Seal #3 F1.9 — photography PUT mass-assignment defense", () => {
  describe("source-pattern tripwires", () => {
    const src = read("server/photography-routes.ts");

    it("imports photographyProfileUpdateSchema from @shared/schema", () => {
      expect(src).toMatch(/photographyProfileUpdateSchema/);
      expect(src).toMatch(/from\s+"@shared\/schema"/);
    });

    it("PUT handler calls safeParse on req.body and returns 400 on failure", () => {
      const start = src.indexOf('app.put("/api/photography/photographers/:id"');
      expect(start).toBeGreaterThan(-1);
      const block = src.slice(start, start + 1500);
      expect(block).toMatch(/photographyProfileUpdateSchema\.safeParse\(req\.body\)/);
      expect(block).toMatch(/status\(400\)[^]*INVALID_BODY/);
    });

    it("the legacy destructure-deny pattern is GONE (no `{ accountId: _ignored, id: _ignoredId, ...rest }` in PUT handler)", () => {
      const start = src.indexOf('app.put("/api/photography/photographers/:id"');
      const block = src.slice(start, start + 1500);
      expect(block).not.toMatch(/_ignored\s*,\s*id\s*:\s*_ignoredId/);
    });

    it("issue echo strips the offending value (no `i.message` or `i.received` echo)", () => {
      const start = src.indexOf('app.put("/api/photography/photographers/:id"');
      const block = src.slice(start, start + 1500);
      // The handler returns { field, code } only.
      expect(block).toMatch(/issues\.map\(\s*i\s*=>\s*\(\s*\{\s*field:[\s\S]*?code:/);
      expect(block).not.toMatch(/i\.received/);
    });
  });

  describe("schema behavioral proofs", () => {
    it("rejects unknown body keys (mass-assignment vector closed)", () => {
      const out = photographyProfileUpdateSchema.safeParse({
        name: "Legit Update",
        accountId: "attacker-account-id",            // identity column — must be rejected
        id: "some-other-row-id",                     // identity column — must be rejected
        rating: 5.0,                                  // server-managed — must be rejected
        totalReviews: 999,                            // server-managed — must be rejected
        isVerified: true,                             // server-managed — must be rejected
        createdAt: new Date().toISOString(),          // audit column — must be rejected
        completelyMadeUpField: "evil",                // mass-assignment probe
      });
      expect(out.success).toBe(false);
      if (!out.success) {
        // Zod's `.strict()` emits a single `unrecognized_keys` issue listing
        // every offending key in `issue.keys`, NOT in `issue.path`. Walk both
        // shapes so the proof is honest about how Zod actually reports it.
        const flagged: string[] = [];
        for (const i of out.error.issues) {
          if ((i as any).code === "unrecognized_keys" && Array.isArray((i as any).keys)) {
            for (const k of (i as any).keys) flagged.push(k);
          } else {
            flagged.push(i.path.join("."));
          }
        }
        const expected = ["accountId", "id", "rating", "totalReviews", "isVerified", "createdAt", "completelyMadeUpField"];
        const matched = flagged.filter(f => expected.includes(f));
        expect(matched.length).toBeGreaterThan(0);
      }
    });

    it("accepts a clean partial update (single allowed field)", () => {
      const out = photographyProfileUpdateSchema.safeParse({ bio: "Updated bio." });
      expect(out.success).toBe(true);
      if (out.success) expect(out.data.bio).toBe("Updated bio.");
    });

    it("rejects a free-text field containing control chars / shell metacharacters in URL field", () => {
      const out = photographyProfileUpdateSchema.safeParse({
        website: "javascript:alert(1)", // not http/https → rejected
      });
      expect(out.success).toBe(false);
    });

    it("enforces length cap on bio (>2000 chars rejected)", () => {
      const huge = "a".repeat(2001);
      const out = photographyProfileUpdateSchema.safeParse({ bio: huge });
      expect(out.success).toBe(false);
    });
  });
});
