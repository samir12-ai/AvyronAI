/**
 * Market localization utilities for search provider parameters (ISO country/language codes)
 * and basic domain ccTLD inspection.
 *
 * NOTE: Discovery query languages, search terms, competitor categories, and market-service
 * eligibility are determined contextually by the LLM from the business understanding,
 * offering delivery model, buyer segments, and requested market — NOT from fixed keyword
 * lists or language ratios here.
 */

export interface MarketLocalization {
  countryCode: string; // ISO 3166-1 alpha-2 (e.g., 'ae', 'tr', 'us', 'gb')
  searchLanguage: string; // Default provider interface language code
  languageCode: string; // Default provider language code
  countryName: string;
  languageName: string;
  primaryCctlds: string[];
  localKeywords: string[]; // Strictly geographic names/cities, never shipping or retail terms
}

const MARKET_REGISTRY: Record<string, MarketLocalization> = {
  turkey: {
    countryCode: "tr",
    searchLanguage: "tr",
    languageCode: "tr",
    countryName: "Turkey",
    languageName: "Turkish",
    primaryCctlds: [".tr", ".com.tr", ".org.tr", ".net.tr", ".gen.tr", ".biz.tr", ".av.tr"],
    localKeywords: ["türkiye", "turkey", "istanbul", "ankara", "izmir"],
  },
  türkiye: {
    countryCode: "tr",
    searchLanguage: "tr",
    languageCode: "tr",
    countryName: "Turkey",
    languageName: "Turkish",
    primaryCctlds: [".tr", ".com.tr", ".org.tr", ".net.tr", ".gen.tr", ".biz.tr", ".av.tr"],
    localKeywords: ["türkiye", "turkey", "istanbul", "ankara", "izmir"],
  },
  turkiye: {
    countryCode: "tr",
    searchLanguage: "tr",
    languageCode: "tr",
    countryName: "Turkey",
    languageName: "Turkish",
    primaryCctlds: [".tr", ".com.tr", ".org.tr", ".net.tr", ".gen.tr", ".biz.tr", ".av.tr"],
    localKeywords: ["türkiye", "turkey", "istanbul", "ankara", "izmir"],
  },
  tr: {
    countryCode: "tr",
    searchLanguage: "tr",
    languageCode: "tr",
    countryName: "Turkey",
    languageName: "Turkish",
    primaryCctlds: [".tr", ".com.tr", ".org.tr", ".net.tr", ".gen.tr", ".biz.tr"],
    localKeywords: ["türkiye", "turkey", "istanbul", "ankara", "izmir"],
  },
  lebanon: {
    countryCode: "lb",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Lebanon",
    languageName: "Arabic / English / French",
    primaryCctlds: [".lb", ".com.lb"],
    localKeywords: ["lebanon", "beirut", "لبنان", "بيروت"],
  },
  lb: {
    countryCode: "lb",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Lebanon",
    languageName: "Arabic / English / French",
    primaryCctlds: [".lb", ".com.lb"],
    localKeywords: ["lebanon", "beirut", "لبنان", "بيروت"],
  },
  "united states": {
    countryCode: "us",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United States",
    languageName: "English",
    primaryCctlds: [".us"],
    localKeywords: ["united states", "usa", "us"],
  },
  us: {
    countryCode: "us",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United States",
    languageName: "English",
    primaryCctlds: [".us"],
    localKeywords: ["united states", "usa", "us"],
  },
  usa: {
    countryCode: "us",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United States",
    languageName: "English",
    primaryCctlds: [".us"],
    localKeywords: ["united states", "usa", "us"],
  },
  "united kingdom": {
    countryCode: "gb",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United Kingdom",
    languageName: "English",
    primaryCctlds: [".uk", ".co.uk", ".org.uk"],
    localKeywords: ["uk", "united kingdom", "london", "britain"],
  },
  uk: {
    countryCode: "gb",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United Kingdom",
    languageName: "English",
    primaryCctlds: [".uk", ".co.uk", ".org.uk"],
    localKeywords: ["uk", "united kingdom", "london", "britain"],
  },
  gb: {
    countryCode: "gb",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United Kingdom",
    languageName: "English",
    primaryCctlds: [".uk", ".co.uk"],
    localKeywords: ["uk", "united kingdom"],
  },
  germany: {
    countryCode: "de",
    searchLanguage: "de",
    languageCode: "de",
    countryName: "Germany",
    languageName: "German",
    primaryCctlds: [".de"],
    localKeywords: ["deutschland", "germany", "berlin", "münchen"],
  },
  de: {
    countryCode: "de",
    searchLanguage: "de",
    languageCode: "de",
    countryName: "Germany",
    languageName: "German",
    primaryCctlds: [".de"],
    localKeywords: ["deutschland", "germany"],
  },
  france: {
    countryCode: "fr",
    searchLanguage: "fr",
    languageCode: "fr",
    countryName: "France",
    languageName: "French",
    primaryCctlds: [".fr"],
    localKeywords: ["france", "paris"],
  },
  fr: {
    countryCode: "fr",
    searchLanguage: "fr",
    languageCode: "fr",
    countryName: "France",
    languageName: "French",
    primaryCctlds: [".fr"],
    localKeywords: ["france", "paris"],
  },
  "united arab emirates": {
    countryCode: "ae",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United Arab Emirates",
    languageName: "English / Arabic",
    primaryCctlds: [".ae"],
    localKeywords: ["uae", "united arab emirates", "emirates", "dubai", "abu dhabi", "الإمارات", "دبي", "أبوظبي"],
  },
  uae: {
    countryCode: "ae",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United Arab Emirates",
    languageName: "English / Arabic",
    primaryCctlds: [".ae"],
    localKeywords: ["uae", "united arab emirates", "emirates", "dubai", "abu dhabi", "الإمارات", "دبي"],
  },
  ae: {
    countryCode: "ae",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "United Arab Emirates",
    languageName: "English / Arabic",
    primaryCctlds: [".ae"],
    localKeywords: ["uae", "dubai", "abu dhabi"],
  },
  "saudi arabia": {
    countryCode: "sa",
    searchLanguage: "ar",
    languageCode: "ar",
    countryName: "Saudi Arabia",
    languageName: "Arabic / English",
    primaryCctlds: [".sa", ".com.sa"],
    localKeywords: ["saudi", "ksa", "riyadh", "jeddah", "السعودية", "الرياض", "جدة"],
  },
  ksa: {
    countryCode: "sa",
    searchLanguage: "ar",
    languageCode: "ar",
    countryName: "Saudi Arabia",
    languageName: "Arabic / English",
    primaryCctlds: [".sa", ".com.sa"],
    localKeywords: ["saudi", "ksa", "السعودية", "الرياض"],
  },
  sa: {
    countryCode: "sa",
    searchLanguage: "ar",
    languageCode: "ar",
    countryName: "Saudi Arabia",
    languageName: "Arabic / English",
    primaryCctlds: [".sa"],
    localKeywords: ["saudi", "ksa", "السعودية"],
  },
  qatar: {
    countryCode: "qa",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Qatar",
    languageName: "English / Arabic",
    primaryCctlds: [".qa", ".com.qa"],
    localKeywords: ["qatar", "doha", "قطر", "الدوحة"],
  },
  kuwait: {
    countryCode: "kw",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Kuwait",
    languageName: "Arabic / English",
    primaryCctlds: [".kw", ".com.kw"],
    localKeywords: ["kuwait", "الكويت"],
  },
  egypt: {
    countryCode: "eg",
    searchLanguage: "ar",
    languageCode: "ar",
    countryName: "Egypt",
    languageName: "Arabic / English",
    primaryCctlds: [".eg", ".com.eg"],
    localKeywords: ["egypt", "cairo", "مصر", "القاهرة"],
  },
  canada: {
    countryCode: "ca",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Canada",
    languageName: "English / French",
    primaryCctlds: [".ca"],
    localKeywords: ["canada", "toronto", "vancouver"],
  },
  ca: {
    countryCode: "ca",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Canada",
    languageName: "English / French",
    primaryCctlds: [".ca"],
    localKeywords: ["canada", "toronto"],
  },
  australia: {
    countryCode: "au",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Australia",
    languageName: "English",
    primaryCctlds: [".au", ".com.au"],
    localKeywords: ["australia", "sydney", "melbourne"],
  },
  au: {
    countryCode: "au",
    searchLanguage: "en",
    languageCode: "en",
    countryName: "Australia",
    languageName: "English",
    primaryCctlds: [".au", ".com.au"],
    localKeywords: ["australia", "sydney"],
  },
};

