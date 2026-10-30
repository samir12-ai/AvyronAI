import { describe, it, expect } from "vitest";
import { assessDiscoverySourceDiversity } from "../market-voice/pipeline";

describe("Market Voice Discovery Source-Diversity Guard", () => {
  it("flags discovery results dominated by commercial and catalog URLs as LOW_DIVERSITY", () => {
    const commercialDominated = [
      { url: "https://www.asos.com/us/women/dresses/cat/?cid=8799", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.modanisa.com/en/dresses.html", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.amazon.com/dp/B08XYZ1234", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://shop.nordstrom.com/c/women-dresses", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.zara.com/us/en/woman-dresses-l1064.html", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.reddit.com/r/ModestDress/comments/xyz123/summer_fabrics", sourcePlatform: "reddit", discoveredType: "FORUM_THREAD" },
    ];

    const report = assessDiscoverySourceDiversity(commercialDominated);
    expect(report.isLowDiversity).toBe(true);
    expect(report.customerVoiceUrlCount).toBe(1);
    expect(report.customerVoiceDomainCount).toBe(1);
    expect(report.commercialUrlCount).toBeGreaterThanOrEqual(4);
    expect(report.summary).toContain("Commercial-heavy discovery yield");
  });

  it("approves healthy balanced multi-source customer voice discovery", () => {
    const diverseCustomerVoice = [
      { url: "https://www.reddit.com/r/ModestDress/comments/abc/summer_fabrics", sourcePlatform: "reddit", discoveredType: "FORUM_THREAD" },
      { url: "https://www.reddit.com/r/femalefashionadvice/comments/def/modest_summer_options", sourcePlatform: "reddit", discoveredType: "FORUM_THREAD" },
      { url: "https://community.whattoexpect.com/forums/modest-maternity-dresses-thread-123.html", sourcePlatform: "web_community", discoveredType: "FORUM_THREAD" },
      { url: "https://www.trustpilot.com/review/modestfashionbrand.com", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.quora.com/What-are-the-most-breathable-fabrics-for-modest-dresses", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.modanisa.com/en/dresses.html", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
    ];

    const report = assessDiscoverySourceDiversity(diverseCustomerVoice);
    expect(report.isLowDiversity).toBe(false);
    expect(report.customerVoiceUrlCount).toBe(5);
    expect(report.customerVoiceDomainCount).toBeGreaterThanOrEqual(3);
    expect(report.customerVoiceRatio).toBeGreaterThan(0.5);
  });

  it("flags single-thread concentration when all customer voice is from a single URL/domain", () => {
    const singleSourceConcentrated = [
      { url: "https://www.reddit.com/r/ModestDress/comments/123/dress_recommendations", sourcePlatform: "reddit", discoveredType: "FORUM_THREAD" },
      { url: "https://www.reddit.com/r/ModestDress/comments/123/dress_recommendations", sourcePlatform: "reddit", discoveredType: "FORUM_THREAD" },
      { url: "https://www.asos.com/category/dresses", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.nordstrom.com/shop/dresses", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.shein.com/women-dresses", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
      { url: "https://www.zara.com/dresses", sourcePlatform: "google_serp", discoveredType: "WEB_PAGE" },
    ];

    const report = assessDiscoverySourceDiversity(singleSourceConcentrated);
    expect(report.isLowDiversity).toBe(true);
    expect(report.customerVoiceDomainCount).toBe(1);
  });
});
