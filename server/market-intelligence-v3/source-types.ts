export type SourceType = "instagram" | "website" | "blog";

export type SignalClass =
  | "positioning"
  | "offer"
  | "content"
  | "educational"
  | "proof"
  | "cta";

export interface SourceAvailability {
  instagram: boolean;
  website: boolean;
  blog: boolean;
  availableSources: SourceType[];
  missingSourcesCount: number;
  primarySource: SourceType;
}

export interface ClassifiedSignal {
  signalClass: SignalClass;
  sourceType: SourceType;
  text: string;
  confidence: number;
  sourceUrl?: string;
  pageType?: string;
}

export interface WebsiteExtraction {
  competitorId: string;
  competitorName: string;
  sourceUrl: string;
  pageType: "homepage" | "pricing" | "features" | "about" | "blog_index" | "landing" | "other";
  headlines: string[];
  subheadlines: string[];
  ctaLabels: string[];
  offerPhrases: string[];
  pricingAnchors: string[];
  proofBlocks: string[];
  testimonialBlocks: string[];
  guarantees: string[];
  featureList: string[];
  navigationLinks: string[];
  topicTitles: string[];
  contentHeadings: string[];
  rawTextPreview: string;
  extractionStatus: "COMPLETE" | "PARTIAL" | "FAILED";
  extractionError?: string;
  scrapedAt: string;
}

export interface BlogExtraction {
  competitorId: string;
  competitorName: string;
  sourceUrl: string;
  topicTitles: string[];
  contentHeadings: string[];
  categories: string[];
  educationalThemes: string[];
  rawTextPreview: string;
  extractionStatus: "COMPLETE" | "PARTIAL" | "FAILED";
  extractionError?: string;
  scrapedAt: string;
}

export interface InstagramSignals {
  hooks: string[];
  ctaPatterns: string[];
  contentAngles: string[];
  painInferences: string[];
  storytellingPatterns: string[];
  authorityFraming: string[];
  proofFraming: string[];
  curiosityFraming: string[];
}

export interface WebsiteSignals {
  positioningLanguage: string[];
  headlineExtractions: string[];
  offerStructure: string[];
  pricingModel: string[];
  funnelCTAs: string[];
  proofStructure: string[];
  guarantees: string[];
  featureHierarchy: string[];
  brandPromise: string[];
}

export interface BlogSignals {
  educationalThemes: string[];
  marketQuestions: string[];
  authorityThemes: string[];
  topicClusters: string[];
  problemFraming: string[];
  educationPatterns: string[];
}

export interface MultiSourceSignals {
  instagram: InstagramSignals | null;
  website: WebsiteSignals | null;
  blog: BlogSignals | null;
  sourceAvailability: SourceAvailability;
  classifiedSignals: ClassifiedSignal[];
  reconciliationNotes: string[];
  signalConfidence: number;
}

export interface SourceFreshnessRecord {
  sourceType: SourceType;
  scrapedAt: string | null;
  ageDays: number;
  isStale: boolean;
  isAvailable: boolean;
}

export function computeSourceAvailability(competitor: {
  profileLink?: string | null;
  websiteUrl?: string | null;
  blogUrl?: string | null;
  postsCollected?: number | null;
  websiteEnrichmentStatus?: string | null;
  blogEnrichmentStatus?: string | null;
}): SourceAvailability {
  const instagram = !!(competitor.profileLink && (competitor.postsCollected ?? 0) > 0);
  const website = !!(competitor.websiteUrl && competitor.websiteEnrichmentStatus !== "NONE" && competitor.websiteEnrichmentStatus !== "FAILED");
  const blog = !!(competitor.blogUrl && competitor.blogEnrichmentStatus !== "NONE" && competitor.blogEnrichmentStatus !== "FAILED");

  const availableSources: SourceType[] = [];
  if (instagram) availableSources.push("instagram");
  if (website) availableSources.push("website");
  if (blog) availableSources.push("blog");

  const primarySource: SourceType = website ? "website" : instagram ? "instagram" : "blog";

  return {
    instagram,
    website,
    blog,
    availableSources,
    missingSourcesCount: 3 - availableSources.length,
    primarySource,
  };
}

export function computeSourceFreshness(competitor: {
  lastCheckedAt?: Date | string | null;
  websiteScrapedAt?: Date | string | null;
  blogScrapedAt?: Date | string | null;
}): SourceFreshnessRecord[] {
  const now = Date.now();
  const STALE_DAYS = 14;

  function calcAge(ts: Date | string | null | undefined): { ageDays: number; isStale: boolean; scrapedAt: string | null } {
    if (!ts) return { ageDays: -1, isStale: true, scrapedAt: null };
    const d = new Date(ts).getTime();
    const ageDays = (now - d) / (1000 * 60 * 60 * 24);
    return { ageDays: Math.round(ageDays * 100) / 100, isStale: ageDays > STALE_DAYS, scrapedAt: new Date(ts).toISOString() };
  }

  const ig = calcAge(competitor.lastCheckedAt);
  const web = calcAge(competitor.websiteScrapedAt);
  const blog = calcAge(competitor.blogScrapedAt);

  return [
    { sourceType: "instagram", ...ig, isAvailable: ig.scrapedAt !== null },
    { sourceType: "website", ...web, isAvailable: web.scrapedAt !== null },
    { sourceType: "blog", ...blog, isAvailable: blog.scrapedAt !== null },
  ];
}
