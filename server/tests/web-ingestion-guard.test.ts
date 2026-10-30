import { describe, it, expect } from "vitest";
import {
  isDocumentCandidateUrl,
  isDocumentContentType,
  detectBinaryContent,
  sanitizePostgresText,
  extractAnchorDocumentLinks,
  classifyCleanPageType
} from "../shared/web-ingestion-guard";

describe("Web Ingestion Guard: Asset Admission & Discovery", () => {
  const rootUrl = "https://baklawati.com.tr";

  it("rejects non-document asset extensions", () => {
    const assetUrls = [
      "https://baklawati.com.tr/images/logo.png",
      "https://baklawati.com.tr/img/hero.jpg",
      "https://baklawati.com.tr/files/photo.jpeg",
      "https://baklawati.com.tr/media/animation.gif",
      "https://baklawati.com.tr/banner.webp",
      "https://baklawati.com.tr/favicon.ico",
      "https://baklawati.com.tr/vector.svg",
      "https://baklawati.com.tr/style.css",
      "https://baklawati.com.tr/app.js",
      "https://baklawati.com.tr/bundle.mjs",
      "https://baklawati.com.tr/font.woff2",
      "https://baklawati.com.tr/brochure.pdf",
      "https://baklawati.com.tr/archive.zip",
      "https://baklawati.com.tr/feed.xml",
      "https://baklawati.com.tr/data.json"
    ];

    for (const url of assetUrls) {
      expect(isDocumentCandidateUrl(url, rootUrl), `Should reject asset URL: ${url}`).toBe(false);
    }
  });

  it("rejects asset path patterns (Shopify CDN, WordPress, bundles)", () => {
    const cdnUrls = [
      "https://baklawati.com.tr/cdn/shop/files/favicon.png?crop=center&height=32&v=1777344660&width=32",
      "https://baklawati.com.tr/cdn/shop/t/7/assets/base.css?v=52221926894388617011787579745",
      "https://baklawati.com.tr/cdn/shop/t/7/assets/component-cart-drawer.css",
      "https://baklawati.com.tr/wp-content/uploads/2026/01/pic.jpg",
      "https://baklawati.com.tr/static/js/main.chunk.js",
      "https://baklawati.com.tr/_next/static/css/styles.css",
      "https://baklawati.com.tr/dist/bundle.js"
    ];

    for (const url of cdnUrls) {
      expect(isDocumentCandidateUrl(url, rootUrl), `Should reject CDN/asset path: ${url}`).toBe(false);
    }
  });

  it("admits genuine document pages (Shopify, custom, extensionless, and query paths)", () => {
    const validPages = [
      "https://baklawati.com.tr/",
      "https://baklawati.com.tr/collections/all",
      "https://baklawati.com.tr/products/antep-fistikli-kadayifli-karisik-tatli-kutusu-400g",
      "https://baklawati.com.tr/pages/pages-hediye-olustur",
      "https://baklawati.com.tr/pages/hakkimizda",
      "https://baklawati.com.tr/pages/iletisim",
      "https://baklawati.com.tr/policies/refund-policy",
      "https://baklawati.com.tr/policies/privacy-policy",
      "https://baklawati.com.tr/cart",
      "https://baklawati.com.tr/catalog?page=2&sort=price_asc"
    ];

    for (const url of validPages) {
      expect(isDocumentCandidateUrl(url, rootUrl), `Should admit valid page: ${url}`).toBe(true);
    }
  });

  it("rejects non-HTTP protocols, javascript:, mailto:, and external domains", () => {
    expect(isDocumentCandidateUrl("javascript:void(0)", rootUrl)).toBe(false);
    expect(isDocumentCandidateUrl("mailto:info@baklawati.com.tr", rootUrl)).toBe(false);
    expect(isDocumentCandidateUrl("tel:+905551234567", rootUrl)).toBe(false);
    expect(isDocumentCandidateUrl("https://instagram.com/baklawati", rootUrl)).toBe(false);
  });
});

describe("Web Ingestion Guard: Content-Type Validation", () => {
  it("admits valid HTML document MIME types", () => {
    expect(isDocumentContentType("text/html; charset=utf-8")).toBe(true);
    expect(isDocumentContentType("text/html")).toBe(true);
    expect(isDocumentContentType("application/xhtml+xml")).toBe(true);
    expect(isDocumentContentType("TEXT/HTML; Charset=UTF-8")).toBe(true);
  });

  it("rejects image, stylesheet, script, and binary MIME types", () => {
    expect(isDocumentContentType("image/png")).toBe(false);
    expect(isDocumentContentType("image/jpeg")).toBe(false);
    expect(isDocumentContentType("image/webp")).toBe(false);
    expect(isDocumentContentType("text/css")).toBe(false);
    expect(isDocumentContentType("application/javascript")).toBe(false);
    expect(isDocumentContentType("application/pdf")).toBe(false);
    expect(isDocumentContentType("application/octet-stream")).toBe(false);
    expect(isDocumentContentType("application/json")).toBe(false);
    expect(isDocumentContentType("")).toBe(false);
    expect(isDocumentContentType(null)).toBe(false);
    expect(isDocumentContentType(undefined)).toBe(false);
  });
});

