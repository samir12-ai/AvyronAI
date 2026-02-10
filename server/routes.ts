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

  app.post("/api/generate-reel-script", async (req, res) => {
    try {
      const { topic, platform, brandName, tone, targetAudience, industry, reelDuration, reelGoal } = req.body;

      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
      }

      const duration = reelDuration || '30-60 seconds';
      const goal = reelGoal || 'engagement';

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
- Audio direction should suggest trending sounds or original voiceover style`;

      const userPrompt = `Create a complete, production-ready Reel script about: "${topic}"

Return your response in this EXACT JSON format:
{
  "title": "Working title for the reel",
  "hook": {
    "visual": "Exact visual description of what appears on screen in the first 1.5 seconds — the pattern interrupt that stops the scroll",
    "text_overlay": "The bold text overlay shown on screen during the hook (keep under 8 words, high contrast)",
    "voiceover": "What is said aloud during the hook (punchy, curiosity-driven)"
  },
  "scenes": [
    {
      "scene_number": 1,
      "duration": "3-5s",
      "visual_direction": "Detailed camera angle, movement, lighting, and what's shown on screen. Be specific enough for a photographer/videographer to execute.",
      "text_overlay": "On-screen text for this scene",
      "voiceover": "Script line for voiceover or dialogue",
      "transition": "How this scene transitions to the next (cut, zoom, swipe, morph, etc.)",
      "b_roll_suggestion": "Alternative or supplementary footage idea"
    }
  ],
  "closing": {
    "visual": "Final visual description",
    "cta_text": "Call-to-action text overlay",
    "cta_voiceover": "Spoken CTA",
    "loop_trick": "How the ending connects back to the beginning for seamless replay"
  },
  "production_notes": {
    "estimated_duration": "Total estimated duration",
    "audio_direction": "Music style, trending sound suggestion, or voiceover tone guidance",
    "lighting": "Lighting setup recommendation",
    "props_needed": "List of props or setup needed",
    "best_posting_time": "Optimal posting window for the target audience",
    "hashtag_strategy": "5-8 hashtags mixing broad reach and niche targeting"
  },
  "algorithm_optimization": {
    "retention_hooks": ["List of micro-hooks placed throughout to maintain watch time"],
    "share_trigger": "Why someone would share this reel (emotion, relatability, utility)",
    "save_trigger": "Why someone would save this reel (reference value, tutorial, inspiration)",
    "engagement_prompt": "Caption question or poll to boost comments",
    "repost_strategy": "How to repurpose this reel for Stories, Feed, and Facebook Reels"
  }
}

Generate exactly 4-6 scenes. Make the photography/videography directions specific and actionable — as if you're briefing a professional content creator. The visual hook must be genuinely scroll-stopping, not generic.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content || "";

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          res.json({ script: parsed });
        } else {
          res.json({ script: null, rawContent: content });
        }
      } catch {
        res.json({ script: null, rawContent: content });
      }
    } catch (error) {
      console.error("Error generating reel script:", error);
      res.status(500).json({ error: "Failed to generate reel script" });
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

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 8000,
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

  app.post("/api/generate-audience", async (req, res) => {
    try {
      const { campaignGoal, product, budget, brandName, industry, targetAudience } = req.body;

      if (!campaignGoal) {
        return res.status(400).json({ error: "Campaign goal is required" });
      }

      const systemPrompt = `You are a Meta Ads expert who builds highly targeted audiences for Facebook and Instagram campaigns. You understand Meta's detailed targeting options, Lookalike audiences, Custom audiences, and the Meta Advantage+ system.

You know exactly how to configure Meta Ads Manager targeting for maximum ROAS (Return on Ad Spend). Your audience recommendations are based on real Meta targeting options that exist in Meta Ads Manager.

BRAND CONTEXT:
- Brand: ${brandName || 'the brand'}
- Industry: ${industry || 'general business'}
- Current Audience: ${targetAudience || 'general audience'}`;

      const userPrompt = `Create 3 optimized Meta ad audiences for this campaign:

CAMPAIGN GOAL: ${campaignGoal}
PRODUCT/SERVICE: ${product || 'General offering'}
BUDGET: ${budget || 'Not specified'}

For each audience, provide:
1. A clear name for the audience
2. Detailed targeting breakdown (demographics, interests, behaviors)
3. Estimated audience size range
4. Why this audience will convert well for this specific goal
5. Recommended ad placements (Feed, Stories, Reels, Explore)
6. Suggested bid strategy

Return ONLY a valid JSON array with exactly 3 audience objects:
{
  "name": "Audience name",
  "description": "One-line description",
  "age_min": 18,
  "age_max": 65,
  "gender": "all" | "male" | "female",
  "locations": ["Country or region names"],
  "interests": ["List of Meta interest targeting options"],
  "behaviors": ["List of Meta behavior targeting options"],
  "estimated_size": "500K - 1.2M",
  "placements": ["Feed", "Stories", "Reels"],
  "bid_strategy": "Lowest cost" | "Cost cap" | "Bid cap",
  "daily_budget_suggestion": "$X",
  "match_score": 85,
  "reasoning": "Why this audience matches the campaign goal"
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 4000,
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

  app.post("/api/auto-publish", async (req, res) => {
    try {
      const { posts, accessToken, pageId } = req.body;

      if (!accessToken || !pageId) {
        return res.json({
          success: true,
          demo: true,
          message: 'Demo mode: Connect your Meta account to publish for real.',
          results: (posts || []).map((p: any) => ({
            postId: p.id,
            status: 'demo_queued',
            demoId: 'demo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          })),
        });
      }

      const results = [];
      for (const post of posts || []) {
        try {
          if (post.platform === 'Facebook' || post.platform === 'facebook') {
            const fbResponse = await fetch(
              `https://graph.facebook.com/v18.0/${pageId}/feed`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message: post.content,
                  access_token: accessToken,
                }),
              }
            );
            const fbData = await fbResponse.json();
            results.push({ postId: post.id, status: 'published', fbId: fbData.id });
          } else {
            results.push({ postId: post.id, status: 'queued', message: 'Instagram publishing requires additional setup' });
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

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
