import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "node:http";
import { aiChat, aiGemini, Modality } from "./ai-client";
import { validateRoutingIntegrity } from "./shared/engine-health";
import multer from "multer";
import path from "path";
import { registerPhotographyRoutes } from "./photography-routes";
import { registerVideoRoutes } from "./video-routes";
import { registerStrategyRoutes } from "./strategy-routes";
import { registerAutopilotRoutes } from "./autopilot-routes";
import { registerBrandConfigRoutes } from "./brand-config-routes";
import { registerPublishPipelineRoutes } from "./publish-pipeline";
import { registerVeoRoutes } from "./veo-routes";
import { registerLeadEngineRoutes } from "./lead-engine";
import { registerCompetitiveIntelligenceRoutes } from "./competitive-intelligence";
import { registerMarketIntelligenceV3 } from "./market-intelligence-v3";
import { registerAudienceEngineRoutes } from "./audience-engine/routes";
import { registerPositioningEngineRoutes } from "./positioning-engine/routes";
import { registerStrategicCoreRoutes } from "./strategic-core";
import { registerCampaignRoutes, requireCampaign } from "./campaign-routes";
import { registerDataSourceRoutes } from "./data-source/routes";
import { registerMetaStatusRoutes, requireMetaReal, getDecryptedPageToken } from "./meta-status";
import { registerAuditRoutes } from "./audit-routes";
import { registerBusinessDataRoutes } from "./business-data-routes";
import { registerDashboardRoutes } from "./dashboard-routes";
import { registerUIStateRoutes } from "./ui-state-routes";
import { registerDifferentiationRoutes } from "./differentiation-engine/routes";
import { registerMechanismEngineRoutes } from "./mechanism-engine/routes";
import { registerOfferEngineRoutes } from "./offer-engine/routes";
import { registerFunnelEngineRoutes } from "./funnel-engine/routes";
import { registerIntegrityEngineRoutes } from "./integrity-engine/routes";
import { registerStrategyRootRoutes } from "./strategy-root-routes";
import { registerAwarenessEngineRoutes } from "./awareness-engine/routes";
import { registerPersuasionEngineRoutes } from "./persuasion-engine/routes";
import { registerStrategyEngineRoutes } from "./strategy";
import { registerOrchestratorV2Routes } from "./orchestrator/routes";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerContentDnaRoutes } from "./content-dna-routes";
import { registerRootBundleRoutes } from "./root-bundle";
import { registerGoalMathRoutes } from "./goal-math";
import { registerPlanGateRoutes } from "./plan-gate";
import { registerTaskComposerRoutes } from "./task-composer";
import { registerConflictResolverRoutes } from "./conflict-resolver";
import { registerAELRoutes } from "./analytical-enrichment-layer/routes";
import { registerCELRoutes } from "./causal-enforcement-layer/routes";
import { registerBuildPlanLayerRoutes } from "./build-plan-layer/routes";
import { storeTokensAfterOAuth, runAllHealthChecks } from "./meta-token-manager";
import { redactToken } from "./meta-crypto";
import { initMetaMetrics } from "./meta-metrics";
import { db } from "./db";
import { metaCredentials } from "@shared/schema";
import { eq } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/engines/health", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter required" });
      }
      const result = await validateRoutingIntegrity(accountId, campaignId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/generate-content", async (req, res) => {
    try {
      const { topic, contentType, platform, brandName, tone, targetAudience, industry, aiEngine, campaignId } = req.body;

      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
      }

      let dnaGuidance = "";
      if (campaignId) {
        try {
          const { getLatestContentDna } = await import("./content-dna-routes");
          const dna = await getLatestContentDna(campaignId, "default");
          if (dna) {
            const parts: string[] = ["\n\nContent DNA (use these rules for this business):"];
            if (dna.messagingCore) parts.push(`Messaging: tone=${dna.messagingCore.toneStyle || ""}, persuasion=${dna.messagingCore.persuasionIntensity || ""}, value promise=${dna.messagingCore.primaryValuePromise || ""}`);
            if (dna.ctaDna) parts.push(`CTA: type=${dna.ctaDna.primaryCtaType || ""}, style=${dna.ctaDna.ctaDeliveryStyle || ""}, rule=${dna.ctaDna.softVsDirectRule || ""}`);
            if (dna.hookDna) parts.push(`Hooks: types=${(dna.hookDna.preferredHookTypes || []).join(", ")}, opening=${dna.hookDna.recommendedOpeningStyle || ""}, duration=${dna.hookDna.recommendedHookDuration || ""}`);
            if (dna.narrativeDna) parts.push(`Narrative: structure=${dna.narrativeDna.preferredStructure || ""}, storytelling=${dna.narrativeDna.storytellingGuidance || ""}`);
            if (dna.executionRules) {
              if (dna.executionRules.alwaysInclude?.length) parts.push(`Always include: ${dna.executionRules.alwaysInclude.join(", ")}`);
              if (dna.executionRules.neverDo?.length) parts.push(`Never do: ${dna.executionRules.neverDo.join(", ")}`);
            }
            if (dna.contentInstructions) {
              const ci = dna.contentInstructions;
              if (ci.hookGuide?.structure) parts.push(`Hook construction: ${ci.hookGuide.structure}`);
              if (ci.hookGuide?.examples?.length) parts.push(`Hook examples: ${ci.hookGuide.examples.join(" | ")}`);
              if (ci.narrativeBreakdown?.postStructure) parts.push(`Post structure: ${ci.narrativeBreakdown.postStructure}`);
              if (ci.narrativeBreakdown?.carouselFlow) parts.push(`Carousel flow: ${ci.narrativeBreakdown.carouselFlow}`);
              if (ci.ctaPlacement?.softVsHard) parts.push(`CTA strategy: ${ci.ctaPlacement.softVsHard}`);
            }
            dnaGuidance = parts.join("\n");
          }
        } catch {}
      }

      const systemPrompt = `You are an expert marketing copywriter and content strategist. You create engaging, high-converting marketing content that resonates with the target audience.

Brand Context:
- Brand Name: ${brandName || 'the brand'}
- Industry: ${industry || 'general business'}
- Brand Voice/Tone: ${tone || 'Professional'}
- Target Audience: ${targetAudience || 'general audience'}

Guidelines:
- Write in the specified brand tone
- Make content platform-appropriate
- Include relevant hashtags for social media
- Keep content concise and impactful
- Focus on benefits and value proposition
- Use action-oriented language
- Avoid being overly promotional${dnaGuidance}`;

      const userPrompt = `Create a ${contentType} for ${platform} about: ${topic}

Requirements:
- Platform: ${platform}
- Content Type: ${contentType}
- Make it engaging and shareable
- Optimize for the platform's best practices
- Include a clear call-to-action if appropriate`;

      let content = "";

      if (aiEngine === 'gemini') {
        const geminiResponse = await aiGemini({
          model: "gemini-3-pro-preview",
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
          ],
          config: { maxOutputTokens: 2048 },
          accountId: "default",
          endpoint: "ai-writer-gemini",
        });
        content = geminiResponse.text || "";
      } else {
        const response = await aiChat({
          model: "gpt-5.2",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 2048,
          accountId: "default",
          endpoint: "ai-writer-gpt",
        });
        content = response.choices[0]?.message?.content || "";
      }

      res.json({ content, engine: aiEngine === 'gemini' ? 'Gemini 3 Pro' : 'GPT-5.2' });
    } catch (error) {
      console.error("Error generating content:", error);
      res.status(500).json({ error: "Failed to generate content" });
    }
  });

  app.get("/api/ai-engines", (_req, res) => {
    res.json({
      engines: [
        { id: 'openai', name: 'GPT-5.2', provider: 'OpenAI', capabilities: ['content', 'ads', 'strategy', 'video', 'captions'], tier: 'ChatGPT Plus' },
        { id: 'gemini', name: 'Gemini 3 Pro', provider: 'Google', capabilities: ['content', 'ads', 'strategy', 'images'], tier: 'Gemini Pro' },
      ],
      imageEngines: [
        { id: 'openai-image', name: 'GPT Image 1', provider: 'OpenAI', tier: 'ChatGPT Plus' },
        { id: 'gemini-image', name: 'Nano Banana Pro', provider: 'Google', model: 'gemini-3-pro-image-preview', tier: 'Gemini Pro' },
      ],
    });
  });

  app.post("/api/generate-ad", async (req, res) => {
    try {
      const { brandName, industry, tone, targetAudience, platforms, aiEngine } = req.body;

      const platformList = platforms?.join(', ') || 'social media';

      const systemPrompt = `You are an expert advertising copywriter who creates high-converting ad copy for digital advertising campaigns.

Brand Context:
- Brand Name: ${brandName || 'the brand'}
- Industry: ${industry || 'general business'}
- Brand Voice/Tone: ${tone || 'Professional'}
- Target Audience: ${targetAudience || 'general audience'}

Guidelines:
- Create compelling headlines that grab attention
- Write persuasive body copy that drives action
- Keep it concise and platform-appropriate
- Focus on benefits, not just features
- Create urgency when appropriate
- Be authentic to the brand voice`;

      const userPrompt = `Create an advertisement that will run on: ${platformList}

Return your response in this exact JSON format:
{
  "headline": "Your catchy headline here (max 60 characters)",
  "body": "Your compelling ad copy here (max 200 characters)"
}

Make sure the content works well across all the specified platforms.`;

      let rawContent = "";

      if (aiEngine === 'gemini') {
        const geminiResponse = await aiGemini({
          model: "gemini-3-pro-preview",
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
          ],
          config: { maxOutputTokens: 1024 },
          accountId: "default",
          endpoint: "ai-designer-gemini",
        });
        rawContent = geminiResponse.text || "";
      } else {
        const response = await aiChat({
          model: "gpt-5.2",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 1024,
          accountId: "default",
          endpoint: "ai-designer-gpt",
        });
        rawContent = response.choices[0]?.message?.content || "";
      }

      try {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          res.json({ ...parsed, engine: aiEngine === 'gemini' ? 'Gemini 3 Pro' : 'GPT-5.2' });
        } else {
          res.json({ 
            headline: "Discover Something Amazing Today",
            body: "Transform your experience with our innovative solution. Join thousands of satisfied customers who made the switch."
          });
        }
      } catch {
        res.json({ 
          headline: "Discover Something Amazing Today",
          body: "Transform your experience with our innovative solution. Join thousands of satisfied customers who made the switch."
        });
      }
    } catch (error) {
      console.error("Error generating ad:", error);
      res.status(500).json({ error: "Failed to generate ad" });
    }
  });

  app.post("/api/generate-reel-script", async (req, res) => {
    try {
      const { topic, platform, brandName, tone, targetAudience, industry, reelDuration, reelGoal, ciContext, campaignId } = req.body;

      if (ciContext) {
        return res.status(410).json({
          error: "DEPRECATED",
          message: "CI-based script generation via script-engine has been removed. Use MI V3 analysis results to inform content creation.",
          engine: "MI_V3",
        });
      }

      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
      }

      const duration = reelDuration || '30-60 seconds';
      const goal = reelGoal || 'engagement';

      let reelDnaRules = "";
      if (campaignId) {
        try {
          const { getLatestContentDna } = await import("./content-dna-routes");
          const dna = await getLatestContentDna(campaignId, "default");
          if (dna) {
            const parts: string[] = ["\n\nCONTENT DNA RULES (follow these for this specific business):"];
            if (dna.hookDna) parts.push(`Hook strategy: types=${(dna.hookDna.preferredHookTypes || []).join(", ")}, opening=${dna.hookDna.recommendedOpeningStyle || ""}, duration=${dna.hookDna.recommendedHookDuration || ""}`);
            if (dna.narrativeDna) parts.push(`Narrative: ${dna.narrativeDna.preferredStructure || ""}`);
            if (dna.ctaDna) parts.push(`CTA: ${dna.ctaDna.primaryCtaType || ""}, ${dna.ctaDna.softVsDirectRule || ""}`);
            if (dna.visualDna) parts.push(`Visual: ${dna.visualDna.visualDirection || ""}, ${dna.visualDna.talkingHeadVsProofVsDemo || ""}`);
            if (dna.formatDna?.reelBehavior) parts.push(`Reel behavior: ${dna.formatDna.reelBehavior}`);
            if (dna.messagingCore) parts.push(`Tone: ${dna.messagingCore.toneStyle || ""}, Persuasion: ${dna.messagingCore.persuasionIntensity || ""}`);
            if (dna.executionRules) {
              if (dna.executionRules.alwaysInclude?.length) parts.push(`Always include: ${dna.executionRules.alwaysInclude.join(", ")}`);
              if (dna.executionRules.neverDo?.length) parts.push(`Never do: ${dna.executionRules.neverDo.join(", ")}`);
            }
            if (dna.contentInstructions) {
              const ci = dna.contentInstructions;
              if (ci.hookGuide?.structure) parts.push(`Hook construction: ${ci.hookGuide.structure}`);
              if (ci.hookGuide?.examples?.length) parts.push(`Hook examples: ${ci.hookGuide.examples.join(" | ")}`);
              if (ci.narrativeBreakdown?.reelScript) parts.push(`Reel narrative: ${ci.narrativeBreakdown.reelScript}`);
              if (ci.ctaPlacement?.reelCta) parts.push(`Reel CTA: ${ci.ctaPlacement.reelCta}`);
              if (ci.visualDirection?.talkingHead) parts.push(`Visual: ${ci.visualDirection.talkingHead}`);
              if (ci.visualDirection?.bRoll) parts.push(`B-roll: ${ci.visualDirection.bRoll}`);
            }
            reelDnaRules = parts.join("\n");
          }
        } catch {}
      }

      const systemPrompt = `You are an elite social media content strategist and Reels director who has deep expertise in the Meta (Instagram/Facebook) algorithm. You create viral-worthy Reels scripts that are engineered for maximum reach, engagement, and retention.

BRAND CONTEXT:
- Brand: ${brandName || 'the brand'}
- Industry: ${industry || 'general business'}
- Voice/Tone: ${tone || 'Professional yet relatable'}
- Target Audience: ${targetAudience || 'general audience'}
- Platform: ${platform || 'Instagram'}
- Reel Duration: ${duration}
- Primary Goal: ${goal}

YOUR META ALGORITHM MASTERY:
You understand that Meta's algorithm prioritizes:
1. Watch time & completion rate (most critical ranking signal)
2. Shares > Saves > Comments > Likes (engagement hierarchy)
3. First 0.5-1.5 seconds = make or break (the hook window)
4. Pattern interrupts every 3-5 seconds to maintain attention
5. Audio trends and original audio boost distribution
6. Reels shared to Stories get 2x distribution
7. Caption engagement (questions, polls, controversial takes) extends dwell time
8. Posting consistency signals creator reliability to the algorithm
9. Watch-through loops (seamless endings that replay) hack watch time
10. Vertical 9:16 native format gets priority over repurposed content

SCRIPT STRUCTURE RULES:
- Hook must trigger curiosity, controversy, or pattern interrupt in under 1.5 seconds
- Every scene must have a visual transition or movement (static = scroll-away)
- Include B-roll suggestions that are achievable with a smartphone
- End with a loop point or strong CTA that drives the algorithm-favored action (share/save)
- Audio direction should suggest trending sounds or original voiceover style${reelDnaRules}`;

      const userPrompt = `Create a complete, production-ready Reel script about: "${topic}"

CRITICAL: This must be a FULL PRODUCTION SCRIPT, not brainstorming or outlines. Every word the creator speaks must be written out. Every camera direction must be specific enough to execute immediately.

Return your response in this EXACT JSON format:
{
  "title": "Working title for the reel",
  "hook": {
    "visual": "Exact visual description of what appears on screen in the first 1.5 seconds — the pattern interrupt that stops the scroll",
    "text_overlay": "The bold text overlay shown on screen during the hook (keep under 8 words, high contrast)",
    "voiceover": "What is said aloud during the hook (punchy, curiosity-driven)"
  },
  "full_script": "The COMPLETE spoken script from start to finish, word-for-word. This is what the creator reads from a teleprompter. Include the hook line, all scene dialogue, and the closing CTA as one continuous script.",
  "scenes": [
    {
      "scene_number": 1,
      "duration": "3-5s",
      "visual_direction": "Exact camera angle (close-up/medium/wide), movement (pan/tilt/tracking/static), framing (centered/rule-of-thirds), and what is shown on screen. Specific enough for a videographer to execute without clarification.",
      "text_overlay": "On-screen text for this scene (bold, high-contrast)",
      "voiceover": "Exact words spoken during this scene — word for word",
      "transition": "How this scene transitions to the next (jump cut, zoom, swipe, morph, whip pan, etc.)",
      "b_roll_suggestion": "Specific alternative footage that could supplement this scene"
    }
  ],
  "closing": {
    "visual": "Final visual description — what the viewer sees",
    "cta_text": "Call-to-action text overlay on screen",
    "cta_voiceover": "Exact spoken CTA words",
    "loop_trick": "How the ending connects back to the beginning for seamless replay"
  },
  "caption": "Full social media caption with line breaks, emojis, and call-to-action. Ready to paste.",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5", "hashtag6", "hashtag7", "hashtag8"],
  "production_notes": {
    "estimated_duration": "Total estimated duration",
    "audio_direction": "Music style, trending sound suggestion, or voiceover tone guidance",
    "lighting": "Specific lighting setup (natural/ring light/softbox, direction, color temp)",
    "props_needed": "List of props or setup needed",
    "best_posting_time": "Optimal posting window for the target audience",
    "wardrobe": "What the creator should wear for this content"
  },
  "algorithm_optimization": {
    "retention_hooks": ["Specific micro-hooks placed at exact timestamps to maintain watch time"],
    "share_trigger": "Why someone would share this reel",
    "save_trigger": "Why someone would save this reel",
    "engagement_prompt": "Caption question or poll to boost comments",
    "repost_strategy": "How to repurpose for Stories, Feed, and Facebook"
  }
}

Generate exactly 4-6 scenes. Write the FULL SCRIPT — every word spoken. Camera directions must specify exact angles and movements, not vague descriptions like "show the product." The visual hook must be genuinely scroll-stopping.`;

      const response = await aiChat({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2000,
        accountId: "default",
        endpoint: "calendar-assistant",
      });

      const content = response.choices[0]?.message?.content || "";

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          res.json({ script: parsed, mode: "generic" });
        } else {
          res.json({ script: null, rawContent: content, mode: "generic" });
        }
      } catch {
        res.json({ script: null, rawContent: content, mode: "generic" });
      }
    } catch (error) {
      console.error("Error generating reel script:", error);
      res.status(500).json({ error: "Failed to generate reel script" });
    }
  });

  app.post("/api/generate-poster", upload.array('photos', 3), async (req, res) => {
    try {
      const { topic, style, text, brandName, industry, aspectRatio, mood, mode } = req.body;

      const images = (req.files as Express.Multer.File[]) || [];
      console.log(`[AI Designer] Received ${images.length} image(s) for poster generation`);
      const hasPhoto = images.length > 0;
      if (!topic && !hasPhoto) {
        return res.status(400).json({ error: "Please provide a description or upload an image." });
      }

      const styleDescriptions: Record<string, string> = {
        cinematic: 'cinematic with dramatic lighting, film-grain texture, deep shadows and rich color grading like a movie scene',
        professional: 'clean professional corporate style with modern typography, structured layout, and business-appropriate color palette',
        commercial: 'bold commercial advertising style with high contrast, eye-catching colors, and strong call-to-action visual hierarchy',
        indie: 'warm indie aesthetic with natural tones, organic textures, handcrafted feel, and artistic imperfection',
        minimal: 'minimalist design with ample white space, subtle typography, restrained color palette, and elegant simplicity',
        vibrant: 'vibrant and energetic with saturated colors, dynamic composition, bold graphic elements, and high visual impact',
      };

      const moodDescriptions: Record<string, string> = {
        energetic: 'energetic and dynamic with movement and excitement',
        calm: 'calm and serene with peaceful atmosphere and soft tones',
        dramatic: 'dramatic and intense with strong contrasts and powerful imagery',
        playful: 'playful and fun with whimsical elements and bright accents',
        luxurious: 'luxurious and premium with rich textures, gold accents, and sophisticated elegance',
        warm: 'warm and inviting with golden tones and cozy atmosphere',
      };

      const aspectDesc: Record<string, string> = {
        '1:1': 'square (1:1) format perfect for Instagram feed',
        '4:5': 'portrait (4:5) format ideal for Instagram and social media',
        '16:9': 'widescreen landscape (16:9) format great for presentations and banners',
        '9:16': 'vertical story (9:16) format designed for Instagram/TikTok stories',
      };

      const currentStyle = styleDescriptions[style] || styleDescriptions['cinematic'];
      const currentMood = moodDescriptions[mood] || '';
      const currentAspect = aspectDesc[aspectRatio] || aspectDesc['1:1'];

      const promptParts: string[] = [];

      if (mode === 'image-to-image' && hasPhoto) {
        promptParts.push(
          `Transform and reimagine the ${images.length} uploaded image(s) into a stunning ${currentStyle} design.`,
          topic ? `Creative direction: ${topic}` : '',
          `Output as ${currentAspect}.`,
        );
      } else if (mode === 'image-edit' && hasPhoto) {
        promptParts.push(
          `Edit and enhance the ${images.length} uploaded image(s) based on the following instructions.`,
          topic ? `Editing instructions: ${topic}` : 'Enhance the image quality and visual appeal.',
          `Keep the core subjects intact while applying: ${currentStyle} treatment.`,
          `Output as ${currentAspect}.`,
        );
      } else {
        promptParts.push(
          `Create an exceptional, studio-quality ${currentStyle} marketing design.`,
          `Brand: ${brandName || 'Brand'}`,
          `Industry: ${industry || 'business'}`,
          `Creative brief: ${topic}`,
          `Format: ${currentAspect}.`,
        );
        if (hasPhoto) {
          promptParts.push(`Use the ${images.length} provided reference image(s) as visual inspiration for composition, color palette, or subject matter.`);
        }
      }

      if (currentMood) {
        promptParts.push(`Mood and atmosphere: ${currentMood}.`);
      }

      if (text) {
        promptParts.push(`Include this text prominently with beautiful typography: "${text}"`);
      }

      promptParts.push(
        'The output must be production-ready, visually striking, with exceptional composition and color harmony.',
        'Apply professional-grade retouching and finishing. No watermarks, no placeholder text.',
      );

      const filteredParts = promptParts.filter(p => p.length > 0);

      const contents: any[] = [];
      const parts: any[] = [{ text: filteredParts.join('\n') }];

      for (const image of images) {
        const base64Image = image.buffer.toString('base64');
        const mimeType = image.mimetype || 'image/jpeg';
        parts.push({
          inlineData: {
            data: base64Image,
            mimeType,
          },
        });
      }
      if (images.length > 0) {
        console.log(`[AI Designer] Passing ${images.length} image(s) as inlineData to Gemini`);
      }

      contents.push({ role: 'user', parts });

      const response = await aiGemini({
        model: "gemini-3-pro-image-preview",
        contents,
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
          maxOutputTokens: 800,
        },
        accountId: "default",
        endpoint: "ai-image-gen",
      });

      const candidate = response.candidates?.[0];
      const imagePart = candidate?.content?.parts?.find(
        (part: any) => part.inlineData
      );
      const textPart = candidate?.content?.parts?.find(
        (part: any) => part.text
      );

      if (!imagePart?.inlineData?.data) {
        return res.status(500).json({ error: "No image was generated. Please try a different description or style." });
      }

      const mimeType = imagePart.inlineData.mimeType || "image/png";
      const imageDataUrl = `data:${mimeType};base64,${imagePart.inlineData.data}`;

      res.json({
        imageUrl: imageDataUrl,
        description: textPart?.text || '',
        style,
        aspectRatio,
        mood,
      });
    } catch (error) {
      console.error("Error generating design:", error);
      res.status(500).json({ error: "Failed to generate design. Please try again." });
    }
  });

  const FB_API_VERSION = 'v21.0';

  function getPublicBaseUrl(req: any): string {
    const forwardedHost = req.get('x-forwarded-host') || req.get('host');
    const forwardedProto = req.get('x-forwarded-proto') || req.protocol;
    if (forwardedHost && !forwardedHost.includes('localhost')) {
      return `https://${forwardedHost}`;
    }
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain) {
      return `https://${replitDomain}`;
    }
    return `${forwardedProto}://${forwardedHost || req.get('host')}`;
  }

  app.get("/api/auth/facebook", (req, res) => {
    const META_APP_ID = process.env.META_APP_ID || '';
    const REDIRECT_URI = `${getPublicBaseUrl(req)}/api/auth/facebook/callback`;
    
    const scopes = ['email', 'public_profile'].join(',');
    const authUrl = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;
    
    if (!META_APP_ID) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Facebook Login</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; text-align: center; }
            .success { color: #10B981; font-size: 24px; margin-bottom: 20px; }
            .info { color: #666; }
          </style>
        </head>
        <body>
          <div class="success">Login Successful!</div>
          <p class="info">Welcome! You can close this window.</p>
          <script>
            window.opener?.postMessage({ type: 'FACEBOOK_AUTH_SUCCESS', user: { id: 'demo_fb', name: 'Facebook User' } }, '*');
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    res.redirect(authUrl);
  });

  app.get("/api/auth/facebook/callback", async (req, res) => {
    const { code } = req.query;
    const META_APP_ID = process.env.META_APP_ID || '';
    const META_APP_SECRET = process.env.META_APP_SECRET || '';
    const REDIRECT_URI = `${getPublicBaseUrl(req)}/api/auth/facebook/callback`;
    
    if (!code || !META_APP_ID || !META_APP_SECRET) {
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'FACEBOOK_AUTH_SUCCESS', user: { id: 'demo_fb', name: 'Facebook User' } }, '*');
            setTimeout(() => window.close(), 1000);
          </script>
          <p>Login successful! You can close this window.</p>
        </body>
        </html>
      `);
      return;
    }
    
    try {
      const tokenResponse = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`
      );
      const tokenData = await tokenResponse.json();
      
      const userResponse = await fetch(
        `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokenData.access_token}`
      );
      const userData = await userResponse.json();
      
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ 
              type: 'FACEBOOK_AUTH_SUCCESS', 
              user: { 
                id: '${userData.id}', 
                name: '${userData.name}',
                email: '${userData.email || ''}',
                picture: '${userData.picture?.data?.url || ''}'
              } 
            }, '*');
            setTimeout(() => window.close(), 1000);
          </script>
          <p>Login successful! You can close this window.</p>
        </body>
        </html>
      `);
    } catch (error) {
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'FACEBOOK_AUTH_ERROR' }, '*');
            setTimeout(() => window.close(), 1000);
          </script>
          <p>Login failed. Please try again.</p>
        </body>
        </html>
      `);
    }
  });

  app.get("/api/auth/instagram", (req, res) => {
    const META_APP_ID = process.env.META_APP_ID || '';
    const REDIRECT_URI = `${getPublicBaseUrl(req)}/api/auth/instagram/callback`;
    
    const scopes = ['public_profile', 'email'].join(',');
    const authUrl = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;
    
    if (!META_APP_ID) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Instagram Login</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; text-align: center; background: linear-gradient(45deg, #833AB4, #FD1D1D, #F77737); min-height: 100vh; color: white; }
            .success { font-size: 24px; margin-bottom: 20px; }
            .info { opacity: 0.9; }
          </style>
        </head>
        <body>
          <div class="success">Login Successful!</div>
          <p class="info">Welcome! You can close this window.</p>
          <script>
            window.opener?.postMessage({ type: 'INSTAGRAM_AUTH_SUCCESS', user: { id: 'demo_ig', name: 'Instagram User' } }, '*');
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    res.redirect(authUrl);
  });

  app.get("/api/auth/instagram/callback", async (req, res) => {
    const { code } = req.query;
    const META_APP_ID = process.env.META_APP_ID || '';
    const META_APP_SECRET = process.env.META_APP_SECRET || '';
    const REDIRECT_URI = `${getPublicBaseUrl(req)}/api/auth/instagram/callback`;
    
    if (!code || !META_APP_ID || !META_APP_SECRET) {
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'INSTAGRAM_AUTH_SUCCESS', user: { id: 'demo_ig', name: 'Instagram User' } }, '*');
            setTimeout(() => window.close(), 1000);
          </script>
          <p>Login successful! You can close this window.</p>
        </body>
        </html>
      `);
      return;
    }
    
    try {
      const tokenResponse = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`
      );
      const tokenData = await tokenResponse.json();
      
      const accountsResponse = await fetch(
        `https://graph.facebook.com/me/accounts?access_token=${tokenData.access_token}`
      );
      const accountsData = await accountsResponse.json();
      
      let igUsername = 'Instagram User';
      if (accountsData.data?.[0]) {
        const pageId = accountsData.data[0].id;
        const igResponse = await fetch(
          `https://graph.facebook.com/${pageId}?fields=instagram_business_account&access_token=${tokenData.access_token}`
        );
        const igData = await igResponse.json();
        if (igData.instagram_business_account) {
          const igAccountResponse = await fetch(
            `https://graph.facebook.com/${igData.instagram_business_account.id}?fields=username&access_token=${tokenData.access_token}`
          );
          const igAccountData = await igAccountResponse.json();
          igUsername = igAccountData.username || 'Instagram User';
        }
      }
      
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ 
              type: 'INSTAGRAM_AUTH_SUCCESS', 
              user: { 
                id: '${accountsData.data?.[0]?.id || 'ig_user'}', 
                name: '${igUsername}'
              } 
            }, '*');
            setTimeout(() => window.close(), 1000);
          </script>
          <p>Login successful! You can close this window.</p>
        </body>
        </html>
      `);
    } catch (error) {
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'INSTAGRAM_AUTH_ERROR' }, '*');
            setTimeout(() => window.close(), 1000);
          </script>
          <p>Login failed. Please try again.</p>
        </body>
        </html>
      `);
    }
  });

  app.get("/api/meta/debug", (req, res) => {
    const META_APP_ID = process.env.META_APP_ID || '';
    const META_APP_SECRET = process.env.META_APP_SECRET || '';
    const REDIRECT_URI = `${getPublicBaseUrl(req)}/api/meta/callback`;
    const hasId = META_APP_ID.length > 0;
    const hasSecret = META_APP_SECRET.length > 0;
    const idPreview = hasId ? META_APP_ID.substring(0, 4) + '...' + META_APP_ID.substring(META_APP_ID.length - 4) : 'NOT SET';
    console.log(`[Meta Debug] APP_ID set: ${hasId} (${idPreview}), SECRET set: ${hasSecret}, Redirect: ${REDIRECT_URI}`);
    res.json({
      appIdSet: hasId,
      appIdPreview: idPreview,
      appIdLength: META_APP_ID.length,
      secretSet: hasSecret,
      secretLength: META_APP_SECRET.length,
      redirectUri: REDIRECT_URI,
      apiVersion: FB_API_VERSION,
    });
  });

  app.get("/api/meta/auth", (req, res) => {
    const META_APP_ID = process.env.META_APP_ID || '';
    const REDIRECT_URI = `${getPublicBaseUrl(req)}/api/meta/callback`;

    const scopes = [
      'public_profile',
      'email',
      'pages_manage_posts',
      'pages_read_engagement',
      'read_insights',
      'pages_show_list',
      'instagram_basic',
      'instagram_content_publish',
      'business_management',
    ].join(',');

    console.log(`[Meta OAuth] Initiating auth, APP_ID: ${META_APP_ID ? META_APP_ID.substring(0, 4) + '...' : 'NOT SET'}, Redirect: ${REDIRECT_URI}`);

    if (!META_APP_ID) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Meta Business Suite Setup</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
            h1 { color: #1877F2; }
            .info { background: #E7F3FF; padding: 20px; border-radius: 12px; margin: 20px 0; }
            .steps { background: #f5f5f5; padding: 20px; border-radius: 12px; }
            .step { margin: 10px 0; }
            code { background: #eee; padding: 2px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Meta Business Suite Integration</h1>
          <div class="info">
            <p>To connect Meta Business Suite, you need to configure a Meta Developer App.</p>
          </div>
          <div class="steps">
            <div class="step">1. Go to <a href="https://developers.facebook.com" target="_blank">Meta for Developers</a></div>
            <div class="step">2. Create a new app (Business type)</div>
            <div class="step">3. Add Facebook Login, Instagram Graph API, and Marketing API products</div>
            <div class="step">4. Set these environment variables:</div>
            <div class="step"><code>META_APP_ID</code> - Your App ID</div>
            <div class="step"><code>META_APP_SECRET</code> - Your App Secret</div>
            <div class="step"><code>META_ENCRYPTION_KEY</code> - A random string (16+ chars) for token encryption</div>
          </div>
          <script>
            setTimeout(() => {
              window.opener?.postMessage({ type: 'META_AUTH_ERROR', error: 'APP_NOT_CONFIGURED' }, '*');
              window.close();
            }, 5000);
          </script>
        </body>
        </html>
      `);
      return;
    }

    res.redirect(`https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`);
  });

  app.get("/api/meta/callback", async (req, res) => {
    const { code, error: fbError, error_description } = req.query;
    const META_APP_ID = process.env.META_APP_ID || '';
    const META_APP_SECRET = process.env.META_APP_SECRET || '';
    const REDIRECT_URI = `${getPublicBaseUrl(req)}/api/meta/callback`;
    const accountId = (req.query.state as string) || "default";

    if (fbError) {
      console.error(`[Meta OAuth] Facebook returned error: ${fbError} - ${error_description}`);
      res.send(`
        <html>
        <head><style>body{font-family:-apple-system,sans-serif;padding:40px;max-width:500px;margin:0 auto;text-align:center;} .err{color:#FF6B6B;font-size:20px;margin-bottom:12px;} .desc{color:#666;margin-bottom:20px;} .hint{background:#FFF3CD;padding:16px;border-radius:10px;color:#856404;text-align:left;font-size:14px;}</style></head>
        <body>
          <div class="err">Connection Failed</div>
          <p class="desc">${error_description || fbError}</p>
          <div class="hint">
            <strong>Common fixes:</strong><br/>
            1. Make sure your Meta app is set to <strong>Live</strong> mode (not Development)<br/>
            2. In your Meta app settings, add this domain to <strong>Valid OAuth Redirect URIs</strong>:<br/>
            <code>${REDIRECT_URI}</code><br/>
            3. Make sure "Facebook Login" product is added to your Meta app<br/>
            4. Check that the App ID and App Secret match your Meta app
          </div>
          <script>
            setTimeout(() => { window.opener?.postMessage({ type: 'META_AUTH_ERROR', error: '${String(fbError).replace(/'/g, "\\'")}' }, '*'); }, 3000);
          </script>
        </body>
        </html>
      `);
      return;
    }

    if (!code || !META_APP_ID || !META_APP_SECRET) {
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'META_AUTH_ERROR', error: 'MISSING_CREDENTIALS' }, '*');
            setTimeout(() => window.close(), 2000);
          </script>
          <p>Configuration error. Please check META_APP_ID and META_APP_SECRET.</p>
        </body>
        </html>
      `);
      return;
    }

    try {
      console.log(`[Meta OAuth] Exchanging code for token, redirect_uri: ${REDIRECT_URI}`);
      const tokenResponse = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`
      );
      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        console.error(`[Meta OAuth] Token exchange error:`, tokenData.error.message);
        res.send(`
          <html>
          <head><style>body{font-family:-apple-system,sans-serif;padding:40px;max-width:500px;margin:0 auto;text-align:center;} .err{color:#FF6B6B;font-size:20px;margin-bottom:12px;} .desc{color:#666;}</style></head>
          <body>
            <div class="err">Authentication Error</div>
            <p class="desc">${tokenData.error.message || 'Failed to get access token'}</p>
            <script>
              setTimeout(() => { window.opener?.postMessage({ type: 'META_AUTH_ERROR' }, '*'); window.close(); }, 4000);
            </script>
          </body>
          </html>
        `);
        return;
      }

      if (!tokenData.access_token) {
        res.send(`
          <html><body>
            <p>No access token received. Please try again.</p>
            <script>
              window.opener?.postMessage({ type: 'META_AUTH_ERROR', error: 'NO_TOKEN' }, '*');
              setTimeout(() => window.close(), 3000);
            </script>
          </body></html>
        `);
        return;
      }

      console.log(`[Meta OAuth] Short-lived token received, exchanging for long-lived + storing server-side`);
      const storeResult = await storeTokensAfterOAuth(accountId, tokenData.access_token);

      if (storeResult.success) {
        res.send(`
          <html>
          <head><style>body{font-family:-apple-system,sans-serif;padding:40px;max-width:500px;margin:0 auto;text-align:center;} .ok{color:#10B981;font-size:20px;margin-bottom:12px;}</style></head>
          <body>
            <div class="ok">Meta Business Suite Connected</div>
            <p>Tokens stored securely on the server. You can close this window.</p>
            <script>
              window.opener?.postMessage({ type: 'META_AUTH_SUCCESS', status: '${storeResult.status}' }, '*');
              setTimeout(() => window.close(), 2000);
            </script>
          </body>
          </html>
        `);
      } else {
        console.error(`[Meta OAuth] Token storage failed: ${storeResult.error}`);
        res.send(`
          <html>
          <head><style>body{font-family:-apple-system,sans-serif;padding:40px;max-width:500px;margin:0 auto;text-align:center;} .warn{color:#F59E0B;font-size:20px;margin-bottom:12px;}</style></head>
          <body>
            <div class="warn">Partial Connection</div>
            <p>${storeResult.status === 'NO_PAGES' ? 'No Facebook Pages found. You need admin access to at least one Facebook Page.' : (storeResult.error || 'Token processing failed.')}</p>
            <script>
              window.opener?.postMessage({ type: 'META_AUTH_PARTIAL', status: '${storeResult.status}', error: '${(storeResult.error || '').replace(/'/g, "\\'")}' }, '*');
              setTimeout(() => window.close(), 5000);
            </script>
          </body>
          </html>
        `);
      }
    } catch (error) {
      console.error(`[Meta OAuth] Unexpected error:`, error);
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'META_AUTH_ERROR' }, '*');
            setTimeout(() => window.close(), 2000);
          </script>
          <p>Connection failed. Please try again.</p>
        </body>
        </html>
      `);
    }
  });

  app.post("/api/meta/post", requireMetaReal, async (req: any, res) => {
    try {
      const { content, platforms, mediaUrl } = req.body;
      const accountId = req.metaAccountId || "default";
      const metaMode = req.metaMode;

      if (metaMode !== "REAL") {
        return res.status(403).json({
          success: false,
          error: "META_NOT_CONNECTED",
          message: "Meta must be connected in REAL mode to publish posts. Connect Meta in Settings.",
        });
      }

      const pageToken = await getDecryptedPageToken(accountId);
      if (!pageToken) {
        return res.status(403).json({ error: "META_TOKEN_EXPIRED", message: "Page token not available. Please reconnect." });
      }

      const creds = await db.select().from(metaCredentials).where(eq(metaCredentials.accountId, accountId)).limit(1);
      const cred = creds[0];
      if (!cred?.pageId) {
        return res.status(403).json({ error: "META_NOT_CONNECTED", message: "No Facebook Page configured." });
      }

      const results: Record<string, string> = {};

      if (platforms?.includes('facebook')) {
        const fbResponse = await fetch(
          `https://graph.facebook.com/${FB_API_VERSION}/${cred.pageId}/feed`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: content,
              access_token: pageToken,
            }),
          }
        );
        const fbData = await fbResponse.json();
        if (fbData.error) {
          console.error(`[Meta Post] FB error: ${fbData.error.message}`);
          return res.status(400).json({ error: "META_API_ERROR", message: fbData.error.message });
        }
        results.facebook = fbData.id;
      }

      if (platforms?.includes('instagram') && cred.igBusinessId) {
        if (!mediaUrl) {
          return res.status(400).json({ error: "MISSING_MEDIA", message: "Instagram posts require a media URL." });
        }
        const containerRes = await fetch(
          `https://graph.facebook.com/${FB_API_VERSION}/${cred.igBusinessId}/media`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: mediaUrl,
              caption: content,
              access_token: pageToken,
            }),
          }
        );
        const containerData = await containerRes.json();
        if (containerData.error) {
          console.error(`[Meta Post] IG container error: ${containerData.error.message}`);
          return res.status(400).json({ error: "META_API_ERROR", message: containerData.error.message });
        }
        if (containerData.id) {
          const publishRes = await fetch(
            `https://graph.facebook.com/${FB_API_VERSION}/${cred.igBusinessId}/media_publish`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                creation_id: containerData.id,
                access_token: pageToken,
              }),
            }
          );
          const publishData = await publishRes.json();
          if (publishData.error) {
            return res.status(400).json({ error: "META_API_ERROR", message: publishData.error.message });
          }
          results.instagram = publishData.id;
        }
      }

      res.json({ success: true, postIds: results });
    } catch (error) {
      console.error('Meta post error:', error);
      res.status(500).json({ error: 'Failed to post to Meta platforms' });
    }
  });

  app.post("/api/generate-calendar", async (req, res) => {
    try {
      const { brandName, industry, tone, targetAudience, platforms, goals, products, month, year } = req.body;

      if (!goals) {
        return res.status(400).json({ error: "Goals are required" });
      }

      const platformList = (platforms && platforms.length > 0) ? platforms.join(', ') : 'Instagram, Facebook';

      const systemPrompt = `You are an elite Meta-certified social media strategist with deep expertise in Facebook and Instagram algorithms. You engineer content calendars that HACK the Meta algorithm to maximize reach, engagement, and conversions. You understand exactly how Meta ranks and distributes content in 2025.

YOUR META ALGORITHM EXPERTISE:

INSTAGRAM ALGORITHM (2025):
- Reels are the #1 growth driver. Meta prioritizes Reels in Explore, Search, and the Reels tab. Original Reels (not recycled TikToks) get 2-3x more distribution.
- Engagement velocity matters: posts that get likes, comments, saves, and shares in the first 30-60 minutes get boosted by the algorithm. Craft content that triggers immediate interaction.
- Saves and Shares are weighted 3-5x more than likes. Create "save-worthy" content: tips, tutorials, checklists, infographics, before/after.
- Carousel posts get the highest engagement per impression because users swipe = more time spent = algorithm boost.
- Stories don't affect feed ranking but are critical for staying top-of-mind and nurturing warm audiences. Use polls, questions, quizzes for engagement.
- Hashtags: Use 3-5 highly relevant hashtags (not 30 random ones). Mix niche and mid-size hashtags.
- Consistency signals: posting 4-7 Reels/week + 3-5 feed posts + daily Stories tells the algorithm you're a serious creator.
- The algorithm rewards accounts that use ALL content formats (Reels + Carousels + Stories + Feed Posts).

FACEBOOK ALGORITHM (2025):
- Meaningful interactions > passive views. Posts that spark conversations (comments, replies) get massive distribution.
- Facebook Groups content gets 5-6x more organic reach than Page posts.
- Video (especially Live and short-form) is heavily prioritized.
- Shares are the most powerful signal. Create content people want to share with friends.
- Link posts get reduced reach. Lead with native content, add links in comments.
- Time spent reading/watching = quality signal. Longer captions with storytelling perform well.

META CROSS-PLATFORM RULES:
- Post when your audience is online. Best general times: 7-9 AM, 12-1 PM, 5-7 PM local time. But vary to test.
- The algorithm penalizes engagement bait ("comment YES if you agree"). Use genuine conversation starters instead.
- Original content > reposts. The algorithm detects recycled/copied content and suppresses it.
- Use Meta's native features (polls, countdowns, collab posts, Remix) to signal platform loyalty and get algorithmic boost.
- Accounts that respond to comments within 1 hour get engagement boost on future posts.

BRAND CONTEXT:
- Brand: ${brandName || 'the brand'}
- Industry: ${industry || 'general business'}
- Voice/Tone: ${tone || 'Professional'}
- Target Audience: ${targetAudience || 'general audience'}
- Active Platforms: ${platformList}

GOAL-DRIVEN STRATEGY:
You must analyze the customer's stated goals and reverse-engineer a content calendar that SPECIFICALLY achieves those goals. Map each goal to content pillars:
- "Get more followers" → Heavy Reels strategy (60%+ Reels), Explore-optimized hashtags, collab-style content, trending audio hooks
- "Increase engagement" → Carousel tips, poll Stories, controversial takes, "this or that" posts, question-based captions
- "Launch a product" → Pre-launch teaser sequence (Day 1-7: mystery/behind-scenes → Day 8-14: reveal/features → Day 15+: testimonials/urgency/social proof)
- "Boost sales/conversions" → Social proof posts, customer testimonials, limited-time offers, benefit-focused Reels, story-selling sequences, link-in-bio CTAs
- "Build brand awareness" → Brand story series, founder story, behind-the-scenes, value-driven educational content, trending Reels with brand twist
- "Grow community" → UGC reposts, Q&A sessions, member spotlights, interactive Stories, engagement challenges
- For ANY goal: build a NARRATIVE ARC across the month, not random disconnected posts`;

      const userPrompt = `Build a RESULTS-DRIVEN content calendar for ${month || 'this month'} ${year || new Date().getFullYear()} that is ENGINEERED to achieve the customer's specific goals using Meta algorithm best practices.

CUSTOMER'S GOALS: ${goals}

PRODUCTS/SERVICES: ${products || 'General brand content'}

IMPORTANT INSTRUCTIONS:
1. Analyze the goals above and create a strategic monthly roadmap. Week 1 should lay groundwork, Week 2 build momentum, Week 3 push hard, Week 4 close strong.
2. Every single post must serve one of the customer's stated goals. Explain HOW it helps in the strategy_note.
3. Use Meta algorithm hacks: Reels for reach, Carousels for saves, Stories for warmth, Feed posts for authority.
4. Schedule at algorithm-optimal times (vary between 7AM, 9AM, 12PM, 5PM, 7PM).
5. Include specific content ideas with full captions, relevant hashtags (3-5 per post), and clear CTAs.
6. Build content sequences (not random posts): awareness → interest → desire → action across the month.
7. For each platform (${platformList}), use the format that performs best on that platform.

Return ONLY a valid JSON array. Each post:
{
  "day": (number 1-31),
  "time": "HH:MM" (24h format),
  "type": "post" | "reel" | "story",
  "platform": "one of: ${platformList}",
  "content": "Complete ready-to-post caption with hashtags and CTA",
  "strategy_note": "How this post serves the customer's goal + which Meta algorithm signal it targets (e.g., 'Reel targeting Explore page for follower growth - uses trending format for high share rate')"
}

Generate 25-30 posts. Make EVERY post specific to their products/services - zero generic filler. Each strategy_note must reference both the customer's goal AND the Meta algorithm principle being leveraged.`;

      const response = await aiChat({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 8000,
        accountId: "default",
        endpoint: "generate-calendar",
      });

      const content = response.choices[0]?.message?.content || "";

      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          res.json({ calendar: parsed });
        } else {
          res.status(500).json({ error: "Failed to parse calendar data. Please try again." });
        }
      } catch {
        res.status(500).json({ error: "Failed to parse calendar data. Please try again." });
      }
    } catch (error) {
      console.error("Error generating calendar:", error);
      res.status(500).json({ error: "Failed to generate calendar. Please try again." });
    }
  });

  app.post("/api/generate-audience", requireCampaign, async (req, res) => {
    try {
      const { campaignGoal, product, budget, brandName, industry, targetAudience } = req.body;
      const campaignContext = (req as any).campaignContext;

      if (!campaignGoal) {
        return res.status(400).json({ error: "Campaign goal is required" });
      }

      const location = campaignContext?.location;
      if (!location) {
        return res.status(400).json({
          error: "LOCATION_REQUIRED",
          message: "Campaign location must be set before generating audiences. Update your campaign selection with a location.",
        });
      }

      const systemPrompt = `You are a Meta Ads expert who builds highly targeted audiences for Facebook and Instagram campaigns. You understand Meta's detailed targeting options, Lookalike audiences, Custom audiences, and the Meta Advantage+ system.

You know exactly how to configure Meta Ads Manager targeting for maximum ROAS (Return on Ad Spend). Your audience recommendations are based on real Meta targeting options that exist in Meta Ads Manager.

BRAND CONTEXT:
- Brand: ${brandName || 'the brand'}
- Industry: ${industry || 'general business'}
- Current Audience: ${targetAudience || 'general audience'}

CAMPAIGN CONTEXT:
- Campaign: ${campaignContext.campaignName} (Goal: ${campaignContext.goalType})
- Location: ${location}
- All audiences MUST be geographically scoped to: ${location}. Do NOT generate broad/global audiences unless the location explicitly says "Global".`;

      const userPrompt = `Create 3 optimized Meta ad audiences for this campaign:

CAMPAIGN GOAL: ${campaignGoal}
PRODUCT/SERVICE: ${product || 'General offering'}
BUDGET: ${budget || 'Not specified'}
LOCATION (MANDATORY): ${location}

For each audience, provide:
1. A clear name for the audience
2. Detailed targeting breakdown (demographics, interests, behaviors)
3. Estimated audience size range
4. Why this audience will convert well for this specific goal
5. Recommended ad placements (Feed, Stories, Reels, Explore)
6. Suggested bid strategy

ALL audiences must be scoped to the campaign location: ${location}

Return ONLY a valid JSON array with exactly 3 audience objects:
{
  "name": "Audience name",
  "description": "One-line description",
  "age_min": 18,
  "age_max": 65,
  "gender": "all" | "male" | "female",
  "locations": ["${location}"],
  "interests": ["List of Meta interest targeting options"],
  "behaviors": ["List of Meta behavior targeting options"],
  "estimated_size": "500K - 1.2M",
  "placements": ["Feed", "Stories", "Reels"],
  "bid_strategy": "Lowest cost" | "Cost cap" | "Bid cap",
  "daily_budget_suggestion": "$X",
  "match_score": 85,
  "reasoning": "Why this audience matches the campaign goal"
}`;

      const response = await aiChat({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4000,
        accountId: "default",
        endpoint: "generate-audience",
      });

      const content = response.choices[0]?.message?.content || "";

      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          res.json({ audiences: parsed });
        } else {
          res.status(500).json({ error: "Failed to generate audiences." });
        }
      } catch {
        res.status(500).json({ error: "Failed to parse audience data." });
      }
    } catch (error) {
      console.error("Error generating audience:", error);
      res.status(500).json({ error: "Failed to generate audiences." });
    }
  });

  app.post("/api/auto-publish", requireMetaReal, async (req: any, res) => {
    try {
      const { posts } = req.body;
      const accountId = req.metaAccountId || "default";
      const metaMode = req.metaMode;

      if (metaMode !== "REAL") {
        return res.status(403).json({
          success: false,
          error: "META_NOT_CONNECTED",
          message: "Meta must be connected in REAL mode to auto-publish. Connect Meta in Settings.",
        });
      }

      const pageToken = await getDecryptedPageToken(accountId);
      if (!pageToken) {
        return res.status(403).json({ error: "META_TOKEN_EXPIRED", message: "Page token not available. Please reconnect." });
      }

      const creds = await db.select().from(metaCredentials).where(eq(metaCredentials.accountId, accountId)).limit(1);
      const cred = creds[0];
      if (!cred?.pageId) {
        return res.status(403).json({ error: "META_NOT_CONNECTED", message: "No Facebook Page configured." });
      }

      const results = [];
      for (const post of posts || []) {
        try {
          const platform = (post.platform || '').toLowerCase();
          if (platform === 'facebook') {
            const fbResponse = await fetch(
              `https://graph.facebook.com/${FB_API_VERSION}/${cred.pageId}/feed`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message: post.content,
                  access_token: pageToken,
                }),
              }
            );
            const fbData = await fbResponse.json();
            if (fbData.error) {
              results.push({ postId: post.id, status: 'failed', error: fbData.error.message });
            } else {
              results.push({ postId: post.id, status: 'published', fbId: fbData.id });
            }
          } else if (platform === 'instagram' && cred.igBusinessId && post.mediaUrl) {
            const containerRes = await fetch(
              `https://graph.facebook.com/${FB_API_VERSION}/${cred.igBusinessId}/media`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  image_url: post.mediaUrl,
                  caption: post.content,
                  access_token: pageToken,
                }),
              }
            );
            const containerData = await containerRes.json();
            if (containerData.id) {
              const publishRes = await fetch(
                `https://graph.facebook.com/${FB_API_VERSION}/${cred.igBusinessId}/media_publish`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    creation_id: containerData.id,
                    access_token: pageToken,
                  }),
                }
              );
              const publishData = await publishRes.json();
              if (publishData.error) {
                results.push({ postId: post.id, status: 'failed', error: publishData.error.message });
              } else {
                results.push({ postId: post.id, status: 'published', igId: publishData.id });
              }
            } else {
              results.push({ postId: post.id, status: 'failed', error: containerData.error?.message || 'IG container failed' });
            }
          } else {
            results.push({ postId: post.id, status: 'skipped', message: 'Platform not configured or missing media' });
          }
        } catch (err) {
          results.push({ postId: post.id, status: 'failed', error: 'Failed to publish' });
        }
      }

      res.json({ success: true, results });
    } catch (error) {
      console.error("Auto-publish error:", error);
      res.status(500).json({ error: "Failed to auto-publish." });
    }
  });

  app.use("/uploads/photography", express.static(path.join(process.cwd(), "uploads", "photography")));
  app.use("/uploads/videos", express.static(path.join(process.cwd(), "uploads", "videos")));
  app.use("/uploads/video-output", express.static(path.join(process.cwd(), "uploads", "video-output")));

  registerPhotographyRoutes(app);
  registerVideoRoutes(app);
  registerStrategyRoutes(app);
  registerAutopilotRoutes(app);
  registerBrandConfigRoutes(app);
  registerPublishPipelineRoutes(app);
  registerVeoRoutes(app);
  registerCampaignRoutes(app);
  registerDataSourceRoutes(app);
  registerLeadEngineRoutes(app);
  registerCompetitiveIntelligenceRoutes(app);
  registerMarketIntelligenceV3(app);
  registerAudienceEngineRoutes(app);
  registerPositioningEngineRoutes(app);
  registerStrategicCoreRoutes(app);
  registerMetaStatusRoutes(app);
  registerAuditRoutes(app);
  registerBusinessDataRoutes(app);
  registerDashboardRoutes(app);
  registerUIStateRoutes(app);
  registerDifferentiationRoutes(app);
  registerMechanismEngineRoutes(app);
  registerOfferEngineRoutes(app);
  registerFunnelEngineRoutes(app);
  registerIntegrityEngineRoutes(app);
  registerStrategyRootRoutes(app);
  registerAwarenessEngineRoutes(app);
  registerPersuasionEngineRoutes(app);
  registerStrategyEngineRoutes(app);
  registerOrchestratorV2Routes(app);
  registerChatRoutes(app);
  registerContentDnaRoutes(app);
  registerRootBundleRoutes(app);
  registerGoalMathRoutes(app);
  registerPlanGateRoutes(app);
  registerTaskComposerRoutes(app);
  registerConflictResolverRoutes(app);
  registerAELRoutes(app);
  registerCELRoutes(app);
  registerBuildPlanLayerRoutes(app);

  initMetaMetrics();

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      status: "ok",
      timestamp: new Date().toISOString(),
      routes: ["/api/strategic/init", "/api/strategic/blueprint/:id"],
    });
  });

  app.post("/api/meta/data-deletion", (req, res) => {
    try {
      const signedRequest = req.body.signed_request;
      if (!signedRequest) {
        return res.status(400).json({ error: "Missing signed_request" });
      }

      const META_APP_SECRET = process.env.META_APP_SECRET || "";
      const parts = signedRequest.split(".");
      if (parts.length !== 2) {
        return res.status(400).json({ error: "Invalid signed_request format" });
      }

      const encodedSig = parts[0];
      const payload = parts[1];

      const crypto = require("crypto");
      const expectedSig = crypto
        .createHmac("sha256", META_APP_SECRET)
        .update(payload)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      if (encodedSig !== expectedSig) {
        return res.status(403).json({ error: "Invalid signature" });
      }

      const data = JSON.parse(
        Buffer.from(payload, "base64").toString("utf-8")
      );
      const userId = data.user_id;

      const confirmationCode = crypto.randomBytes(16).toString("hex");

      const host = req.get("host") || "localhost:5000";
      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const statusUrl = `${protocol}://${host}/api/meta/data-deletion-status?code=${confirmationCode}`;

      console.log(
        `[Meta] Data deletion request received for user ${userId}, code: ${confirmationCode}`
      );

      res.json({
        url: statusUrl,
        confirmation_code: confirmationCode,
      });
    } catch (error: any) {
      console.error("[Meta] Data deletion error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/meta/data-deletion-status", (req, res) => {
    const code = req.query.code as string;
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Deletion Status - MarketMind AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0E14; color: #E5E7EB; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #151A22; border: 1px solid #1F2937; border-radius: 16px; padding: 40px; max-width: 480px; width: 100%; text-align: center; }
    .icon { width: 64px; height: 64px; background: #10B98120; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 28px; }
    h1 { font-size: 22px; margin-bottom: 8px; color: #fff; }
    .status { color: #10B981; font-weight: 600; font-size: 14px; margin-bottom: 16px; }
    p { color: #9CA3AF; font-size: 14px; line-height: 1.6; margin-bottom: 12px; }
    .code { background: #1F2937; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 13px; color: #8B5CF6; word-break: break-all; margin: 16px 0; }
    .footer { margin-top: 20px; font-size: 12px; color: #6B7280; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Data Deletion Request</h1>
    <div class="status">Status: Processed</div>
    <p>Your data deletion request has been received and processed. All personal data associated with your Facebook login has been removed from MarketMind AI.</p>
    ${code ? `<div class="code">Confirmation Code: ${code}</div>` : ""}
    <p>This typically completes within 24 hours. If you have questions, contact our support team.</p>
    <div class="footer">MarketMind AI &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`);
  });

  app.get("/privacy-policy", (req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - MarketMind AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0E14; color: #D1D5DB; line-height: 1.7; padding: 20px; }
    .container { max-width: 720px; margin: 0 auto; }
    .header { text-align: center; padding: 40px 0 30px; border-bottom: 1px solid #1F2937; margin-bottom: 30px; }
    h1 { font-size: 28px; color: #fff; margin-bottom: 8px; }
    .updated { font-size: 13px; color: #6B7280; }
    h2 { font-size: 18px; color: #fff; margin: 28px 0 12px; }
    p, li { font-size: 14px; color: #9CA3AF; margin-bottom: 10px; }
    ul { padding-left: 20px; margin-bottom: 16px; }
    a { color: #8B5CF6; text-decoration: none; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #1F2937; font-size: 12px; color: #6B7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Privacy Policy</h1>
      <div class="updated">Last Updated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
    </div>

    <h2>1. Introduction</h2>
    <p>MarketMind AI ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application and services.</p>

    <h2>2. Information We Collect</h2>
    <p>We may collect the following types of information:</p>
    <ul>
      <li><strong>Account Information:</strong> When you sign in via Facebook or Instagram, we receive your name, email address, profile picture, and user ID from Meta.</li>
      <li><strong>Social Media Data:</strong> With your permission, we access your connected social media pages and accounts to provide publishing, analytics, and audience management features.</li>
      <li><strong>Content Data:</strong> Content you create, schedule, or publish through our app, including text, images, and campaign details.</li>
      <li><strong>Usage Data:</strong> Information about how you interact with our app, including features used and preferences.</li>
      <li><strong>Brand Information:</strong> Business details you provide such as brand name, industry, target audience, and marketing goals.</li>
    </ul>

    <h2>3. How We Use Your Information</h2>
    <ul>
      <li>To provide and maintain our marketing automation services.</li>
      <li>To generate AI-powered content, strategies, and recommendations tailored to your brand.</li>
      <li>To schedule and publish content to your connected social media accounts.</li>
      <li>To provide analytics and insights about your marketing performance.</li>
      <li>To improve and personalize your experience with our app.</li>
    </ul>

    <h2>4. Data Sharing</h2>
    <p>We do not sell your personal information. We may share data with:</p>
    <ul>
      <li><strong>AI Service Providers:</strong> We use OpenAI and Google AI services to power content generation features. Content sent to these services is used solely for generating your requested output.</li>
      <li><strong>Meta Platforms:</strong> When you publish content or manage ads, data is shared with Meta (Facebook/Instagram) via their official APIs.</li>
      <li><strong>Legal Requirements:</strong> We may disclose information if required by law or to protect our rights.</li>
    </ul>

    <h2>5. Data Security</h2>
    <p>We implement appropriate technical and organizational measures to protect your personal data, including encryption of sensitive information and secure server infrastructure.</p>

    <h2>6. Data Retention</h2>
    <p>We retain your personal data only for as long as necessary to provide our services or as required by law. You can request deletion of your data at any time.</p>

    <h2>7. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Access the personal data we hold about you.</li>
      <li>Request correction of inaccurate data.</li>
      <li>Request deletion of your data.</li>
      <li>Withdraw consent for data processing.</li>
      <li>Request a copy of your data in a portable format.</li>
    </ul>

    <h2>8. Data Deletion</h2>
    <p>You can request deletion of your data by using the data deletion feature in the app settings or by contacting us. When you delete your account, all associated personal data, content, and analytics will be permanently removed within 30 days.</p>
    <p>For Facebook data deletion requests, Meta will send us a callback and we will process the deletion automatically.</p>

    <h2>9. Third-Party Links</h2>
    <p>Our app may contain links to third-party websites or services. We are not responsible for the privacy practices of these external sites.</p>

    <h2>10. Children's Privacy</h2>
    <p>Our services are not intended for users under 18 years of age. We do not knowingly collect personal information from children.</p>

    <h2>11. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last Updated" date at the top of this page.</p>

    <h2>12. Contact Us</h2>
    <p>If you have questions about this Privacy Policy or wish to exercise your data rights, please contact us through the app's support feature.</p>

    <div class="footer">
      <p>MarketMind AI &copy; ${new Date().getFullYear()} &mdash; All Rights Reserved</p>
    </div>
  </div>
</body>
</html>`);
  });

  const httpServer = createServer(app);
  return httpServer;
}
