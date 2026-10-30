import "dotenv/config";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWebsiteCrawler } from "../business-understanding/crawler";
import { db } from "../db";
import { websiteSnapshots } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";

describe("Setup Website Ingestion: Crawler Pipeline Hardening", () => {
  let accountId: string;
  let campaignId: string;
  let snapshotId: string;

  beforeEach(async () => {
    accountId = `test_acc_${uuidv4().slice(0, 8)}`;
    campaignId = `test_camp_${uuidv4().slice(0, 8)}`;
    snapshotId = uuidv4();

    // Insert snapshot row upfront as expected by the crawler
    await db.insert(websiteSnapshots).values({
      id: snapshotId,
      accountId,
      campaignId,
      rootUrl: "https://example-baklava.com",
      pagesCrawled: [],
      contentHash: "",
      status: "RUNNING"
    });
  });

  it("never ingests non-document asset links or binary content into pagesCrawled", async () => {
    // Mock global fetch to return HTML with both valid anchors and dangerous asset/link tags
    const mockHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Geleneksel Tatlar | Baklava</title>
        <link rel="stylesheet" href="https://example-baklava.com/cdn/shop/t/7/assets/base.css?v=123" />
        <link rel="icon" type="image/png" href="https://example-baklava.com/cdn/shop/files/favicon.png?v=456" />
      </head>
      <body>
        <h1>En Lezzetli Antep Fıstıklı Baklavalar</h1>
        <p>Geleneksel tariflerle hazırlanan çıtır lezzetler. Fiyat: 550 ₺.</p>
        <a href="https://example-baklava.com/products/antep-fistikli-baklava">Antep Fıstıklı Baklava</a>
        <a href="https://example-baklava.com/collections/tatlilar">Tatlı Koleksiyonu</a>
        <a href="https://example-baklava.com/cdn/shop/files/product-image.png">Resim</a>
      </body>
      </html>
    `;

    const productHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Antep Fıstıklı Baklava</title></head>
      <body>
        <h1>Antep Fıstıklı Baklava</h1>
        <p>1. Kalite Gaziantep fıstığı ile hazırlanmıştır. Fiyat: 550 TL.</p>
      </body>
      </html>
    `;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/products/antep-fistikli-baklava")) {
        return new Response(productHtml, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      if (url.includes("/cdn/shop") || url.endsWith(".png") || url.endsWith(".css")) {
        // Return binary PNG simulation
        return new Response(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x01]), {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      return new Response(mockHtml, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }) as any;

    try {
      const pages = await runWebsiteCrawler(snapshotId, "https://example-baklava.com", 3);

      expect(pages.length).toBeGreaterThanOrEqual(1);

      // Verify no page is a CDN or asset URL
      for (const p of pages) {
        expect(p.sourceUrl).not.toContain("/cdn/shop");
        expect(p.sourceUrl).not.toContain("base.css");
        expect(p.sourceUrl).not.toContain("favicon.png");
        expect(p.sourceUrl).not.toContain("product-image.png");

        // Verify cleanedText has NO null bytes
        expect(p.cleanedText).not.toContain("\u0000");
        expect(p.cleanedText).not.toContain("\x00");

        // Verify Turkish text is preserved
        if (p.sourceUrl.includes("/products/antep-fistikli-baklava")) {
          expect(p.cleanedText).toContain("Antep Fıstıklı Baklava");
          expect(p.cleanedText).toContain("Gaziantep fıstığı");
        }
      }

      // Verify database record was updated with COMPLETE status
      const [snap] = await db
        .select()
        .from(websiteSnapshots)
        .where(eq(websiteSnapshots.id, snapshotId))
        .limit(1);

      expect(snap).toBeDefined();
      expect(snap.status).toBe("COMPLETE");
      expect(snap.pagesCrawled).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles empty or offline crawl gracefully with fallback evidence and no crashes", async () => {
    const offlineSnapId = uuidv4();
    await db.insert(websiteSnapshots).values({
      id: offlineSnapId,
      accountId,
      campaignId,
      rootUrl: "https://offline-test-site.com",
      pagesCrawled: [],
      contentHash: "",
      status: "RUNNING"
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND offline-test-site.com");
    }) as any;

    try {
      const pages = await runWebsiteCrawler(offlineSnapId, "https://offline-test-site.com", 3);
      expect(pages.length).toBe(1);
      expect(pages[0].pageType).toBe("HOME");
      expect(pages[0].cleanedText).toContain("Official business domain");

      const [snap] = await db
        .select()
        .from(websiteSnapshots)
        .where(eq(websiteSnapshots.id, offlineSnapId))
        .limit(1);

      expect(snap.status).toBe("COMPLETE");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("analyzeCompanyWebsite handles catalogue extraction safely without asset-derived items", async () => {
    const { analyzeCompanyWebsite } = await import("../setup/website-analyzer");

    const homeHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Baklawati Tatlıları</title></head>
      <body>
        <h1>Baklawati Geleneksel Tatlar</h1>
        <p>Baklava ve Kadayıf çeşitleri ile hizmetinizdeyiz.</p>
        <a href="https://example-baklava-shop.com/products/fistikli-saray-sarma">Fıstıklı Saray Sarma</a>
      </body>
      </html>
    `;
    const prodHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Fıstıklı Saray Sarma - Baklawati</title></head>
      <body>
        <h1>Fıstıklı Saray Sarma</h1>
        <p>Özel Antep fıstıklı geleneksel lezzet. Fiyat: 600 TL.</p>
      </body>
      </html>
    `;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/products/fistikli-saray-sarma")) {
        return new Response(prodHtml, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      return new Response(homeHtml, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }) as any;

    try {
      const analysis = await analyzeCompanyWebsite(accountId, campaignId, "https://example-baklava-shop.com");
      expect(analysis.companyName).toBeDefined();
      expect(analysis.websiteUrl).toBe("https://example-baklava-shop.com");
      expect(analysis.productCatalogue).toBeDefined();

      // Ensure no asset filenames become products
      for (const prod of analysis.productCatalogue) {
        expect(prod.name).not.toMatch(/\.(png|jpg|jpeg|css|js|ico)$/i);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
