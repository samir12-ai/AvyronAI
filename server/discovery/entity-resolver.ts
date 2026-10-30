/**
 * Canonical Entity Resolver & Deduplicator for Discovered Competitor Candidates.
 *
 * Requirements:
 * 1. Collapse multi-storefront / ccTLD domains of a single commercial brand (e.g. ubuy.tl, ubuy.ec -> Ubuy)
 *    into a single canonical candidate entity holding multiple storefront URLs.
 * 2. Preserve distinct commercial businesses even if they share common industry/category keywords
 *    (e.g., "Gaziantepli Baklavacı" vs "Gazişehir Baklava").
 * 3. Deterministic canonicalEntityId generation.
 */

import { DiscoveredCompetitorCandidate, CompetitorStorefront } from "../../shared/contracts/discovery-contracts";

// Common 2-level ccTLD public suffixes to accurately extract root domain name
const TWO_PART_SUFFIXES = new Set([
  "com.tr", "org.tr", "net.tr", "gen.tr", "biz.tr", "av.tr",
  "co.uk", "org.uk", "me.uk", "ltd.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "net.nz", "org.nz",
  "co.za", "net.za", "org.za",
  "com.br", "net.br",
  "com.mx", "org.mx",
  "co.jp", "ne.jp",
  "com.sg", "edu.sg",
  "com.my", "org.my",
  "com.ar", "com.co", "com.eg", "com.sa"
]);

/**
 * Extracts app-store or marketplace product listing identity if the URL is a specific app listing.
 * Preserves full app listing URL and prevents collapsing to the platform root domain (e.g. apps.apple.com).
 */
export function extractAppListingIdentity(urlOrHost: string): {
  isAppListing: boolean;
  canonicalListingUrl?: string;
  listingKey?: string;
  brandToken?: string;
} {
  const raw = (urlOrHost || "").trim();
  if (!raw) return { isAppListing: false };
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

    // Apple App Store listing: apps.apple.com/{country}/app/{slug}/id{digits} or apps.apple.com/app/id{digits}
    if (host === "apps.apple.com" || host === "itunes.apple.com") {
      const idMatch = parsed.pathname.match(/\/id(\d+)/i);
      const appSlugMatch = parsed.pathname.match(/\/app\/([^/]+)\/id(\d+)/i) || parsed.pathname.match(/\/app\/([^/]+)/i);
      if (idMatch || appSlugMatch) {
        const cleanPath = parsed.pathname.replace(/\/+$/, "");
        const canonicalListingUrl = `https://${host}${cleanPath}`;
        const listingKey = `${host}${cleanPath.toLowerCase()}`;
        const slugPart = appSlugMatch?.[1] ? appSlugMatch[1].toLowerCase().replace(/[^a-z0-9]/g, "") : "";
        const idPart = idMatch?.[1] ? `id${idMatch[1]}` : "";
        const brandToken = slugPart ? `${slugPart}_${idPart || "ios"}` : `appleapp_${idPart}`;
        return {
          isAppListing: true,
          canonicalListingUrl,
          listingKey,
          brandToken,
        };
      }
    }

    // Google Play Store listing: play.google.com/store/apps/details?id={package}
    if (host === "play.google.com" && parsed.pathname.includes("/store/apps/details")) {
      const pkgId = parsed.searchParams.get("id");
      if (pkgId && pkgId.trim()) {
        const cleanPkg = pkgId.trim();
        const canonicalListingUrl = `https://play.google.com/store/apps/details?id=${cleanPkg}`;
        const listingKey = `play.google.com/store/apps/details?id=${cleanPkg.toLowerCase()}`;
        const brandToken = `gplay_${cleanPkg.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
        return {
          isAppListing: true,
          canonicalListingUrl,
          listingKey,
          brandToken,
        };
      }
    }
  } catch {
    // ignore invalid URL
  }
  return { isAppListing: false };
}

/**
 * Extracts root brand token and base domain from a hostname or URL.
 * e.g.:
 *   "ubuy.tl" -> { brandToken: "ubuy", baseDomain: "ubuy.tl" }
 *   "www.ubuy.com.tr" -> { brandToken: "ubuy", baseDomain: "ubuy.com.tr" }
 *   "store.gazianteplibaklavaci.com" -> { brandToken: "gazianteplibaklavaci", baseDomain: "gazianteplibaklavaci.com" }
 *   "https://apps.apple.com/gb/app/ai-song-maker-songsnap-music/id6749816117" -> preserves app listing identity
 */
export function extractBrandEntityInfo(hostnameOrUrl: string): { brandToken: string; baseDomain: string } {
  const appListing = extractAppListingIdentity(hostnameOrUrl);
  if (appListing.isAppListing && appListing.brandToken && appListing.listingKey) {
    return {
      brandToken: appListing.brandToken,
      baseDomain: appListing.listingKey,
    };
  }

  let host = hostnameOrUrl.trim().toLowerCase();
  try {
    if (host.includes("://")) {
      host = new URL(host).hostname;
    } else if (host.includes("/")) {
      host = new URL(`https://${host}`).hostname;
    }
  } catch {
    // raw hostname
  }

  // Remove port and www
  host = host.split(":")[0].replace(/^www\./, "");

  const parts = host.split(".");
  if (parts.length <= 1) {
    return { brandToken: host, baseDomain: host };
  }

  // Check 2-part suffix like "com.tr"
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join(".");
    if (TWO_PART_SUFFIXES.has(lastTwo)) {
      const brandToken = parts[parts.length - 3];
      const baseDomain = parts.slice(-3).join(".");
      return { brandToken, baseDomain };
    }
  }

  // Standard 1-part suffix like ".com", ".tl", ".ec", ".de"
  const brandToken = parts[parts.length - 2];
  const baseDomain = parts.slice(-2).join(".");
  return { brandToken, baseDomain };
}

