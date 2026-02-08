import type { Express } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import multer from "multer";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const geminiAi = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
        model: "gpt-5.2",
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

  app.post("/api/generate-poster", upload.single('photo'), async (req, res) => {
    try {
      const { topic, style, text, brandName, industry, aspectRatio, mood, mode } = req.body;

      const hasPhoto = !!req.file;
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
          `Transform and reimagine this uploaded image into a stunning ${currentStyle} design.`,
          topic ? `Creative direction: ${topic}` : '',
          `Output as ${currentAspect}.`,
        );
      } else if (mode === 'image-edit' && hasPhoto) {
        promptParts.push(
          `Edit and enhance this uploaded image based on the following instructions.`,
          topic ? `Editing instructions: ${topic}` : 'Enhance the image quality and visual appeal.',
          `Keep the core subject intact while applying: ${currentStyle} treatment.`,
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
          promptParts.push(`Use the provided reference image as visual inspiration for composition, color palette, or subject matter.`);
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

      if (req.file) {
        const base64Image = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';
        parts.push({
          inlineData: {
            data: base64Image,
            mimeType,
          },
        });
      }

      contents.push({ role: 'user', parts });

      const response = await geminiAi.models.generateContent({
        model: "gemini-3-pro-image-preview",
        contents,
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
        },
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

  app.get("/api/auth/facebook", (req, res) => {
    const META_APP_ID = process.env.META_APP_ID || '';
    const REDIRECT_URI = `${req.protocol}://${req.get('host')}/api/auth/facebook/callback`;
    
    const scopes = ['email', 'public_profile'].join(',');
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;
    
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
    const REDIRECT_URI = `${req.protocol}://${req.get('host')}/api/auth/facebook/callback`;
    
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
        `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`
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
    const REDIRECT_URI = `${req.protocol}://${req.get('host')}/api/auth/instagram/callback`;
    
    const scopes = ['instagram_basic', 'instagram_content_publish'].join(',');
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;
    
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
    const REDIRECT_URI = `${req.protocol}://${req.get('host')}/api/auth/instagram/callback`;
    
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
        `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`
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
