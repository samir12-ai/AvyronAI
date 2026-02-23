import { db } from "./db";
import { brandConfig, publishedPosts, captionVariants } from "@shared/schema";
import { eq } from "drizzle-orm";
import { aiChat } from "./ai-client";

interface CaseMetadata {
  goal: string;
  audience: string;
  cta: string;
  series?: string;
  offer?: string;
  mediaType: string;
  platform: string;
}

interface BrandRules {
  brandName: string;
  tone: string;
  forbiddenClaims: string;
  ctaStyle: string;
  hashtagPolicy: string;
  maxHashtags: number;
  languageStyle: string;
  targetIndustry: string;
}

interface ScoredCaption {
  text: string;
  toneScore: number;
  ctaScore: number;
  structureScore: number;
  lengthScore: number;
  totalScore: number;
}

async function getBrandRules(accountId: string): Promise<BrandRules> {
  const config = await db.select().from(brandConfig)
    .where(eq(brandConfig.accountId, accountId))
    .limit(1);

  if (config.length === 0) {
    return {
      brandName: "",
      tone: "professional",
      forbiddenClaims: "",
      ctaStyle: "direct",
      hashtagPolicy: "branded",
      maxHashtags: 5,
      languageStyle: "formal",
      targetIndustry: "",
    };
  }

  return {
    brandName: config[0].brandName || "",
    tone: config[0].tone || "professional",
    forbiddenClaims: config[0].forbiddenClaims || "",
    ctaStyle: config[0].ctaStyle || "direct",
    hashtagPolicy: config[0].hashtagPolicy || "branded",
    maxHashtags: config[0].maxHashtags || 5,
    languageStyle: config[0].languageStyle || "formal",
    targetIndustry: config[0].targetIndustry || "",
  };
}

function buildCaptionPrompt(metadata: CaseMetadata, brand: BrandRules): string {
  const forbiddenSection = brand.forbiddenClaims
    ? `\n- FORBIDDEN claims/words (NEVER use these): ${brand.forbiddenClaims}`
    : "";

  return `You are a world-class social media copywriter. Generate exactly 5 unique caption variants for a ${metadata.mediaType} post on ${metadata.platform}.

BRAND RULES:
- Brand name: ${brand.brandName || "the brand"}
- Tone: ${brand.tone}
- CTA style: ${brand.ctaStyle}
- Hashtag policy: ${brand.hashtagPolicy} (max ${brand.maxHashtags} hashtags)
- Language style: ${brand.languageStyle}
- Industry: ${brand.targetIndustry || "general"}${forbiddenSection}

POST METADATA:
- Goal: ${metadata.goal}
- Target audience: ${metadata.audience}
- Call to action: ${metadata.cta}
${metadata.series ? `- Series: ${metadata.series}` : ""}
${metadata.offer ? `- Offer: ${metadata.offer}` : ""}

REQUIREMENTS:
1. Each variant must be different in structure and approach
2. Include a clear CTA matching the "${brand.ctaStyle}" style
3. Use hashtags according to "${brand.hashtagPolicy}" policy (max ${brand.maxHashtags})
4. Match the "${brand.tone}" tone precisely
5. Optimize for ${metadata.platform} best practices
6. Variant 1: Hook-first (attention-grabbing opener)
7. Variant 2: Story-driven (mini narrative)
8. Variant 3: Value-first (lead with benefit)
9. Variant 4: Question-based (engage with curiosity)
10. Variant 5: Social proof / authority angle

Respond with ONLY a JSON array of 5 strings, each being a complete caption. No other text.
Example: ["caption 1...", "caption 2...", "caption 3...", "caption 4...", "caption 5..."]`;
}