describe("Web Ingestion Guard: Binary & Null Byte Detection", () => {
  it("detects null bytes in string and buffer", () => {
    const stringWithNull = "Baklawati \u0000 Sweet Pastry";
    expect(detectBinaryContent(stringWithNull).isBinary).toBe(true);

    const bufferWithNull = Buffer.from([0x48, 0x65, 0x6C, 0x00, 0x6F]);
    expect(detectBinaryContent(bufferWithNull).isBinary).toBe(true);
  });

  it("detects PNG magic bytes", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    expect(detectBinaryContent(pngBuffer).isBinary).toBe(true);

    const pngString = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR";
    expect(detectBinaryContent(pngString).isBinary).toBe(true);
  });

  it("permits clean HTML and document text", () => {
    const cleanHtml = "<!DOCTYPE html><html><head><title>Baklawati</title></head><body><h1>Antep Fıstıklı Kadayıf</h1><p>Fiyat: 499 ₺ / Kutu</p></body></html>";
    expect(detectBinaryContent(cleanHtml).isBinary).toBe(false);

    const cleanBuffer = Buffer.from(cleanHtml, "utf-8");
    expect(detectBinaryContent(cleanBuffer).isBinary).toBe(false);
  });
});

describe("Web Ingestion Guard: PostgreSQL Text Sanitization", () => {
  it("removes null bytes completely without corrupting surrounding text", () => {
    const tainted = "Antep\u0000 Fıstıklı\u0000 Kadayıf";
    const cleaned = sanitizePostgresText(tainted);
    expect(cleaned).toBe("Antep Fıstıklı Kadayıf");
    expect(cleaned).not.toContain("\u0000");
    expect(cleaned).not.toContain("\x00");
  });

  it("strictly preserves Turkish characters, currencies, and Arabic text", () => {
    const turkishSpecialText = "Baklawati - Geleneksel Tatların Lezzet Durağı! Fiyat: 400 TL veya ₺250. Antep Fıstığı & Cevizli Baklava. Şık ve Özel Kutularında çok çeşitli özgün tatlar. Çıtır Çıtır Kadayıf, Üzüm ve İncir. (Harfler: ç ğ ı ö ş ü Ç Ğ İ Ö Ş ₺)";
    const result = sanitizePostgresText(turkishSpecialText);
    expect(result).toBe(turkishSpecialText);

    // Verify each specific Turkish character is preserved
    for (const char of ["ç", "ğ", "ı", "ö", "ş", "ü", "Ç", "Ğ", "İ", "Ö", "Ş", "₺"]) {
      expect(result).toContain(char);
    }
  });
});

describe("Web Ingestion Guard: Anchor-Only Link Extraction", () => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Baklawati</title>
      <link rel="stylesheet" href="//baklawati.com.tr/cdn/shop/t/7/assets/base.css?v=52221926" />
      <link rel="icon" type="image/png" href="//baklawati.com.tr/cdn/shop/files/favicon.png?v=17773" />
      <script src="/cdn/shop/t/7/assets/global.js"></script>
    </head>
    <body>
      <header>
        <a href="/collections/all">Tüm Ürünler</a>
        <a href="/products/antep-fistikli-kadayif">Antep Fıstıklı Kadayıf</a>
        <a href="https://baklawati.com.tr/pages/hakkimizda">Hakkımızda</a>
        <a href="/cdn/shop/files/banner.png">Banner Görüntüle</a>
      </header>
    </body>
    </html>
  `;

  it("extracts only valid document anchor links and excludes stylesheets, favicons, scripts, and asset anchors", () => {
    const links = extractAnchorDocumentLinks(html, "https://baklawati.com.tr");
    const urls = links.map(l => l.url);

    expect(urls).toContain("https://baklawati.com.tr/collections/all");
    expect(urls).toContain("https://baklawati.com.tr/products/antep-fistikli-kadayif");
    expect(urls).toContain("https://baklawati.com.tr/pages/hakkimizda");

    // Must NOT contain stylesheet or favicon links
    expect(urls.some(u => u.includes("base.css"))).toBe(false);
    expect(urls.some(u => u.includes("favicon.png"))).toBe(false);
    expect(urls.some(u => u.includes("global.js"))).toBe(false);
    expect(urls.some(u => u.includes("banner.png"))).toBe(false);
  });
});

describe("Web Ingestion Guard: Safe Page Classification", () => {
  it("never classifies Shopify CDN or asset URLs as PRODUCT", () => {
    expect(classifyCleanPageType("https://baklawati.com.tr/cdn/shop/files/favicon.png")).toBe("OTHER");
    expect(classifyCleanPageType("https://baklawati.com.tr/cdn/shop/t/7/assets/base.css")).toBe("OTHER");
    expect(classifyCleanPageType("https://baklawati.com.tr/cdn/shop/t/7/assets/component-cart-items.css")).toBe("OTHER");
  });

  it("correctly classifies genuine document URLs", () => {
    expect(classifyCleanPageType("https://baklawati.com.tr/products/antep-fistikli-kadayif")).toBe("PRODUCT");
    expect(classifyCleanPageType("https://baklawati.com.tr/urun/antep-fistikli-baklava")).toBe("PRODUCT");
    expect(classifyCleanPageType("https://baklawati.com.tr/collections/all")).toBe("CATALOG_INDEX");
    expect(classifyCleanPageType("https://baklawati.com.tr/shop")).toBe("CATALOG_INDEX");
    expect(classifyCleanPageType("https://baklawati.com.tr/pages/hakkimizda")).toBe("ABOUT");
    expect(classifyCleanPageType("https://baklawati.com.tr/policies/refund-policy")).toBe("POLICIES");
    expect(classifyCleanPageType("https://baklawati.com.tr/fiyatlandirma")).toBe("PRICING");
  });
});
