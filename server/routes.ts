import type { Express } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/generate-content", async (req, res) => {
    try {
      const { topic, contentType, platform, brandName, tone, targetAudience, industry } = req.body;

      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
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
- Avoid being overly promotional`;

      const userPrompt = `Create a ${contentType} for ${platform} about: ${topic}

Requirements:
- Platform: ${platform}
- Content Type: ${contentType}
- Make it engaging and shareable
- Optimize for the platform's best practices
- Include a clear call-to-action if appropriate`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || "";

      res.json({ content });
    } catch (error) {
      console.error("Error generating content:", error);
      res.status(500).json({ error: "Failed to generate content" });
    }
  });

  app.post("/api/generate-ad", async (req, res) => {
    try {
      const { brandName, industry, tone, targetAudience, platforms } = req.body;

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

      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 300,
      });

      const content = response.choices[0]?.message?.content || "";
      
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          res.json(parsed);
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

  app.post("/api/generate-poster", async (req, res) => {
    try {
      const { topic, style, text, brandName, industry } = req.body;

      const systemPrompt = `You are a creative director who describes marketing poster designs. Create a detailed description of a ${style} style marketing poster.

Brand: ${brandName || 'the brand'}
Industry: ${industry || 'business'}

Describe the visual elements, colors, layout, and mood in a way that captures the essence of the ${style} design style.`;

      const userPrompt = `Design a marketing poster about: ${topic}
${text ? `Include this text on the poster: "${text}"` : ''}

Provide a detailed visual description of the poster design.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 300,
      });

      const description = response.choices[0]?.message?.content || "";

      res.json({ 
        imageUrl: 'generated',
        description 
      });
    } catch (error) {
      console.error("Error generating poster:", error);
      res.status(500).json({ error: "Failed to generate poster" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
