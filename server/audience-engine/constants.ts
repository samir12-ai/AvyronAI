export const AUDIENCE_ENGINE_VERSION = 1;

export const AUDIENCE_THRESHOLDS = {
  MIN_COMMENTS_FOR_ANALYSIS: 10,
  MIN_POSTS_FOR_ANALYSIS: 5,
  MIN_COMPETITORS_FOR_ANALYSIS: 2,
  MAX_COMMENTS_TO_ANALYZE: 300,
  MAX_POSTS_TO_ANALYZE: 100,
} as const;

export const SOPHISTICATION_KEYWORDS = {
  BEGINNER: [
    "how do i", "what is", "help me", "i don't know", "confused",
    "just starting", "beginner", "new to", "first time", "where do i start",
    "basic", "simple", "easy", "newbie", "noob", "getting started",
  ],
  INFORMED: [
    "i've tried", "compared to", "which is better", "my experience",
    "routine", "protocol", "strategy", "method", "approach",
    "i switched from", "alternative", "recommendation",
  ],
  SOPHISTICATED: [
    "roi", "conversion", "funnel", "optimization", "scaling",
    "metrics", "kpi", "attribution", "retention", "ltv",
    "cac", "churn", "segmentation", "a/b test", "split test",
    "compound", "periodization", "progressive overload", "macro",
  ],
} as const;

export const INTENT_KEYWORDS = {
  PROBLEM_SEEKING: [
    "help", "struggling", "can't", "issue", "problem", "frustrated",
    "not working", "how to fix", "anyone else", "stuck",
  ],
  CURIOSITY: [
    "what do you think", "thoughts on", "curious", "interesting",
    "how does", "tell me more", "explain", "what about",
  ],
  PURCHASE_INTENT: [
    "price", "cost", "buy", "purchase", "where can i get",
    "link", "discount", "how much", "available", "shipping",
    "order", "subscribe", "sign up",
  ],
  VALIDATION: [
    "this worked", "amazing", "love this", "great results",
    "can confirm", "proof", "testimonial", "before and after",
    "finally", "game changer",
  ],
} as const;

export const PAIN_KEYWORDS = {
  FRUSTRATION: ["frustrated", "frustrating", "annoying", "sick of", "tired of", "fed up"],
  CONFUSION: ["confused", "don't understand", "makes no sense", "overwhelming", "complicated"],
  FAILURE: ["didn't work", "failed", "waste of", "no results", "nothing changed", "still the same"],
  COST_CONCERN: ["expensive", "too much", "can't afford", "not worth", "overpriced", "cheaper"],
  TIME_PRESSURE: ["no time", "takes too long", "how long", "quick", "fast results", "immediately"],
  TRUST_ISSUES: ["scam", "fake", "legit", "trust", "honest", "real results", "proof"],
} as const;