/**
 * Resolves a human or ISO market identifier to baseline search provider parameters.
 * When a mission specifies its own languagePreference, it overrides the default language.
 */
export function resolveMarketLocalization(
  targetMarket?: string | null,
  languagePreference?: string | null
): MarketLocalization {
  let baseLoc: MarketLocalization;

  if (!targetMarket || typeof targetMarket !== "string") {
    baseLoc = {
      countryCode: "us",
      searchLanguage: "en",
      languageCode: "en",
      countryName: "United States",
      languageName: "English",
      primaryCctlds: [".us"],
      localKeywords: ["united states", "usa"],
    };
  } else {
    const rawLower = targetMarket.trim().toLowerCase();
    const normalized = rawLower
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");

    if (MARKET_REGISTRY[rawLower]) {
      baseLoc = { ...MARKET_REGISTRY[rawLower] };
    } else if (MARKET_REGISTRY[normalized]) {
      baseLoc = { ...MARKET_REGISTRY[normalized] };
    } else {
      let matched: MarketLocalization | null = null;
      for (const [key, loc] of Object.entries(MARKET_REGISTRY)) {
        if (key.length > 2 && (normalized.includes(key) || rawLower.includes(key))) {
          matched = { ...loc };
          break;
        }
      }
      if (matched) {
        baseLoc = matched;
      } else if (/^[a-z]{2}$/.test(rawLower)) {
        baseLoc = {
          countryCode: rawLower,
          searchLanguage: "en",
          languageCode: "en",
          countryName: targetMarket.toUpperCase(),
          languageName: "Contextual",
          primaryCctlds: [`.${rawLower}`],
          localKeywords: [targetMarket.toLowerCase()],
        };
      } else {
        baseLoc = {
          countryCode: "us",
          searchLanguage: "en",
          languageCode: "en",
          countryName: targetMarket.trim(),
          languageName: "Contextual",
          primaryCctlds: [],
          localKeywords: [targetMarket.trim().toLowerCase()],
        };
      }
    }
  }

  if (languagePreference && typeof languagePreference === "string" && languagePreference.trim().length >= 2) {
    const cleanLang = languagePreference.trim().toLowerCase().slice(0, 2);
    baseLoc.searchLanguage = cleanLang;
    baseLoc.languageCode = cleanLang;
  }

  return baseLoc;
}

