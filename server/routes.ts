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

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
