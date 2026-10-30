/**
 * Shared Web Ingestion Guard
 *
 * Systemic protection across all first-party and competitor crawlers:
 * 1. URL admission & discovery (anchor-only extraction, asset extension/path exclusion)
 * 2. HTTP Content-Type validation (HTML documents only)
 * 3. Binary & null-byte payload detection (magic bytes, null-byte checks)
 * 4. PostgreSQL text sanitization (removes \u0000 while preserving all valid Unicode/Turkish/currencies)
 * 5. Safe page classification without CDN/asset false positives
 */

export interface BinaryCheckResult {
  isBinary: boolean;
  reason?: string;
}

export type PageTypeCategory =
  | "HOME"
  | "PRODUCT"
  | "FEATURES"
  | "SOLUTIONS"
  | "PRICING"
  | "INTEGRATIONS"
  | "USE_CASE"
  | "HOW_IT_WORKS"
  | "CUSTOMER"
  | "CASE_STUDY"
  | "ABOUT"
  | "DOCS"
  | "POLICIES"
  | "CATALOG_INDEX"
  | "OTHER";

// Extensions that represent non-document static assets
const BANNED_EXTENSIONS = new Set([
  // Images
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tiff", "tif", "avif", "heic", "heif",
  // Stylesheets & CSS
  "css", "scss", "sass", "less",
  // Scripts & Code
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "map", "wasm",
  // Fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // Audio & Video
  "mp4", "webm", "avi", "mov", "mkv", "flv", "wmv", "mp3", "wav", "ogg", "m4a", "aac", "flac",
  // Documents & Archives
  "pdf", "zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz", "exe", "dmg", "pkg", "deb", "rpm", "iso", "bin",
  // Data files & Feeds
  "xml", "json", "csv", "tsv", "rss", "atom", "yaml", "yml"
]);

// Path segments that represent asset directories, CDNs, or static bundle locations
const BANNED_PATH_PATTERNS = [
  /\/cdn\//i,
  /\/cdn-cgi\//i,
  /\/assets\//i,
  /\/static\//i,
  /\/dist\//i,
  /\/build\//i,
  /\/bundles\//i,
  /\/wp-content\//i,
  /\/wp-includes\//i,
  /\/_next\//i,
  /\/_nuxt\//i,
  /\/vendor\//i,
  /\/chunks\//i,
  /\/node_modules\//i,
  /\/shopify-assets\//i,
];

/**
 * Validates whether a URL is a legitimate document candidate for crawling.
 * Rejects assets, CDN paths, non-HTTP schemes, cross-host URLs, etc.
 */
export function isDocumentCandidateUrl(urlStr: string, rootUrl?: string): boolean {
  if (!urlStr || typeof urlStr !== "string") return false;

  const trimmed = urlStr.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("javascript:") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, rootUrl);
  } catch {
    return false;
  }

  // Scheme check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // Host match check if rootUrl provided
  if (rootUrl) {
    try {
      const rootParsed = new URL(rootUrl);
      const rootHost = rootParsed.hostname.replace(/^www\./, "").toLowerCase();
      const candHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
      if (rootHost !== candHost) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const pathname = parsed.pathname;

  // Check path patterns
  for (const pattern of BANNED_PATH_PATTERNS) {
    if (pattern.test(pathname)) {
      return false;
    }
  }

  // Check file extension on the pathname
  const lastSlashIndex = pathname.lastIndexOf("/");
  const lastSegment = lastSlashIndex !== -1 ? pathname.slice(lastSlashIndex + 1) : pathname;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex !== -1 && dotIndex !== 0) {
    const ext = lastSegment.slice(dotIndex + 1).toLowerCase();
    if (BANNED_EXTENSIONS.has(ext)) {
      return false;
    }
  }

  return true;
}

/**
 * Validates the response Content-Type header.
 * Strictly admits only document MIME types (text/html, application/xhtml+xml).
 */
export function isDocumentContentType(contentTypeHeader: string | null | undefined): boolean {
  if (!contentTypeHeader) return false;
  const normalized = contentTypeHeader.toLowerCase().trim();
  const mime = normalized.split(";")[0].trim();
  return mime === "text/html" || mime === "application/xhtml+xml";
}