/**
 * Deterministic canonical entity ID generation.
 * e.g. "ubuy" -> "ent_ubuy"
 * e.g. "gaziantepli baklavacı" -> "ent_gazianteplibaklavaci"
 */
export function generateCanonicalEntityId(nameOrToken: string): string {
  const normalized = nameOrToken
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics (e.g. ı -> i, ç -> c)
    .replace(/[^a-z0-9]/g, "");
  return `ent_${normalized || "unknown"}`;
}

/**
 * Normalizes a brand name for entity comparison.
 */
export function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(inc|ltd|llc|gmbh|as|a\.s\.|sti|s\.t\.i\.|co|corp)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Resolves and deduplicates candidates into canonical commercial entities.
 * Multi-storefront / ccTLD domains of the same entity are merged.
 * Distinct commercial entities (even with overlapping SEO titles or category keywords) are kept separate.
 */
export function resolveCanonicalEntities(
  candidates: DiscoveredCompetitorCandidate[]
): DiscoveredCompetitorCandidate[] {
  // Map of canonicalEntityId -> merged candidate
  const entityMap = new Map<string, DiscoveredCompetitorCandidate>();

  for (const candidate of candidates) {
    const { brandToken, baseDomain } = extractBrandEntityInfo(candidate.websiteUrl || candidate.domain);
    const domainEntityId = generateCanonicalEntityId(brandToken);
    let entityId = candidate.canonicalEntityId || domainEntityId;

    const storefront: CompetitorStorefront = {
      domain: candidate.domain || baseDomain,
      url: candidate.websiteUrl,
      title: candidate.name,
    };

    let existing = entityMap.get(entityId);

    // Guardrail: Do NOT merge two distinct domains solely because their SEO title / category name produced the same canonicalEntityId
    // (e.g., songforyou.co.uk and melodybolt.com both having title "Personalised Songs UK").
    // Two distinct domains may only merge if they share the same domain brandToken (e.g., ubuy.tl and ubuy.com.tr),
    // or one explicitly lists the other in verified storefronts, or one brand name directly matches the other's domain token.
    if (existing) {
      const existingBrandInfo = extractBrandEntityInfo(existing.websiteUrl || existing.domain);
      const sameBrandToken = existingBrandInfo.brandToken === brandToken;
      const explicitlyLinkedStorefront =
        existing.storefronts?.some(s => extractBrandEntityInfo(s.url || s.domain).brandToken === brandToken) ||
        candidate.storefronts?.some(s => extractBrandEntityInfo(s.url || s.domain).brandToken === existingBrandInfo.brandToken);

      if (!sameBrandToken && !explicitlyLinkedStorefront) {
        // Disambiguate entity ID using the candidate's own domain brandToken so distinct businesses stay separate
        entityId = domainEntityId !== existing.canonicalEntityId ? domainEntityId : `${domainEntityId}_${baseDomain.replace(/[^a-z0-9]/g, "")}`;
        existing = entityMap.get(entityId);
      }
    }

    if (!existing) {
      // First time seeing this entity
      const newCandidate: DiscoveredCompetitorCandidate = {
        ...candidate,
        canonicalEntityId: entityId,
        storefronts: candidate.storefronts && candidate.storefronts.length > 0
          ? [...candidate.storefronts]
          : [storefront],
      };
      // Ensure storefront is recorded if candidate had none
      if (!newCandidate.storefronts?.some(s => s.domain === storefront.domain)) {
        newCandidate.storefronts?.push(storefront);
      }
      entityMap.set(entityId, newCandidate);
    } else {
      // Merge into existing entity
      // 1. Add storefront if not already present
      if (!existing.storefronts) {
        existing.storefronts = [];
      }
      if (!existing.storefronts.some(s => s.domain === storefront.domain)) {
        existing.storefronts.push(storefront);
      }
      if (candidate.storefronts) {
        for (const s of candidate.storefronts) {
          if (!existing.storefronts.some(es => es.domain === s.domain)) {
            existing.storefronts.push(s);
          }
        }
      }

      // 2. Merge occurrences
      const existingOccUrl = new Set(existing.occurrences.map(o => o.url));
      for (const occ of candidate.occurrences || []) {
        if (!existingOccUrl.has(occ.url)) {
          existing.occurrences.push(occ);
          existingOccUrl.add(occ.url);
        }
      }

      // 3. Keep the better classification / verdict
      if (candidate.judgeVerdict === "APPROVED" && existing.judgeVerdict !== "APPROVED") {
        existing.judgeVerdict = "APPROVED";
        existing.judgeReason = candidate.judgeReason;
        existing.tier = candidate.tier || existing.tier;
        existing.strategicRole = candidate.strategicRole || existing.strategicRole;
      }

      // 4. Preserve local geographic classification if any storefront has it
      if (candidate.geographicClassification === "LOCAL_MARKET" && existing.geographicClassification !== "LOCAL_MARKET") {
        existing.geographicClassification = "LOCAL_MARKET";
        existing.geographicReasoning = candidate.geographicReasoning;
      } else if (
        candidate.geographicClassification === "CROSS_BORDER_SERVING_MARKET" &&
        existing.geographicClassification !== "LOCAL_MARKET"
      ) {
        existing.geographicClassification = "CROSS_BORDER_SERVING_MARKET";
      }

      // 5. Prefer a cleaner or more established name / websiteUrl if existing has obscure ccTLD
      if (
        (existing.websiteUrl.includes(".tl") || existing.websiteUrl.includes(".bf") || existing.websiteUrl.includes(".ec")) &&
        (!candidate.websiteUrl.includes(".tl") && !candidate.websiteUrl.includes(".bf"))
      ) {
        existing.websiteUrl = candidate.websiteUrl;
        existing.domain = candidate.domain;
        existing.name = candidate.name;
      }
    }
  }

  return Array.from(entityMap.values());
}
