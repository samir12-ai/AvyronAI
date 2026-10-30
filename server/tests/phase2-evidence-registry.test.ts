/**
 * Phase 2 — Versioned Evidence / ID Registry Isolated Tests
 *
 * Verifies:
 * 1. Deterministic canonical content hashing (canonicalJsonStringify, computeStableContentHash).
 * 2. Canonical evidence UID formatting (EV:<kind>:<source_table>:<versionedSourceId>).
 * 3. UID decomposition / parsing (parseEvidenceUid).
 * 4. Content version immutability (same content -> same UID, changed content -> distinct UID).
 * 5. Unified evidence representation and cross-source item resolution contracts.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalJsonStringify,
  computeStableContentHash,
  canonicalEvidenceUid,
  parseEvidenceUid,
  versionedSourceId,
  evidenceUidFor,
  resolveEvidenceItemsBatch,
  resolveEvidenceItem,
  type EvidenceKind,
} from "../strategic-reasoning/evidence-registry";

describe("Phase 2: Stable Content Hashing", () => {
  it("produces identical JSON stringification regardless of object key order", () => {
    const objA = { z: 1, a: 2, m: { b: 3, a: 4 } };
    const objB = { a: 2, m: { a: 4, b: 3 }, z: 1 };

    expect(canonicalJsonStringify(objA)).toBe(canonicalJsonStringify(objB));
    expect(computeStableContentHash(objA)).toBe(computeStableContentHash(objB));
  });

  it("handles primitives, null, and arrays deterministically", () => {
    expect(computeStableContentHash("hello world")).toHaveLength(64);
    expect(computeStableContentHash(null)).toBe(computeStableContentHash(undefined));
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("trims whitespace for plain strings", () => {
    expect(computeStableContentHash("  sample text  ")).toBe(computeStableContentHash("sample text"));
  });
});

describe("Phase 2: Canonical Evidence UID Schema", () => {
  it("formats UID as EV:<kind>:<sourceTable>:<rawId>@<hash12>", () => {
    const kind: EvidenceKind = "customer_review";
    const rawId = "rev_9912";
    const text = "Outstanding packaging and quality sweet box.";

    const uid = canonicalEvidenceUid(kind, "ci_competitor_reviews", rawId, text);
    expect(uid).toMatch(/^EV:customer_review:ci_competitor_reviews:rev_9912@[a-f0-9]{12}$/);
  });

  it("supports passing existing 12-char hash directly", () => {
    const uid = canonicalEvidenceUid("social_post", "ci_competitor_posts", "post_44", "0123456789ab");
    expect(uid).toBe("EV:social_post:ci_competitor_posts:post_44@0123456789ab");
  });

  it("correctly parses valid evidence UIDs", () => {
    const uid = "EV:customer_review:ci_competitor_reviews:rev_123@abcdef012345";
    const parsed = parseEvidenceUid(uid);

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("customer_review");
    expect(parsed?.sourceTable).toBe("ci_competitor_reviews");
    expect(parsed?.sourceId).toBe("rev_123@abcdef012345");
    expect(parsed?.rawSourceId).toBe("rev_123");
    expect(parsed?.contentHash12).toBe("abcdef012345");
  });

  it("returns null for malformed or non-evidence UIDs", () => {
    expect(parseEvidenceUid("")).toBeNull();
    expect(parseEvidenceUid("NOT_AN_EV_UID")).toBeNull();
    expect(parseEvidenceUid("EV:incomplete")).toBeNull();
  });

  it("mints different UIDs when content changes for the same raw rowId", () => {
    const rawId = "snap_bu_1";
    const contentV1 = { price: 100, variant: "400g" };
    const contentV2 = { price: 120, variant: "400g" };

    const uidV1 = canonicalEvidenceUid("product_truth", "business_understanding_snapshots", rawId, contentV1);
    const uidV2 = canonicalEvidenceUid("product_truth", "business_understanding_snapshots", rawId, contentV2);

    expect(uidV1).not.toBe(uidV2);
  });

  it("remains backwards-compatible with versionedSourceId and evidenceUidFor", () => {
    const rawId = "row_789";
    const content = "Historical finding content";
    const oldVersionedId = versionedSourceId(rawId, content);
    const oldUid = evidenceUidFor("historical_finding", "history_table", oldVersionedId);

    const newUid = canonicalEvidenceUid("historical_finding", "history_table", rawId, content);
    expect(newUid).toBe(oldUid);
  });
});

describe("Phase 2: Unified Evidence Item Resolution Contract", () => {
  it("returns empty record for empty input batch", async () => {
    const res = await resolveEvidenceItemsBatch({
      accountId: "acc_mock",
      campaignId: "camp_mock",
      uids: [],
    });
    expect(res).toEqual({});
  });

  it("returns null for non-existent item in resolveEvidenceItem", async () => {
    const res = await resolveEvidenceItem({
      accountId: "acc_mock",
      campaignId: "camp_mock",
      uid: "EV:customer_review:ci_competitor_reviews:non_existent@1234567890ab",
    });
    expect(res).toBeNull();
  });
});
