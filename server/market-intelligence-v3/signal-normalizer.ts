import type {
  ClassifiedSignal,
  SignalClass,
  SourceType,
  MultiSourceSignals,
  InstagramSignals,
  WebsiteSignals,
  BlogSignals,
  WebsiteExtraction,
  BlogExtraction,
  SourceAvailability,
} from "./source-types";
import type { CompetitorContentDNA } from "./types";

const SIGNAL_WEIGHTS: Record<SignalClass, Record<SourceType, number>> = {
  positioning: { website: 0.6, instagram: 0.25, blog: 0.15 },
  offer: { website: 0.65, instagram: 0.2, blog: 0.15 },
  content: { instagram: 0.6, website: 0.2, blog: 0.2 },
  educational: { blog: 0.6, website: 0.25, instagram: 0.15 },
  proof: { website: 0.5, instagram: 0.3, blog: 0.2 },
  cta: { website: 0.5, instagram: 0.35, blog: 0.15 },
};

export function classifyWebsiteSignals(extraction: WebsiteExtraction): ClassifiedSignal[] {
  const signals: ClassifiedSignal[] = [];
  const src: SourceType = "website";

  for (const h of extraction.headlines) {
    signals.push({ signalClass: "positioning", sourceType: src, text: h, confidence: 0.85, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const s of extraction.subheadlines) {
    signals.push({ signalClass: "positioning", sourceType: src, text: s, confidence: 0.7, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const c of extraction.ctaLabels) {
    signals.push({ signalClass: "cta", sourceType: src, text: c, confidence: 0.8, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const o of extraction.offerPhrases) {
    signals.push({ signalClass: "offer", sourceType: src, text: o, confidence: 0.75, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const p of extraction.pricingAnchors) {
    signals.push({ signalClass: "offer", sourceType: src, text: p, confidence: 0.9, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const p of extraction.proofBlocks) {
    signals.push({ signalClass: "proof", sourceType: src, text: p, confidence: 0.8, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const t of extraction.testimonialBlocks) {
    signals.push({ signalClass: "proof", sourceType: src, text: t, confidence: 0.75, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const g of extraction.guarantees) {
    signals.push({ signalClass: "offer", sourceType: src, text: g, confidence: 0.85, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }
  for (const f of extraction.featureList) {
    signals.push({ signalClass: "positioning", sourceType: src, text: f, confidence: 0.65, sourceUrl: extraction.sourceUrl, pageType: extraction.pageType });
  }

  return signals;
}

export function classifyBlogSignals(extraction: BlogExtraction): ClassifiedSignal[] {
  const signals: ClassifiedSignal[] = [];
  const src: SourceType = "blog";

  for (const t of extraction.topicTitles) {
    signals.push({ signalClass: "educational", sourceType: src, text: t, confidence: 0.8, sourceUrl: extraction.sourceUrl });
  }
  for (const h of extraction.contentHeadings) {
    signals.push({ signalClass: "educational", sourceType: src, text: h, confidence: 0.65 });
  }
  for (const e of extraction.educationalThemes) {
    signals.push({ signalClass: "educational", sourceType: src, text: e, confidence: 0.85 });
  }
  for (const c of extraction.categories) {
    signals.push({ signalClass: "content", sourceType: src, text: c, confidence: 0.7 });
  }

  return signals;
}

export function classifyInstagramSignals(contentDna: CompetitorContentDNA): ClassifiedSignal[] {
  const signals: ClassifiedSignal[] = [];
  const src: SourceType = "instagram";

  for (const ev of contentDna.evidence) {
    let signalClass: SignalClass = "content";

    if (ev.detectedType.includes("hook") || ev.detectedType.includes("curiosity") || ev.detectedType.includes("shock")) {
      signalClass = "content";
    } else if (ev.detectedType.includes("authority") || ev.detectedType.includes("proof") || ev.detectedType.includes("statistic")) {
      signalClass = "proof";
    } else if (ev.detectedType.includes("cta") || ev.detectedType.includes("explicit") || ev.detectedType.includes("soft")) {
      signalClass = "cta";
    } else if (ev.detectedType.includes("problem") || ev.detectedType.includes("story") || ev.detectedType.includes("mistake")) {
      signalClass = "content";
    }

    signals.push({
      signalClass,
      sourceType: src,
      text: ev.snippet,
      confidence: contentDna.dnaConfidence,
    });
  }

  return signals;
}

export function buildInstagramSignals(contentDna: CompetitorContentDNA | null, captions: string[]): InstagramSignals {
  const hooks: string[] = [];
  const ctaPatterns: string[] = [];
  const contentAngles: string[] = [];
  const painInferences: string[] = [];
  const storytellingPatterns: string[] = [];
  const authorityFraming: string[] = [];
  const proofFraming: string[] = [];
  const curiosityFraming: string[] = [];

  if (contentDna) {
    for (const ev of contentDna.evidence) {
      const snippet = ev.snippet.slice(0, 200);
      const type = ev.detectedType.toLowerCase();
      if (type.includes("hook") || type.includes("shock")) hooks.push(snippet);
      if (type.includes("cta") || type.includes("explicit")) ctaPatterns.push(snippet);
      if (type.includes("curiosity")) curiosityFraming.push(snippet);
      if (type.includes("authority")) authorityFraming.push(snippet);
      if (type.includes("problem") || type.includes("story")) storytellingPatterns.push(snippet);
      if (type.includes("proof") || type.includes("statistic")) proofFraming.push(snippet);
    }
  }

  for (const cap of captions.slice(0, 30)) {
    const firstLine = cap.split("\n")[0]?.trim() || "";
    if (firstLine.length > 5 && firstLine.length < 200) {
      if (/\?|how|why|what if|imagine|stop|don't/i.test(firstLine)) hooks.push(firstLine);
      if (/pain|struggle|frustrated|tired|sick of|can't|won't/i.test(firstLine)) painInferences.push(firstLine);
    }
    if (/link in bio|DM me|comment|book a call|tap the link|click below/i.test(cap)) {
      const ctaMatch = cap.match(/(link in bio|DM me[^.]*|comment [^.]*|book a call[^.]*|tap the link[^.]*|click below[^.]*)/i);
      if (ctaMatch) ctaPatterns.push(ctaMatch[1].trim());
    }
  }

  return {
    hooks: [...new Set(hooks)].slice(0, 15),
    ctaPatterns: [...new Set(ctaPatterns)].slice(0, 15),
    contentAngles: [...new Set(contentAngles)].slice(0, 15),
    painInferences: [...new Set(painInferences)].slice(0, 15),
    storytellingPatterns: [...new Set(storytellingPatterns)].slice(0, 10),
    authorityFraming: [...new Set(authorityFraming)].slice(0, 10),
    proofFraming: [...new Set(proofFraming)].slice(0, 10),
    curiosityFraming: [...new Set(curiosityFraming)].slice(0, 10),
  };
}

export function buildWebsiteSignals(extractions: WebsiteExtraction[]): WebsiteSignals {
  const positioningLanguage: string[] = [];
  const headlineExtractions: string[] = [];
  const offerStructure: string[] = [];
  const pricingModel: string[] = [];
  const funnelCTAs: string[] = [];
  const proofStructure: string[] = [];
  const guarantees: string[] = [];
  const featureHierarchy: string[] = [];
  const brandPromise: string[] = [];

  for (const ext of extractions) {
    if (ext.extractionStatus === "FAILED") continue;

    headlineExtractions.push(...ext.headlines);
    for (const h of ext.headlines.slice(0, 3)) positioningLanguage.push(h);
    for (const s of ext.subheadlines.slice(0, 5)) positioningLanguage.push(s);

    offerStructure.push(...ext.offerPhrases);
    pricingModel.push(...ext.pricingAnchors);
    funnelCTAs.push(...ext.ctaLabels);
    proofStructure.push(...ext.proofBlocks);
    proofStructure.push(...ext.testimonialBlocks);
    guarantees.push(...ext.guarantees);
    featureHierarchy.push(...ext.featureList);

    if (ext.pageType === "homepage" && ext.headlines.length > 0) {
      brandPromise.push(ext.headlines[0]);
    }
  }

  return {
    positioningLanguage: [...new Set(positioningLanguage)].slice(0, 20),
    headlineExtractions: [...new Set(headlineExtractions)].slice(0, 20),
    offerStructure: [...new Set(offerStructure)].slice(0, 15),
    pricingModel: [...new Set(pricingModel)].slice(0, 10),
    funnelCTAs: [...new Set(funnelCTAs)].slice(0, 15),
    proofStructure: [...new Set(proofStructure)].slice(0, 15),
    guarantees: [...new Set(guarantees)].slice(0, 10),
    featureHierarchy: [...new Set(featureHierarchy)].slice(0, 20),
    brandPromise: [...new Set(brandPromise)].slice(0, 5),
  };
}

export function buildBlogSignals(extraction: BlogExtraction | null): BlogSignals {
  if (!extraction || extraction.extractionStatus === "FAILED") {
    return {
      educationalThemes: [],
      marketQuestions: [],
      authorityThemes: [],
      topicClusters: [],
      problemFraming: [],
      educationPatterns: [],
    };
  }

  const marketQuestions = extraction.topicTitles
    .filter(t => /\?|how|why|what|when|where/i.test(t))
    .slice(0, 10);

  const authorityThemes = extraction.topicTitles
    .filter(t => /guide|ultimate|complete|definitive|expert|advanced/i.test(t))
    .slice(0, 10);

  const problemFraming = extraction.topicTitles
    .filter(t => /mistake|avoid|wrong|problem|fail|struggle|fix/i.test(t))
    .slice(0, 10);

  return {
    educationalThemes: extraction.educationalThemes.slice(0, 15),
    marketQuestions,
    authorityThemes,
    topicClusters: extraction.categories.slice(0, 10),
    problemFraming,
    educationPatterns: extraction.contentHeadings.slice(0, 15),
  };
}

export function reconcileMultiSourceSignals(
  instagramSignals: InstagramSignals | null,
  websiteSignals: WebsiteSignals | null,
  blogSignals: BlogSignals | null,
  classifiedSignals: ClassifiedSignal[],
  sourceAvailability: SourceAvailability,
): MultiSourceSignals {
  const reconciliationNotes: string[] = [];

  if (!sourceAvailability.instagram && !sourceAvailability.website) {
    reconciliationNotes.push("Both Instagram and Website sources missing — operating in low-confidence mode with profile card and competitor intelligence only");
  } else if (!sourceAvailability.website) {
    reconciliationNotes.push("Website source missing — positioning and offer signals inferred from Instagram hooks and profile card");
  } else if (!sourceAvailability.instagram) {
    reconciliationNotes.push("Instagram source missing — content behavior signals inferred from website headlines and blog titles");
  }

  if (!sourceAvailability.blog) {
    reconciliationNotes.push("Blog source not available — educational themes will be inferred from other sources");
  }

  const positioningCount = classifiedSignals.filter(s => s.signalClass === "positioning").length;
  const offerCount = classifiedSignals.filter(s => s.signalClass === "offer").length;
  const contentCount = classifiedSignals.filter(s => s.signalClass === "content").length;
  const proofCount = classifiedSignals.filter(s => s.signalClass === "proof").length;

  const totalSignals = classifiedSignals.length;
  let signalConfidence = 0.3;

  if (totalSignals > 5) signalConfidence = 0.5;
  if (totalSignals > 15) signalConfidence = 0.65;
  if (totalSignals > 30) signalConfidence = 0.75;
  if (sourceAvailability.availableSources.length >= 2) signalConfidence += 0.1;
  if (sourceAvailability.availableSources.length >= 3) signalConfidence += 0.1;

  if (positioningCount < 3) reconciliationNotes.push("Low positioning signal density — may default to generic positioning");
  if (offerCount < 2) reconciliationNotes.push("Low offer signal density — offer structure may be inferred from profile card");
  if (proofCount < 2) reconciliationNotes.push("Low proof signal density — proof architecture may be weak");

  signalConfidence = Math.min(signalConfidence, 0.95);

  return {
    instagram: instagramSignals,
    website: websiteSignals,
    blog: blogSignals,
    sourceAvailability,
    classifiedSignals,
    reconciliationNotes,
    signalConfidence,
  };
}

export function getSourceWeightedScore(
  signalClass: SignalClass,
  sourceScores: Partial<Record<SourceType, number>>,
  sourceAvailability: SourceAvailability,
): number {
  const weights = SIGNAL_WEIGHTS[signalClass];
  let totalWeight = 0;
  let weightedSum = 0;

  for (const src of sourceAvailability.availableSources) {
    const score = sourceScores[src] ?? 0;
    const weight = weights[src] ?? 0;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}
