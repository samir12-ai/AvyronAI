/**
 * P-6.12 regression — Apify PROVIDER errors must never classify as an
 * Instagram platform block (GENUINE_BLOCK). An "Apify API 403" on a bad or
 * expired token says nothing about the target platform; misclassifying it
 * stamps a false 24h BLOCKED_BY_PLATFORM cooldown that suppresses healthy
 * retries. See instagram-provider.ts catch block.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const scrapeMock = vi.fn();
vi.mock("../competitive-intelligence/instagram-apify-scraper", () => ({
  scrapeInstagramViaApify: (...args: unknown[]) => scrapeMock(...args),
  isInstagramApifyConfigured: () => true,
}));

import { scrapeInstagramForCompetitor } from "../competitive-intelligence/instagram-provider";
import { classifyScrapeFailure } from "../competitive-intelligence/profile-scraper";

beforeEach(() => {
  scrapeMock.mockReset();
});

describe("P-6.12 — Apify provider errors are never platform blocks", () => {
  it.each([
    ["Apify API 403: insufficient permissions or invalid token"],
    ["Apify API 401: authentication required"],
    ["Apify API 429: rate limited"],
    ["BREAKER_OPEN: apify:default (consecutive failures)"],
    ["Apify run abc123 (ig-profile) ended with status: FAILED"],
    ["Apify run abc123 (ig-profile) exceeded 120s budget"],
    ["APIFY_API_KEY not configured"],
  ])("%s → TRANSIENT, never GENUINE_BLOCK", async (providerError) => {
    scrapeMock.mockRejectedValueOnce(new Error(providerError));
    const result = await scrapeInstagramForCompetitor("someburger", 12, "acct-1");
    expect(result.success).toBe(false);
    expect(result.failureClass).toBe("TRANSIENT");
    expect(result.failureClass).not.toBe("GENUINE_BLOCK");
  });

  it("sanitizes 403/429 tokens out of warnings so substring block-detectors cannot misread them", async () => {
    scrapeMock.mockRejectedValueOnce(new Error("Apify API 403: bad token (rate limited)"));
    const result = await scrapeInstagramForCompetitor("someburger", 12, "acct-1");
    const joined = result.warnings.join(" | ");
    expect(joined).not.toMatch(/\b403\b/);
    expect(joined).not.toMatch(/rate.?limit/i);
    expect(joined).toContain("4xx");
  });

  it("non-provider-shaped block signals still classify as GENUINE_BLOCK (guard is narrow)", async () => {
    // Sanity: the guard must not blanket-suppress genuine target-platform
    // block signals that surface without a provider prefix.
    expect(classifyScrapeFailure("login_required")).toBe("GENUINE_BLOCK");
    expect(classifyScrapeFailure("challenge_required checkpoint")).toBe("GENUINE_BLOCK");
    scrapeMock.mockRejectedValueOnce(new Error("login_required: challenge presented"));
    const result = await scrapeInstagramForCompetitor("someburger", 12, "acct-1");
    expect(result.failureClass).toBe("GENUINE_BLOCK");
  });
});
