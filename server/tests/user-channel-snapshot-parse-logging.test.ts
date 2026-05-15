/**
 * F-S1 (Scraping Audit 2026-05) — assert that corrupt snapshot JSON in the
 * user-channel scraper surfaces a structured warn instead of being silently
 * swallowed. Exercises the REAL production functions `isProfileDegraded` and
 * `getPreviousSnapshot` from `server/user-channel-scraper.ts` with a mocked
 * `db` module — a regression in the production code paths fails this test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type RawRow = { id: string; snapshotData: string | null };
const dbState: { rows: RawRow[] } = { rows: [] };

/**
 * Projection-respecting mock: when the production code calls
 *   db.select({ id: ..., snapshotData: ... })
 * the returned rows include ONLY those keys. When the code calls
 *   db.select()  (no args)
 * the full row shape is returned. This catches regressions where a
 * required column is dropped from the SELECT projection — without it,
 * forensic warnings would degrade to `snapshotId=unknown` in production
 * even though tests still pass.
 */
vi.mock("../db", () => {
  let projection: Record<string, unknown> | null = null;
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      const projected: any[] = dbState.rows.map((row) => {
        if (projection === null) return { ...row };
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(projection)) {
          out[key] = (row as any)[key];
        }
        return out;
      });
      return Promise.resolve(projected);
    }),
  };
  return {
    db: {
      select: vi.fn((proj?: Record<string, unknown>) => {
        projection = proj ?? null;
        return chain;
      }),
    },
  };
});

import { isProfileDegraded, getPreviousSnapshot } from "../user-channel-scraper";

describe("F-S1: user-channel-scraper snapshot parse logging (real production paths)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    dbState.rows = [];
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("isProfileDegraded: corrupt snapshot row emits SNAPSHOT_PARSE_FAILED warn (NOT silent)", async () => {
    dbState.rows = [
      { id: "snap-1", snapshotData: '{"scrapeStatus":"FAILED"}' },
      { id: "snap-2", snapshotData: "{not valid json{" },
      { id: "snap-3", snapshotData: '{"scrapeStatus":"FAILED"}' },
    ];
    const result = await isProfileDegraded("acct-x", "camp-x", "instagram", "@x");
    expect(result).toBe(false);
    const matching = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("SNAPSHOT_PARSE_FAILED"),
    );
    expect(matching).toHaveLength(1);
    const msg = String(matching[0][0]);
    expect(msg).toContain("context=isProfileDegraded");
    expect(msg).toContain("snapshotId=snap-2");
  });

  it("isProfileDegraded: all-valid rows produce no warn", async () => {
    dbState.rows = [
      { id: "snap-1", snapshotData: '{"scrapeStatus":"FAILED"}' },
      { id: "snap-2", snapshotData: '{"scrapeStatus":"FAILED"}' },
      { id: "snap-3", snapshotData: '{"scrapeStatus":"FAILED"}' },
    ];
    const result = await isProfileDegraded("acct-x", "camp-x", "instagram", "@x");
    expect(result).toBe(true);
    const matching = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("SNAPSHOT_PARSE_FAILED"),
    );
    expect(matching).toHaveLength(0);
  });

  it("getPreviousSnapshot: corrupt JSON row emits SNAPSHOT_PARSE_FAILED warn and returns null", async () => {
    dbState.rows = [{ id: "snap-9", snapshotData: "}{garbage" }];
    const result = await getPreviousSnapshot("acct-x", "camp-x", "website", "https://x.example");
    expect(result).toBeNull();
    const matching = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("SNAPSHOT_PARSE_FAILED"),
    );
    expect(matching).toHaveLength(1);
    const msg = String(matching[0][0]);
    expect(msg).toContain("context=getPreviousSnapshot");
    expect(msg).toContain("snapshotId=snap-9");
    expect(msg).toContain("platform=website");
  });

  it("isProfileDegraded: warning carries the real snapshotId (regression — projection MUST include id)", async () => {
    // If the production SELECT projection drops `id`, the warning would
    // degrade to `snapshotId=unknown` because the projection-respecting mock
    // omits unselected fields. This test pins the operator-forensics shape.
    dbState.rows = [
      { id: "real-id-A", snapshotData: '{"scrapeStatus":"FAILED"}' },
      { id: "real-id-B", snapshotData: "broken{" },
      { id: "real-id-C", snapshotData: '{"scrapeStatus":"FAILED"}' },
    ];
    await isProfileDegraded("acct-x", "camp-x", "instagram", "@x");
    const warnMsg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(warnMsg).toContain("snapshotId=real-id-B");
    expect(warnMsg).not.toContain("snapshotId=unknown");
  });

  it("getPreviousSnapshot: valid JSON row returns parsed value with no warn", async () => {
    dbState.rows = [
      {
        id: "snap-ok",
        snapshotData: JSON.stringify({
          platform: "instagram",
          handle: "@ok",
          url: null,
          postCount: 1,
          followers: 10,
          recentPostTypes: {},
          avgEngagement: 0,
          scrapedAt: new Date().toISOString(),
          scrapeStatus: "SUCCESS",
          scrapeMode: "INCREMENTAL",
        }),
      },
    ];
    const result = await getPreviousSnapshot("acct-x", "camp-x", "instagram", "@ok");
    expect(result?.scrapeStatus).toBe("SUCCESS");
    const matching = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("SNAPSHOT_PARSE_FAILED"),
    );
    expect(matching).toHaveLength(0);
  });
});
