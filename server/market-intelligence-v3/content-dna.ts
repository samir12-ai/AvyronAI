import type {
  CompetitorInput,
  PostData,
  CompetitorContentDNA,
  ContentDNAEvidence,
  HookArchetype,
  NarrativeFramework,
  CTAFramework,
} from "./types";
import { SIMILARITY_MIN_EVIDENCE_THRESHOLD } from "./constants";

const MIN_CAPTION_LENGTH = 15;

const HOOK_PATTERNS: Record<HookArchetype, RegExp[]> = {
  shock: [
    /\b(shocking|unbelievable|insane|crazy|mind[\s-]?blowing|you won'?t believe|jaw[\s-]?dropping|warning|alert|urgent|breaking)\b/i,
    /(صادم|لا يصدق|مجنون|تحذير|عاجل)/i,
  ],
  authority: [
    /\b(expert|proven|research shows|studies show|science|data shows|according to|certified|professional|industry[\s-]?leading|years of experience)\b/i,
    /(خبير|مثبت|أبحاث|دراسات|محترف|معتمد)/i,
  ],
  curiosity: [
    /\b(secret|hidden|little[\s-]?known|most people don'?t|what if|imagine|discover|reveal|unlock|mysterious)\b/i,
    /(سر|مخفي|اكتشف|تخيل|غامض)/i,
  ],
  problem: [
    /\b(struggling|tired of|sick of|frustrated|problem|pain point|challenge|difficulty|failing|losing)\b/i,
    /(تعاني|مشكلة|تحدي|صعوبة|خسارة|إحباط)/i,
  ],
  question: [
    /^(do you|are you|have you|did you|can you|would you|should you|is your|what|why|how|when|where|who)\b/i,
    /\?[\s]*$/,
    /(هل|ما|لماذا|كيف|متى|أين|من)/i,
  ],
  statistic: [
    /\b\d+%/,
    /\b\d+x\b/i,
    /\b(out of \d+|\d+ out of)\b/i,
    /\b\d+[\s]?(million|billion|thousand|k)\b/i,
    /\b(stat|statistic|number|figure|metric|data point)\b/i,
  ],
  story: [
    /\b(i remember|last year|back in|when i was|my journey|my story|true story|let me tell you|one day|it all started)\b/i,
    /(أتذكر|قصتي|قصة حقيقية|في يوم|بدأ كل شيء)/i,
  ],
};

const NARRATIVE_PATTERNS: Record<NarrativeFramework, RegExp[]> = {
  mistake_fix: [
    /\b(mistake|error|wrong|fix|fixed|correct|avoid|stop doing|don'?t make)\b.*\b(instead|better|right way|solution|fix|correct)\b/i,
    /(خطأ|تجنب|توقف عن|الحل|الطريقة الصحيحة)/i,
  ],
  problem_solution: [
    /\b(problem|issue|struggle|challenge)\b.*\b(solution|solve|fix|answer|resolved|here'?s how)\b/i,
    /(مشكلة|حل|الحل|إصلاح)/i,
  ],
  before_after: [
    /\b(before|after|transformation|results|progress|then vs now|used to|now i)\b/i,
    /(قبل|بعد|تحول|نتائج|تقدم)/i,
  ],
  story_lesson: [
    /\b(lesson|learned|takeaway|moral|taught me|realized|eye[\s-]?opener)\b/i,
    /(درس|تعلمت|استنتاج|عبرة|أدركت)/i,
  ],
  listicle: [
    /\b(\d+\s+(tips|ways|reasons|steps|things|ideas|hacks|mistakes|secrets|strategies|rules|habits))\b/i,
    /\b(tip\s*#?\s*\d|step\s*#?\s*\d|reason\s*#?\s*\d|#\d\s)/i,
  ],
  how_to: [
    /\b(how to|step[\s-]?by[\s-]?step|guide|tutorial|walkthrough|here'?s how|the way to)\b/i,
    /(كيف|خطوة بخطوة|دليل|طريقة)/i,
  ],
};

const CTA_PATTERNS: Record<CTAFramework, RegExp[]> = {
  explicit: [
    /\b(buy now|shop now|order now|get yours|purchase|add to cart|checkout|sign up|subscribe|register|download|install|book now|reserve|grab|claim)\b/i,
    /\b(link in bio|link in profile|tap the link|click the link|swipe up|use code|promo code|discount code|coupon)\b/i,
    /(اشتري|اطلب|سجل|حمل|احجز|الرابط في البايو|استخدم الكود)/i,
  ],
  soft: [
    /\b(dm me|dm us|send me a message|drop a comment|comment below|tag a friend|share this|save this|double tap|like if you|follow for more|turn on notifications)\b/i,
    /\b(let me know|tell me|what do you think|agree\?|thoughts\?|who else|anyone else)\b/i,
    /(راسلني|علق|شارك|احفظ|تابعني|فعل الإشعارات)/i,
  ],
  narrative: [
    /\b(i decided to|that'?s when i|and then|the result was|it changed|my life changed|everything shifted)\b/i,
    /(قررت|وعندها|النتيجة كانت|تغير كل شيء)/i,
  ],
  trust: [
    /\b(review|testimonial|client said|customer said|feedback|5[\s-]?star|rated|recommended by|trusted by|verified|case study|real results)\b/i,
    /(تقييم|رأي العميل|موصى به|موثوق|نتائج حقيقية)/i,
  ],
};

function truncateSnippet(text: string, maxLen = 50): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

function detectHookArchetypes(posts: PostData[]): { archetypes: HookArchetype[]; evidence: ContentDNAEvidence[] } {
  const found = new Map<HookArchetype, ContentDNAEvidence[]>();

  for (const post of posts) {
    const caption = (post.caption || "").trim();
    if (caption.length < MIN_CAPTION_LENGTH) continue;

    for (const [archetype, patterns] of Object.entries(HOOK_PATTERNS) as [HookArchetype, RegExp[]][]) {
      for (const pattern of patterns) {
        if (pattern.test(caption)) {
          if (!found.has(archetype)) found.set(archetype, []);
          found.get(archetype)!.push({
            postId: post.id,
            snippet: truncateSnippet(caption),
            detectedType: `hook:${archetype}`,
          });
          break;
        }
      }
    }
  }

  const archetypes = Array.from(found.keys());
  const evidence: ContentDNAEvidence[] = [];
  for (const [, evList] of found) {
    evidence.push(evList[0]);
  }
  return { archetypes, evidence };
}

function detectNarrativeFrameworks(posts: PostData[]): { frameworks: NarrativeFramework[]; evidence: ContentDNAEvidence[] } {
  const found = new Map<NarrativeFramework, ContentDNAEvidence[]>();

  for (const post of posts) {
    const caption = (post.caption || "").trim();
    if (caption.length < MIN_CAPTION_LENGTH) continue;

    for (const [framework, patterns] of Object.entries(NARRATIVE_PATTERNS) as [NarrativeFramework, RegExp[]][]) {
      for (const pattern of patterns) {
        if (pattern.test(caption)) {
          if (!found.has(framework)) found.set(framework, []);
          found.get(framework)!.push({
            postId: post.id,
            snippet: truncateSnippet(caption),
            detectedType: `narrative:${framework}`,
          });
          break;
        }
      }
    }
  }

  const frameworks = Array.from(found.keys());
  const evidence: ContentDNAEvidence[] = [];
  for (const [, evList] of found) {
    evidence.push(evList[0]);
  }
  return { frameworks, evidence };
}

function detectCTAFrameworks(posts: PostData[]): { frameworks: CTAFramework[]; evidence: ContentDNAEvidence[] } {
  const found = new Map<CTAFramework, ContentDNAEvidence[]>();

  for (const post of posts) {
    const caption = (post.caption || "").trim();
    if (caption.length < MIN_CAPTION_LENGTH) continue;

    for (const [ctaType, patterns] of Object.entries(CTA_PATTERNS) as [CTAFramework, RegExp[]][]) {
      for (const pattern of patterns) {
        if (pattern.test(caption)) {
          if (!found.has(ctaType)) found.set(ctaType, []);
          found.get(ctaType)!.push({
            postId: post.id,
            snippet: truncateSnippet(caption),
            detectedType: `cta:${ctaType}`,
          });
          break;
        }
      }
    }
  }

  const frameworks = Array.from(found.keys());
  const evidence: ContentDNAEvidence[] = [];
  for (const [, evList] of found) {
    evidence.push(evList[0]);
  }
  return { frameworks, evidence };
}

export function computeContentDNA(competitor: CompetitorInput): CompetitorContentDNA {
  const posts = competitor.posts || [];
  const missingSignalFlags: string[] = [];

  if (posts.length < SIMILARITY_MIN_EVIDENCE_THRESHOLD) {
    missingSignalFlags.push(
      `Insufficient posts for DNA analysis (have ${posts.length}, need ${SIMILARITY_MIN_EVIDENCE_THRESHOLD})`
    );
  }

  const captionsWithText = posts.filter(p => (p.caption || "").trim().length >= MIN_CAPTION_LENGTH);
  if (captionsWithText.length === 0 && posts.length > 0) {
    missingSignalFlags.push("All captions too short for framework detection");
  }

  const { archetypes: hookArchetypes, evidence: hookEvidence } = detectHookArchetypes(posts);
  const { frameworks: narrativeFrameworks, evidence: narrativeEvidence } = detectNarrativeFrameworks(posts);
  const { frameworks: ctaFrameworks, evidence: ctaEvidence } = detectCTAFrameworks(posts);

  const allEvidence = [...hookEvidence, ...narrativeEvidence, ...ctaEvidence];

  const totalDetections = hookArchetypes.length + narrativeFrameworks.length + ctaFrameworks.length;
  const maxPossibleDetections = Object.keys(HOOK_PATTERNS).length + Object.keys(NARRATIVE_PATTERNS).length + Object.keys(CTA_PATTERNS).length;

  let dnaConfidence: number;
  if (posts.length < SIMILARITY_MIN_EVIDENCE_THRESHOLD) {
    dnaConfidence = Math.min(0.3, (posts.length / SIMILARITY_MIN_EVIDENCE_THRESHOLD) * 0.3);
  } else if (captionsWithText.length === 0) {
    dnaConfidence = 0.1;
  } else {
    const dataRatio = Math.min(1, posts.length / (SIMILARITY_MIN_EVIDENCE_THRESHOLD * 2));
    const detectionRatio = totalDetections / maxPossibleDetections;
    dnaConfidence = Math.round((dataRatio * 0.5 + detectionRatio * 0.5) * 100) / 100;
  }

  if (hookArchetypes.length === 0) missingSignalFlags.push("No hook archetypes detected");
  if (narrativeFrameworks.length === 0) missingSignalFlags.push("No narrative frameworks detected");
  if (ctaFrameworks.length === 0) missingSignalFlags.push("No CTA frameworks detected");

  return {
    competitorId: competitor.id,
    competitorName: competitor.name,
    hookArchetypes,
    narrativeFrameworks,
    ctaFrameworks,
    evidence: allEvidence,
    dnaConfidence,
    missingSignalFlags,
  };
}

export function computeAllContentDNA(competitors: CompetitorInput[]): CompetitorContentDNA[] {
  return competitors.map(computeContentDNA);
}