/**
 * Inspects a Buffer or string for binary data, magic bytes, and null bytes.
 * Never allows binary payload to enter the text extraction pipeline.
 */
export function detectBinaryContent(content: Buffer | string): BinaryCheckResult {
  if (!content) return { isBinary: false };

  if (Buffer.isBuffer(content)) {
    if (content.length === 0) return { isBinary: false };

    // 1. Check for null bytes in buffer
    if (content.includes(0x00)) {
      return { isBinary: true, reason: "CONTAINS_NULL_BYTES" };
    }

    // 2. Check known binary magic numbers
    // PNG: \x89PNG\r\n\x1a\n
    if (content.length >= 8 && content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4E && content[3] === 0x47) {
      return { isBinary: true, reason: "PNG_MAGIC_BYTES" };
    }
    // GIF: GIF87a or GIF89a
    if (content.length >= 6 && content.toString("ascii", 0, 3) === "GIF") {
      return { isBinary: true, reason: "GIF_MAGIC_BYTES" };
    }
    // JPEG: \xFF\xD8\xFF
    if (content.length >= 3 && content[0] === 0xFF && content[1] === 0xD8 && content[2] === 0xFF) {
      return { isBinary: true, reason: "JPEG_MAGIC_BYTES" };
    }
    // PDF: %PDF-
    if (content.length >= 5 && content.toString("ascii", 0, 5) === "%PDF-") {
      return { isBinary: true, reason: "PDF_MAGIC_BYTES" };
    }
    // ZIP: PK\x03\x04
    if (content.length >= 4 && content[0] === 0x50 && content[1] === 0x4B && content[2] === 0x03 && content[3] === 0x04) {
      return { isBinary: true, reason: "ZIP_MAGIC_BYTES" };
    }
    // WOFF / WOFF2
    if (content.length >= 4) {
      const tag = content.toString("ascii", 0, 4);
      if (tag === "wOFF" || tag === "wOF2") {
        return { isBinary: true, reason: "FONT_MAGIC_BYTES" };
      }
    }

    // 3. Control byte frequency in first 1024 bytes
    const checkLen = Math.min(content.length, 1024);
    let controlBytes = 0;
    for (let i = 0; i < checkLen; i++) {
      const byte = content[i];
      // Allowed whitespace: 0x09 (tab), 0x0A (LF), 0x0D (CR)
      if (byte < 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
        controlBytes++;
      }
    }
    if (controlBytes / checkLen > 0.05) {
      return { isBinary: true, reason: "EXCESSIVE_CONTROL_BYTES" };
    }

    return { isBinary: false };
  }

  // String inspection
  const str = content;
  if (str.length === 0) return { isBinary: false };

  // Null byte check
  if (str.includes("\u0000") || str.includes("\x00")) {
    return { isBinary: true, reason: "CONTAINS_NULL_BYTES" };
  }

  // Magic byte checks in string
  if (str.startsWith("\x89PNG") || str.startsWith("GIF8") || str.startsWith("%PDF-") || str.startsWith("PK\x03\x04")) {
    return { isBinary: true, reason: "MAGIC_BYTES_IN_STRING" };
  }

  // Control character check on initial snippet (excluding \t, \n, \r)
  const sample = str.slice(0, 1024);
  const controlMatches = sample.match(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g);
  if (controlMatches && controlMatches.length / sample.length > 0.05) {
    return { isBinary: true, reason: "EXCESSIVE_CONTROL_CHARACTERS" };
  }

  return { isBinary: false };
}

/**
 * Sanitizes a string for safe PostgreSQL jsonb and text storage.
 * - Strips all \u0000 / \x00 null characters (strictly illegal in Postgres).
 * - Strips lone UTF-16 surrogates if present.
 * - STAGGERINGLY CRITICAL: Preserves ALL valid Unicode characters, Turkish diacritics
 *   (ı, İ, ç, ö, ü, ğ, ş, Ç, Ğ, Ö, Ş), Arabic, Japanese, emojis, and currency symbols (₺, TL, $, €).
 */
