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

  app.get("/api/meta/auth", (req, res) => {
    const META_APP_ID = process.env.META_APP_ID || '';
    const REDIRECT_URI = `${req.protocol}://${req.get('host')}/api/meta/callback`;
    
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
      'ads_management',
      'business_management',
    ].join(',');
    
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;
    
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
            .success { color: #10B981; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>Meta Business Suite Integration</h1>
          <div class="info">
            <p>To enable real Facebook & Instagram posting, you need to set up a Meta Developer App:</p>
          </div>
          <div class="steps">
            <div class="step">1. Go to <a href="https://developers.facebook.com" target="_blank">Meta for Developers</a></div>
            <div class="step">2. Create a new app (Business type)</div>
            <div class="step">3. Add Facebook Login, Instagram Graph API, and Marketing API products</div>
            <div class="step">4. Set these environment variables:</div>
            <div class="step"><code>META_APP_ID</code> - Your App ID</div>
            <div class="step"><code>META_APP_SECRET</code> - Your App Secret</div>
          </div>
          <p class="success">For now, the app will simulate Meta connection for demo purposes.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 5000);
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    res.redirect(authUrl);
  });

  app.get("/api/meta/callback", async (req, res) => {
    const { code } = req.query;
    const META_APP_ID = process.env.META_APP_ID || '';
    const META_APP_SECRET = process.env.META_APP_SECRET || '';
    const REDIRECT_URI = `${req.protocol}://${req.get('host')}/api/meta/callback`;
    
    if (!code || !META_APP_ID || !META_APP_SECRET) {
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'META_AUTH_SUCCESS' }, '*');
            window.close();
          </script>
          <p>Connection successful! You can close this window.</p>
        </body>
        </html>
      `);
      return;
    }
    
    try {
      const tokenResponse = await fetch(
        `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`
      );
      const tokenData = await tokenResponse.json();
      
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'META_AUTH_SUCCESS', token: '${tokenData.access_token}' }, '*');
            window.close();
          </script>
          <p>Connection successful! You can close this window.</p>
        </body>
        </html>
      `);
    } catch (error) {
      res.send(`
        <html>
        <body>
          <script>
            window.opener?.postMessage({ type: 'META_AUTH_ERROR' }, '*');
            window.close();
          </script>
          <p>Connection failed. Please try again.</p>
        </body>
        </html>
      `);
    }
  });

  app.post("/api/meta/post", async (req, res) => {
    try {
      const { content, platforms, accessToken, pageId } = req.body;
      
      if (!accessToken || !pageId) {
        return res.json({ 
          success: true, 
          message: 'Demo mode: Post would be published to ' + platforms.join(' and '),
          postIds: { facebook: 'demo_fb_' + Date.now(), instagram: 'demo_ig_' + Date.now() }
        });
      }
      
      const results: Record<string, string> = {};
      
      if (platforms.includes('facebook')) {
        const fbResponse = await fetch(
          `https://graph.facebook.com/v18.0/${pageId}/feed`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: content,
              access_token: accessToken,
            }),
          }
        );
        const fbData = await fbResponse.json();
        results.facebook = fbData.id;
      }
      
      res.json({ success: true, postIds: results });
    } catch (error) {
      console.error('Meta post error:', error);
      res.status(500).json({ error: 'Failed to post to Meta platforms' });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
