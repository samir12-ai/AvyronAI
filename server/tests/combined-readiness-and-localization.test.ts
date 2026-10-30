import { describe, it, expect } from "vitest";
import { resolveMarketLocalization } from "../shared/market-localization";
import { extractHandleFromUrl } from "../competitive-intelligence/profile-scraper";
import { computeCorpusFingerprint } from "../shared/combined-readiness";
import type { CustomerEvidenceUnit } from "../competitive-intelligence/evidence-routing";

describe("Market Localization System", () => {
  it("resolves Turkey and Türkiye to TR countryCode and tr searchLanguage", () => {
    const loc1 = resolveMarketLocalization("Turkey");
    expect(loc1.countryCode).toBe("tr");
    expect(loc1.searchLanguage).toBe("tr");

    const loc2 = resolveMarketLocalization("Türkiye");
    expect(loc2.countryCode).toBe("tr");
    expect(loc2.searchLanguage).toBe("tr");

    const loc3 = resolveMarketLocalization("TR");
    expect(loc3.countryCode).toBe("tr");
    expect(loc3.searchLanguage).toBe("tr");
  });

  it("resolves Arabic markets correctly", () => {
    const loc = resolveMarketLocalization("Saudi Arabia");
    expect(loc.countryCode).toBe("sa");
    expect(loc.searchLanguage).toBe("ar");

    const locLb = resolveMarketLocalization("Lebanon");
    expect(locLb.countryCode).toBe("lb");
    expect(locLb.searchLanguage).toBe("ar");
  });

  it("respects explicit language hints if provided", () => {
    const loc = resolveMarketLocalization("Turkey", "en");
    expect(loc.countryCode).toBe("tr");
    expect(loc.searchLanguage).toBe("en");
  });
});

describe("Handle Extraction and Reserved Paths", () => {
  it("extracts clean Instagram profile handles", () => {
    expect(extractHandleFromUrl("https://www.instagram.com/baklawati/")).toBe("baklawati");
    expect(extractHandleFromUrl("https://instagram.com/kocakbaklava?igshid=123")).toBe("kocakbaklava");
  });

  it("rejects reserved Instagram paths", () => {
    expect(extractHandleFromUrl("https://www.instagram.com/reels/DA12345/")).toBe("");
    expect(extractHandleFromUrl("https://www.instagram.com/p/C_abc123/")).toBe("");
    expect(extractHandleFromUrl("https://www.instagram.com/explore/")).toBe("");
    expect(extractHandleFromUrl("https://www.instagram.com/stories/highlights/")).toBe("");
  });

  it("extracts clean TikTok handles", () => {
    expect(extractHandleFromUrl("https://www.tiktok.com/@baklawati_official")).toBe("baklawati_official");
    expect(extractHandleFromUrl("https://tiktok.com/@hafizmustafa1864?lang=en")).toBe("hafizmustafa1864");
  });
});

describe("Corpus Fingerprinting and Pinning", () => {
  it("generates deterministic hash regardless of array ordering", () => {
    const unit1: CustomerEvidenceUnit = {
      evidenceId: "unit_001",
      origin: "COMPETITOR_COMMENT",
      platform: "instagram",
      competitorName: "Hafiz Mustafa",
      text: "Fıstıklı baklava harikaydı, tazecik geldi.",
      strategicRole: "DIRECT",
      evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
      accountId: "acc_test",
      campaignId: "camp_test",
      authorType: "CUSTOMER",
    };

    const unit2: CustomerEvidenceUnit = {
      evidenceId: "unit_002",
      origin: "MARKET_VOICE",
      platform: "web_community",
      competitorName: "Karaköy Güllüoğlu",
      text: "Antep fıstıklı kadayıf kutusu sipariş ettim çok beğendim.",
      strategicRole: "DIRECT",
      evidencePool: "PRIMARY_MARKET_VOICE",
      accountId: "acc_test",
      campaignId: "camp_test",
      authorType: "CUSTOMER",
    };

    const fp1 = computeCorpusFingerprint([unit1, unit2]);
    const fp2 = computeCorpusFingerprint([unit2, unit1]);

    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // sha256 hex length
  });
});
