export const AUDIENCE_ENGINE_VERSION = 3;

export const AUDIENCE_THRESHOLDS = {
  MIN_COMMENTS_FOR_ANALYSIS: 10,
  MIN_POSTS_FOR_ANALYSIS: 5,
  MIN_COMPETITORS_FOR_ANALYSIS: 2,
  MAX_COMMENTS_TO_ANALYZE: 500,
  MAX_POSTS_TO_ANALYZE: 150,
} as const;

export interface PatternCluster {
  canonical: string;
  patterns: string[];
}

export const PAIN_CLUSTERS: PatternCluster[] = [
  { canonical: "frustration with lack of results", patterns: ["no results", "nothing works", "not working", "didn't work", "still the same", "nothing changed", "waste of time", "waste of money", "no progress", "plateau", "stuck", "not seeing results"] },
  { canonical: "confusion and overwhelm", patterns: ["confused", "don't understand", "overwhelming", "too much info", "information overload", "makes no sense", "complicated", "contradicting", "don't know where to start", "conflicting advice"] },
  { canonical: "time pressure", patterns: ["no time", "don't have time", "takes too long", "too busy", "how long does it take", "quick results", "fast results", "short on time", "busy schedule", "time consuming"] },
  { canonical: "cost and affordability concerns", patterns: ["expensive", "too much money", "can't afford", "not worth it", "overpriced", "cheaper alternative", "budget", "free option", "cost too much", "pricing"] },
  { canonical: "trust and credibility doubts", patterns: ["scam", "fake", "is this legit", "too good to be true", "don't trust", "honest review", "real results", "proof", "before and after", "can you prove"] },
  { canonical: "fear of failure", patterns: ["afraid to try", "what if it doesn't work", "scared", "fear of", "worried", "anxious about", "might fail", "risk", "lose money", "regret"] },
  { canonical: "body image struggles", patterns: ["belly fat", "stomach fat", "love handles", "waist won't shrink", "body fat", "overweight", "flabby", "skinny fat", "loose skin", "stubborn fat"] },
  { canonical: "motivation and consistency issues", patterns: ["can't stay consistent", "lose motivation", "keep quitting", "hard to maintain", "discipline", "give up", "fall off", "lack of motivation", "no willpower", "lazy"] },
  { canonical: "injury or health limitations", patterns: ["injury", "bad knee", "back pain", "joint pain", "can't exercise", "health condition", "limited mobility", "chronic pain", "recovery", "doctor said"] },
  { canonical: "diet and nutrition confusion", patterns: ["what to eat", "diet plan", "meal prep", "macros", "calories", "nutrition", "carbs", "protein intake", "keto", "fasting", "diet confusion", "eating right"] },
];

export const DESIRE_CLUSTERS: PatternCluster[] = [
  { canonical: "lose weight / fat loss", patterns: ["lose weight", "fat loss", "burn fat", "shed pounds", "slim down", "get lean", "drop weight", "weight loss", "lose belly fat", "cut fat"] },
  { canonical: "build muscle / get stronger", patterns: ["build muscle", "gain muscle", "get stronger", "bulk up", "muscle growth", "muscle gain", "tone up", "get toned", "get fit", "body building"] },
  { canonical: "look better / aesthetic goals", patterns: ["look good", "look better", "look athletic", "physique", "aesthetic", "beach body", "six pack", "abs", "attractive", "transform my body"] },
  { canonical: "increase confidence", patterns: ["more confident", "self confidence", "feel confident", "believe in myself", "self esteem", "feel good about myself", "proud of", "confidence boost"] },
  { canonical: "improve health", patterns: ["healthier", "better health", "improve health", "healthy lifestyle", "longevity", "feel better", "more energy", "sleep better", "reduce stress"] },
  { canonical: "achieve transformation", patterns: ["transformation", "before and after", "life change", "new me", "complete change", "glow up", "total body transformation", "makeover"] },
  { canonical: "learn skills / knowledge", patterns: ["learn how to", "teach me", "want to know", "understand", "educate myself", "master", "get better at", "improve my", "skill up"] },
  { canonical: "save time / efficiency", patterns: ["save time", "efficient", "quick workout", "less time", "shortcut", "faster results", "time saving", "optimize", "streamline"] },
  { canonical: "financial improvement", patterns: ["make money", "earn more", "side hustle", "passive income", "financial freedom", "grow business", "revenue", "profit", "monetize"] },
  { canonical: "social recognition / status", patterns: ["impress", "respect", "admired", "envied", "status", "stand out", "noticed", "popular", "influence", "reputation"] },
];