/**
 * Known country-code TLDs (ccTLDs) that explicitly denote a specific nation's registry.
 * Note: Generic tech TLDs like .ai, .io, .co, .me, .tv, .app, .dev are NOT treated as foreign nation storefronts.
 */
const EXPLICIT_COUNTRY_CCTLDS_REGEX =
  /\.(mq|tl|ec|bf|hn|de|fr|uk|co\.uk|es|it|ru|nl|br|ar|jp|cn|in|au|com\.au|ca|gr|bg|ro|eg|com\.eg|sa|com\.sa|ae|qa|kw|lb|com\.lb|tr|com\.tr|pk|bd|id|th|vn|ph|my|sg|za|co\.za|mx|com\.mx|cl|pe)$/i;

/**
 * Inspects structural domain ccTLD and explicit geographic mentions without assuming
 * physical retail stores or physical parcel shipping.
 */
export function matchesTargetMarketDomestic(
  domain: string,
  evidenceSnippet: string,
  targetMarket: string
): { isDomesticMatch: boolean; confidence: "HIGH" | "MEDIUM" | "LOW"; reason: string } {
  const loc = resolveMarketLocalization(targetMarket);
  const cleanDom = domain.toLowerCase().trim();
  const lowerSnippet = evidenceSnippet.toLowerCase();

  // 1. Exact target-market ccTLD match (e.g. .ae for UAE, .com.tr for Turkey, .co.uk for UK)
  for (const cctld of loc.primaryCctlds) {
    if (cleanDom.endsWith(cctld)) {
      return {
        isDomesticMatch: true,
        confidence: "HIGH",
        reason: `Domain uses primary country TLD (${cctld}) for ${loc.countryName}`,
      };
    }
  }

  // 2. Explicit foreign country ccTLD check (excludes generic TLDs like .ai, .io, .co)
  const hasExplicitForeignCountryTld = EXPLICIT_COUNTRY_CCTLDS_REGEX.test(cleanDom);
  const isTargetCountryTld = loc.primaryCctlds.some((cctld) => cleanDom.endsWith(cctld));

  if (hasExplicitForeignCountryTld && !isTargetCountryTld) {
    return {
      isDomesticMatch: false,
      confidence: "HIGH",
      reason: `Domain uses an explicit country-specific TLD for another country outside ${loc.countryName}`,
    };
  }

  // 3. Origin-only mention check ("handmade in ...", "imported from ...")
  const isOriginOnlyMention = /handmade in|made in|imported from|product of|traditional.*from/i.test(lowerSnippet);

  let geoKeywordHits = 0;
  for (const kw of loc.localKeywords) {
    if (lowerSnippet.includes(kw.toLowerCase())) {
      geoKeywordHits++;
    }
  }

  if (isOriginOnlyMention && geoKeywordHits <= 1 && !cleanDom.includes(loc.countryCode)) {
    return {
      isDomesticMatch: false,
      confidence: "MEDIUM",
      reason: `Snippet references product origin rather than market presence in ${loc.countryName}`,
    };
  }

  if (geoKeywordHits >= 1) {
    return {
      isDomesticMatch: true,
      confidence: "MEDIUM",
      reason: `Evidence mentions geographic indicators for ${loc.countryName}`,
    };
  }

  return {
    isDomesticMatch: false,
    confidence: "LOW",
    reason: `No explicit ${loc.countryName} geographic indicator in domain or snippet`,
  };
}