function scoreCaptions(captions: string[], brand: BrandRules, metadata: CaseMetadata): ScoredCaption[] {
  return captions.map(text => {
    let toneScore = 70;
    const lowerText = text.toLowerCase();
    const lowerTone = brand.tone.toLowerCase();

    if (lowerTone === "professional") {
      if (!lowerText.includes("!") || lowerText.split("!").length <= 2) toneScore += 15;
      if (!lowerText.includes("lol") && !lowerText.includes("omg")) toneScore += 15;
    } else if (lowerTone === "casual" || lowerTone === "friendly") {
      if (lowerText.includes("!")) toneScore += 10;
      if (lowerText.includes("you") || lowerText.includes("your")) toneScore += 10;
    } else if (lowerTone === "luxury" || lowerTone === "premium") {
      if (!lowerText.includes("cheap") && !lowerText.includes("free")) toneScore += 15;
      if (lowerText.includes("exclusive") || lowerText.includes("premium") || lowerText.includes("curated")) toneScore += 10;
    }

    if (brand.forbiddenClaims) {
      const forbidden = brand.forbiddenClaims.split(",").map(c => c.trim().toLowerCase());
      for (const claim of forbidden) {
        if (claim && lowerText.includes(claim)) {
          toneScore -= 30;
        }
      }
    }
    toneScore = Math.max(0, Math.min(100, toneScore));

    let ctaScore = 50;
    const ctaLower = metadata.cta.toLowerCase();
    if (lowerText.includes(ctaLower) || lowerText.includes("link in bio") ||
        lowerText.includes("shop now") || lowerText.includes("learn more") ||
        lowerText.includes("book now") || lowerText.includes("dm") ||
        lowerText.includes("click") || lowerText.includes("sign up") ||
        lowerText.includes("get yours") || lowerText.includes("try")) {
      ctaScore += 30;
    }
    if (brand.ctaStyle === "direct") {
      if (lowerText.includes("now") || lowerText.includes("today")) ctaScore += 10;
    } else if (brand.ctaStyle === "soft") {
      if (lowerText.includes("discover") || lowerText.includes("explore")) ctaScore += 10;
    }
    ctaScore = Math.max(0, Math.min(100, ctaScore));

    let structureScore = 60;
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    if (lines.length >= 2) structureScore += 10;
    if (lines.length >= 3 && lines.length <= 8) structureScore += 15;
    const hasHashtags = text.includes("#");
    if (hasHashtags) {
      const hashtagCount = (text.match(/#\w+/g) || []).length;
      if (hashtagCount <= brand.maxHashtags) structureScore += 10;
      else structureScore -= 10;
    }
    if (text.includes("\n\n")) structureScore += 5;
    structureScore = Math.max(0, Math.min(100, structureScore));

    let lengthScore = 70;
    const charCount = text.length;
    if (metadata.platform.toLowerCase() === "instagram") {
      if (charCount >= 100 && charCount <= 2200) lengthScore = 90;
      else if (charCount >= 50 && charCount <= 300) lengthScore = 85;
      else if (charCount < 50) lengthScore = 50;
    } else if (metadata.platform.toLowerCase() === "facebook") {
      if (charCount >= 40 && charCount <= 500) lengthScore = 90;
      else if (charCount > 500) lengthScore = 70;
    } else if (metadata.platform.toLowerCase().includes("twitter") || metadata.platform.toLowerCase() === "x") {
      if (charCount <= 280) lengthScore = 90;
      else lengthScore = 40;
    }
    lengthScore = Math.max(0, Math.min(100, lengthScore));

    const totalScore = (toneScore * 0.3) + (ctaScore * 0.25) + (structureScore * 0.25) + (lengthScore * 0.2);

    return {
      text,
      toneScore: Math.round(toneScore),
      ctaScore: Math.round(ctaScore),
      structureScore: Math.round(structureScore),
      lengthScore: Math.round(lengthScore),
      totalScore: Math.round(totalScore),
    };
  });
}

export async function generateAndScoreCaptions(
  accountId: string,
  metadata: CaseMetadata,
  publishedPostId: string
): Promise<{ winner: ScoredCaption; allVariants: ScoredCaption[] }> {
  const brand = await getBrandRules(accountId);
  const prompt = buildCaptionPrompt(metadata, brand);

  let captions: string[] = [];
  try {
    const response = await aiChat({
      model: "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 3000,
      accountId: "default",
      endpoint: "caption-engine",
    });

    const content = response.choices[0]?.message?.content || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    captions = JSON.parse(cleaned);

    if (!Array.isArray(captions) || captions.length === 0) {
      throw new Error("Invalid caption response");
    }
  } catch (err) {
    console.error("[CaptionEngine] GPT generation failed, using fallback:", err);
    captions = [
      `${metadata.goal}. Perfect for ${metadata.audience}. ${metadata.cta}`,
      `Discover what ${metadata.audience} already know. ${metadata.cta}`,
      `Ready to ${metadata.goal.toLowerCase()}? ${metadata.cta}`,
      `This is for ${metadata.audience}. ${metadata.goal}. ${metadata.cta}`,
      `${metadata.offer || metadata.goal} — made for ${metadata.audience}. ${metadata.cta}`,
    ];
  }

  const scored = scoreCaptions(captions, brand, metadata);
  scored.sort((a, b) => b.totalScore - a.totalScore);

  for (let i = 0; i < scored.length; i++) {
    await db.insert(captionVariants).values({
      publishedPostId,
      captionText: scored[i].text,
      toneScore: scored[i].toneScore,
      ctaScore: scored[i].ctaScore,
      structureScore: scored[i].structureScore,
      lengthScore: scored[i].lengthScore,
      totalScore: scored[i].totalScore,
      selected: i === 0,
    });
  }

  return {
    winner: scored[0],
    allVariants: scored,
  };
}

export function validateCaseMetadata(body: any): { valid: boolean; missing: string[] } {
  const required = ["goal", "audience", "cta"];
  const missing: string[] = [];

  for (const field of required) {
    if (!body[field] || (typeof body[field] === "string" && body[field].trim() === "")) {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
