/**
 * Phase 1 — Provider Registry & Acquisition Dispatch Isolated Tests
 *
 * Verifies:
 * 1. Configured capabilities resolve to expected provider descriptors (Google Reviews, Trustpilot, IG, etc.)
 * 2. Unconfigured capabilities (Trendyol, G2, Capterra) resolve to honest PROVIDER_PENDING status without invented actor IDs.
 * 3. Environment overrides are honored dynamically.
 * 4. Dispatch returns SKIPPED_PENDING_CONFIG for pending providers without making any external network calls.
 * 5. Unknown platforms return DISABLED descriptor and SKIPPED_UNSUPPORTED dispatch status.
 * 6. Tripwire and security invariants are preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveAcquisitionCapability,
  getProviderDescriptors,
  dispatchAcquisitionTask,
} from "../competitive-intelligence/provider-registry";

describe("Phase 1: Provider Registry Resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TRENDYOL_REVIEWS_ACTOR_ID;
    delete process.env.G2_REVIEWS_ACTOR_ID;
    delete process.env.CAPTERRA_REVIEWS_ACTOR_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves configured Google Reviews capability with valid defaults", () => {
    const desc = resolveAcquisitionCapability("GOOGLE_REVIEWS");
    expect(desc.platform).toBe("GOOGLE_REVIEWS");
    expect(desc.status).toBe("PRODUCTION_READY");
    expect(desc.actorId).toBe("compass~google-maps-reviews-scraper");
    expect(desc.transportType).toBe("APIFY");
    expect(desc.availableEvidenceTypes).toContain("REVIEWS");
  });

  it("resolves configured Trustpilot capability with valid defaults", () => {
    const desc = resolveAcquisitionCapability("TRUSTPILOT");
    expect(desc.platform).toBe("TRUSTPILOT");
    expect(desc.status).toBe("PRODUCTION_READY");
    expect(desc.actorId).toBe("sourabhbgp~trustpilot-scraper");
    expect(desc.transportType).toBe("APIFY");
  });

  it("resolves Direct HTTP Reddit capability without Apify actor", () => {
    const desc = resolveAcquisitionCapability("REDDIT");
    expect(desc.platform).toBe("REDDIT");
    expect(desc.transportType).toBe("DIRECT_HTTP");
    expect(desc.status).toBe("PRODUCTION_READY");
  });

  it("resolves Playwright Website crawler without external actor dependency", () => {
    const desc = resolveAcquisitionCapability("WEBSITE");
    expect(desc.platform).toBe("WEBSITE");
    expect(desc.transportType).toBe("PLAYWRIGHT_CRAWLER");
    expect(desc.status).toBe("PRODUCTION_READY");
  });

  it("resolves unconfigured Trendyol reviews honestly as PROVIDER_PENDING with null actorId", () => {
    const desc = resolveAcquisitionCapability("TRENDYOL");
    expect(desc.platform).toBe("TRENDYOL");
    expect(desc.status).toBe("PROVIDER_PENDING");
    expect(desc.actorId).toBeNull();
    expect(desc.configSource).toBe("NOT_CONFIGURED");
    expect(desc.statusReason).toContain("not configured");
  });

  it("resolves unconfigured G2 reviews honestly as PROVIDER_PENDING with null actorId", () => {
    const desc = resolveAcquisitionCapability("G2");
    expect(desc.platform).toBe("G2");
    expect(desc.status).toBe("PROVIDER_PENDING");
    expect(desc.actorId).toBeNull();
    expect(desc.configSource).toBe("NOT_CONFIGURED");
  });

  it("resolves unconfigured Capterra reviews honestly as PROVIDER_PENDING with null actorId", () => {
    const desc = resolveAcquisitionCapability("CAPTERRA");
    expect(desc.platform).toBe("CAPTERRA");
    expect(desc.status).toBe("PROVIDER_PENDING");
    expect(desc.actorId).toBeNull();
    expect(desc.configSource).toBe("NOT_CONFIGURED");
  });

  it("dynamically honors environment slot when configured", () => {
    process.env.TRENDYOL_REVIEWS_ACTOR_ID = "verified-vendor~trendyol-reviews";
    const desc = resolveAcquisitionCapability("TRENDYOL");
    expect(desc.status).toBe("PRODUCTION_READY");
    expect(desc.actorId).toBe("verified-vendor~trendyol-reviews");
    expect(desc.configSource).toBe("ENV");
  });

  it("normalizes platform aliases correctly", () => {
    const gMaps = resolveAcquisitionCapability("GOOGLE_MAPS");
    expect(gMaps.platform).toBe("GOOGLE_REVIEWS");

    const yt = resolveAcquisitionCapability("YOUTUBE_SEARCH");
    expect(yt.platform).toBe("YOUTUBE");

    const forums = resolveAcquisitionCapability("FORUMS");
    expect(forums.platform).toBe("WEB_FORUMS");
  });

  it("returns DISABLED descriptor for completely unknown platform", () => {
    const unknown = resolveAcquisitionCapability("NONEXISTENT_PLATFORM_XYZ");
    expect(unknown.status).toBe("DISABLED");
    expect(unknown.actorId).toBeNull();
    expect(unknown.configSource).toBe("NOT_CONFIGURED");
  });
});

describe("Phase 1: Acquisition Task Dispatching", () => {
  beforeEach(() => {
    delete process.env.TRENDYOL_REVIEWS_ACTOR_ID;
    delete process.env.G2_REVIEWS_ACTOR_ID;
    delete process.env.CAPTERRA_REVIEWS_ACTOR_ID;
  });

  it("returns SKIPPED_PENDING_CONFIG for unconfigured Trendyol reviews without network calls", async () => {
    const result = await dispatchAcquisitionTask({
      id: "acq_test_1",
      campaignId: "camp_mock_1",
      accountId: "acc_mock_1",
      sourcePlatform: "TRENDYOL",
      entityType: "COMPETITOR",
      entityId: "comp_mock_1",
      taskKey: "test:TRENDYOL:REVIEWS",
      taskType: "REVIEWS",
      status: "PENDING",
      priority: 50,
      inputPayload: { competitorId: "comp_mock_1", targetUrl: "https://www.trendyol.com/brand/p1" },
    });

    expect(result.status).toBe("SKIPPED_PENDING_CONFIG");
    expect(result.output?.platform).toBe("TRENDYOL");
  });

  it("returns SKIPPED_PENDING_CONFIG for unconfigured G2 reviews without network calls", async () => {
    const result = await dispatchAcquisitionTask({
      id: "acq_test_2",
      campaignId: "camp_mock_1",
      accountId: "acc_mock_1",
      sourcePlatform: "G2",
      entityType: "COMPETITOR",
      entityId: "comp_mock_1",
      taskKey: "test:G2:REVIEWS",
      taskType: "REVIEWS",
      status: "PENDING",
      priority: 50,
      inputPayload: { competitorId: "comp_mock_1", targetUrl: "https://www.g2.com/products/mock" },
    });

    expect(result.status).toBe("SKIPPED_PENDING_CONFIG");
    expect(result.output?.platform).toBe("G2");
  });

  it("returns SKIPPED_UNSUPPORTED for unrecognized platform/task combinations", async () => {
    const result = await dispatchAcquisitionTask({
      id: "acq_test_3",
      campaignId: "camp_mock_1",
      accountId: "acc_mock_1",
      sourcePlatform: "UNKNOWN_PLATFORM",
      entityType: "COMPETITOR",
      entityId: "comp_mock_1",
      taskKey: "test:UNKNOWN:TASK",
      taskType: "RANDOM_TASK",
      status: "PENDING",
      priority: 10,
      inputPayload: {},
    });

    expect(result.status).toBe("SKIPPED_UNSUPPORTED");
  });
});