export const OBJECTION_CLUSTERS: PatternCluster[] = [
  { canonical: "too expensive", patterns: ["too expensive", "can't afford", "not worth the price", "overpriced", "cheaper option", "free alternative", "budget constraint", "costs too much", "waste of money"] },
  { canonical: "no time", patterns: ["no time", "too busy", "don't have time", "time consuming", "takes too long", "busy schedule", "can't commit", "not enough hours"] },
  { canonical: "tried before and failed", patterns: ["tried before", "didn't work last time", "already tried", "nothing works for me", "failed before", "gave up", "been there", "tried everything"] },
  { canonical: "skepticism / doesn't believe it works", patterns: ["doesn't work", "too good to be true", "skeptical", "doubt", "hard to believe", "sounds fake", "not convinced", "prove it"] },
  { canonical: "fear of commitment", patterns: ["long term", "commitment", "lock in", "contract", "cancel", "what if i change my mind", "not ready", "big decision"] },
  { canonical: "complexity / too hard", patterns: ["too complicated", "too hard", "too difficult", "overwhelming", "complex", "not for me", "can't do it", "not smart enough", "confusing"] },
  { canonical: "lack of support", patterns: ["no support", "on my own", "no help", "nobody to ask", "no community", "alone", "no guidance", "unsupported"] },
  { canonical: "physical limitations", patterns: ["injury", "health issue", "age", "too old", "condition", "disability", "can't physically", "limited", "pain"] },
];

export const TRANSFORMATION_PATTERNS: PatternCluster[] = [
  { canonical: "overweight → lean body", patterns: ["lost weight", "fat to fit", "overweight to", "went from", "pounds lost", "before and after weight", "used to be fat"] },
  { canonical: "weak → strong", patterns: ["got stronger", "weak to strong", "couldn't lift", "now i can", "strength gain", "progress", "personal record", "pr"] },
  { canonical: "unconfident → confident", patterns: ["gained confidence", "feel confident now", "used to hide", "now i show", "self esteem improved", "believe in myself now"] },
  { canonical: "confused → knowledgeable", patterns: ["now i understand", "finally get it", "everything clicked", "makes sense now", "learned so much", "knowledge changed"] },
  { canonical: "unhealthy → healthy lifestyle", patterns: ["changed my life", "healthy now", "feel amazing", "energy levels up", "sleeping better", "no more medication"] },
  { canonical: "beginner → experienced", patterns: ["started as beginner", "been doing this for", "years of experience", "journey", "when i started", "come a long way"] },
  { canonical: "stuck → progressing", patterns: ["broke through plateau", "finally seeing results", "making progress", "moving forward", "unstuck", "breakthrough"] },
];