export function sanitizePostgresText(text: string): string {
  if (!text || typeof text !== "string") return "";

  // 1. Strip null bytes
  let sanitized = text.replace(/\u0000/g, "").replace(/\x00/g, "");

  // 2. Ensure surrogate pairs are well-formed (Node 20+ supports toWellFormed)
  if (typeof (sanitized as any).toWellFormed === "function") {
    sanitized = (sanitized as any).toWellFormed();
  } else {
    // Regex fallback for unpaired surrogates
    sanitized = sanitized.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  }

  return sanitized;
}

/**
 * Normalizes a document candidate URL by stripping URL fragments (#hash)
 * so that in-page anchor links (e.g. /#pricing and /) resolve to the same canonical document URL.
 */
export function normalizeDocumentUrl(
  urlStr: string,
  baseUrl?: string
): { canonicalUrl: string; fragment?: string } | null {
  if (!urlStr || typeof urlStr !== "string") return null;
  const trimmed = urlStr.trim();
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return null;
  }
  if (trimmed.startsWith("#")) {
    if (!baseUrl) return null;
    try {
      const parsedBase = new URL(baseUrl);
      const fragment = trimmed.replace(/^#/, "").trim() || undefined;
      parsedBase.hash = "";
      if (!parsedBase.pathname) parsedBase.pathname = "/";
      if (parsedBase.pathname.length > 1 && parsedBase.pathname.endsWith("/")) {
        parsedBase.pathname = parsedBase.pathname.replace(/\/+$/, "");
      }
      return {
        canonicalUrl: parsedBase.toString(),
        fragment,
      };
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(trimmed, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const fragment = parsed.hash ? parsed.hash.replace(/^#/, "").trim() : undefined;
    parsed.hash = "";
    // Strip tracking query params (utm_*, fbclid, gclid)
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }
    // Normalize trailing slash on paths
    if (!parsed.pathname) {
      parsed.pathname = "/";
    } else if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return {
      canonicalUrl: parsed.toString(),
      fragment: fragment || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts candidate document links strictly from anchor tags (<a>).
 * Explicitly ignores <link>, <script>, <style>, <img src>, etc.
 * Deduplicates fragment URLs that resolve to the same HTTP document.
 */
export function extractAnchorDocumentLinks(
  html: string,
  baseUrl: string
): Array<{ url: string; anchorText: string; fragment?: string }> {
  if (!html || typeof html !== "string") return [];

  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results: Array<{ url: string; anchorText: string; fragment?: string }> = [];
  const seenUrls = new Set<string>();

  let baseCanonical = "";
  try {
    const normBase = normalizeDocumentUrl(baseUrl);
    baseCanonical = normBase ? normBase.canonicalUrl : baseUrl;
  } catch {}

  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = match[1];
    const rawAnchorText = match[2];

    if (!rawHref) continue;

    const normalized = normalizeDocumentUrl(rawHref, baseUrl);
    if (!normalized) continue;

    const { canonicalUrl, fragment } = normalized;
    if (canonicalUrl === baseCanonical || seenUrls.has(canonicalUrl)) {
      continue;
    }

    if (isDocumentCandidateUrl(canonicalUrl, baseUrl)) {
      seenUrls.add(canonicalUrl);
      const cleanAnchor = rawAnchorText
        ? rawAnchorText
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, " ")
            .trim()
        : "";

      results.push({
        url: canonicalUrl,
        anchorText: sanitizePostgresText(cleanAnchor),
        fragment,
      });
    }
  }

  return results;
}

/**
 * Classifies page types for document URLs only.
 * Guaranteed never to classify asset or CDN paths as PRODUCT or other pages.
 */
export function classifyCleanPageType(
  urlStr: string,
  anchorText?: string,
  pageTitle?: string
): PageTypeCategory {
  if (!isDocumentCandidateUrl(urlStr)) {
    return "OTHER";
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return "OTHER";
  }

  const pathname = parsed.pathname.toLowerCase();
  const context = `${pathname} ${(anchorText || "").toLowerCase()} ${(pageTitle || "").toLowerCase()}`;

  // 1. Pricing / Plans / Paketler
  if (
    pathname.includes("/pricing") ||
    pathname.includes("/plans") ||
    pathname.includes("/packages") ||
    pathname.includes("/fiyat") ||
    pathname.includes("/paketler") ||
    context.includes("pricing") ||
    context.includes("fiyatlandırma")
  ) {
    return "PRICING";
  }

  // 2. Policies / Legal / Terms / Rights / Delivery / Refund / FAQ
  if (
    pathname.includes("/policies") ||
    pathname.includes("/policy") ||
    pathname.includes("/refund") ||
    pathname.includes("/returns") ||
    pathname.includes("/privacy") ||
    pathname.includes("/terms") ||
    pathname.includes("/shipping") ||
    pathname.includes("/delivery") ||
    pathname.includes("/rights") ||
    pathname.includes("/usage-rights") ||
    pathname.includes("/licensing") ||
    pathname.includes("/license") ||
    pathname.includes("/guarantee") ||
    pathname.includes("/faq") ||
    pathname.includes("/iade") ||
    pathname.includes("/gizlilik") ||
    pathname.includes("/teslimat") ||
    pathname.includes("/mesafeli-satis") ||
    pathname.includes("/kvkk") ||
    pathname.includes("/cerez")
  ) {
    return "POLICIES";
  }

  // 3. About / Company / Hakkımızda
  if (
    pathname.includes("/about") ||
    pathname.includes("/company") ||
    pathname.includes("/story") ||
    pathname.includes("/who-we-are") ||
    pathname.includes("/hakkimizda") ||
    pathname.includes("/hakkinda") ||
    pathname.includes("/biz-kimiz") ||
    pathname.includes("/iletisim") ||
    pathname.includes("/contact")
  ) {
    return "ABOUT";
  }

  // 4. Features / Capabilities
  if (
    pathname.includes("/feature") ||
    pathname.includes("/capability") ||
    pathname.includes("/ozellik")
  ) {
    return "FEATURES";
  }

  // 5. Individual Product / Ürün (explicit product routes, not static assets)
  if (
    pathname.startsWith("/products/") ||
    pathname.startsWith("/product/") ||
    pathname.startsWith("/urun/") ||
    pathname.startsWith("/urunler/") ||
    pathname.startsWith("/item/") ||
    pathname.startsWith("/p/") ||
    /\/(product|products|urun|urunler)\/[^/]+/i.test(pathname)
  ) {
    return "PRODUCT";
  }

  // 6. Catalog Index / Collections / Categories
  if (
    pathname === "/collections" ||
    pathname.startsWith("/collections/") ||
    pathname === "/categories" ||
    pathname.startsWith("/category/") ||
    pathname.startsWith("/categories/") ||
    pathname.startsWith("/kategori/") ||
    pathname.startsWith("/kategoriler/") ||
    pathname === "/catalog" ||
    pathname.startsWith("/catalog/") ||
    pathname === "/shop" ||
    pathname.startsWith("/shop/") ||
    pathname === "/magaza" ||
    pathname.startsWith("/magaza/")
  ) {
    return "CATALOG_INDEX";
  }

  // 7. Solutions / Partnerships / B2B / Use cases / Help Centre
  if (
    pathname.includes("/solution") ||
    pathname.includes("/cozumler") ||
    pathname.includes("/partner") ||
    pathname.includes("/b2b") ||
    pathname.includes("/corporate") ||
    pathname.includes("/enterprise") ||
    pathname.includes("/white-label") ||
    pathname.includes("/wholesale") ||
    context.includes("partner") ||
    context.includes("for business")
  ) {
    return "SOLUTIONS";
  }
  if (pathname.includes("/integration") || pathname.includes("/entegrasyon")) return "INTEGRATIONS";
  if (pathname.includes("/use-case") || pathname.includes("/industry") || pathname.includes("/occasion")) return "USE_CASE";
  if (pathname.includes("/how-it-works") || pathname.includes("/nasil-calisir") || pathname.includes("/usage")) return "HOW_IT_WORKS";
  if (pathname.includes("/customer") || pathname.includes("/case-stud") || pathname.includes("/musteriler") || pathname.includes("/review")) return "CASE_STUDY";
  if (
    pathname.includes("/docs") ||
    pathname.includes("/documentation") ||
    pathname.includes("/help-centre") ||
    pathname.includes("/help-center") ||
    pathname.includes("/help") ||
    pathname.includes("/support") ||
    pathname.includes("/knowledge")
  ) {
    return "DOCS";
  }

  return "OTHER";
}