export const EMOTIONAL_DRIVER_PATTERNS: PatternCluster[] = [
  { canonical: "shame / embarrassment", patterns: ["ashamed", "embarrassed", "embarrassing", "hate my body", "can't look in mirror", "hide", "cover up", "disgusted", "humiliated"] },
  { canonical: "confidence / self-worth", patterns: ["confident", "self worth", "feel good", "proud", "empowered", "self love", "believe in", "worthy", "self image"] },
  { canonical: "fear / anxiety", patterns: ["scared", "afraid", "anxious", "worried", "nervous", "fear of", "panic", "terrified", "dread", "overwhelmed"] },
  { canonical: "desire for attractiveness", patterns: ["attractive", "hot", "sexy", "good looking", "beauty", "handsome", "desirable", "turn heads", "eye catching"] },
  { canonical: "status / social proof", patterns: ["impress", "respect", "admire", "jealous", "envy", "status", "cool", "popular", "recognized", "influence"] },
  { canonical: "frustration / anger", patterns: ["angry", "furious", "rage", "pissed", "annoyed", "irritated", "fed up", "had enough", "sick of", "done with"] },
  { canonical: "hope / aspiration", patterns: ["dream", "hope", "aspire", "wish", "one day", "goal", "vision", "imagine", "someday", "possibility"] },
  { canonical: "guilt / regret", patterns: ["guilty", "regret", "should have", "wish i had", "missed opportunity", "too late", "wasted time", "if only", "blame myself"] },
  { canonical: "belonging / community", patterns: ["community", "together", "belong", "team", "family", "support group", "tribe", "accountability", "partner"] },
];

export const AWARENESS_PATTERNS = {
  UNAWARE: ["what is this", "never heard of", "what does that mean", "i don't know what", "first time seeing"],
  PROBLEM_AWARE: ["i have this problem", "struggling with", "can't figure out", "need help with", "dealing with", "suffering from"],
  SOLUTION_AWARE: ["looking for a solution", "what's the best way", "options for", "alternatives", "compared to", "which one is better", "reviews"],
  PRODUCT_AWARE: ["heard about", "seen your", "your product", "this brand", "recommend", "does it work", "thinking about buying"],
  MOST_AWARE: ["ready to buy", "where to order", "sign me up", "take my money", "just bought", "already using", "subscriber", "member"],
} as const;

export const MATURITY_KEYWORDS = {
  BEGINNER: [
    "how do i", "what is", "help me", "i don't know", "confused",
    "just starting", "beginner", "new to", "first time", "where do i start",
    "basic", "simple", "easy", "newbie", "getting started",
  ],
  DEVELOPING: [
    "i've tried", "compared to", "which is better", "my experience",
    "routine", "protocol", "strategy", "method", "approach",
    "i switched from", "alternative", "recommendation", "what worked for me",
  ],
  MATURE: [
    "roi", "conversion", "funnel", "optimization", "scaling",
    "metrics", "kpi", "attribution", "retention", "ltv",
    "cac", "churn", "segmentation", "a/b test", "split test",
    "compound", "periodization", "progressive overload", "macro",
    "advanced", "experienced", "years of",
  ],
} as const;

export const INTENT_KEYWORDS = {
  CURIOSITY: [
    "what do you think", "thoughts on", "curious", "interesting",
    "how does", "tell me more", "explain", "what about",
  ],
  LEARNING: [
    "how to", "tips", "advice", "guide", "tutorial", "teach me",
    "learn", "educate", "information", "resource",
  ],
  COMPARISON: [
    "vs", "versus", "compared to", "better than", "difference between",
    "which one", "or", "alternative", "instead of", "switch from",
  ],
  PURCHASE_INTENT: [
    "price", "cost", "buy", "purchase", "where can i get",
    "link", "discount", "how much", "available", "shipping",
    "order", "subscribe", "sign up", "enroll", "join",
  ],
} as const;

export const LANGUAGE_PATTERNS = {
  PROBLEM_EXPRESSIONS: [
    "i can't", "i struggle", "my problem", "issue with", "frustrated",
    "not working", "help me", "stuck with", "dealing with", "suffering",
    "can't figure out", "hard to", "difficult to", "impossible to",
  ],
  QUESTION_PATTERNS: [
    "how do", "what is", "why does", "can someone", "anyone know",
    "is it possible", "should i", "when should", "where can", "who has",
    "does anyone", "has anyone", "any tips", "any advice", "suggestions",
  ],
  GOAL_EXPRESSIONS: [
    "i want to", "my goal is", "trying to", "hoping to", "planning to",
    "dream of", "wish i could", "working towards", "aiming for", "looking to",
    "need to", "have to", "must", "gonna", "going to",
  ],
} as const;
