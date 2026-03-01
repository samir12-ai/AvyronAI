import { db } from "./db";
import { studioItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import { aiChat } from "./ai-client";

export async function runStudioAnalysis(studioItemId: string): Promise<void> {
  const [item] = await db
    .select()
    .from(studioItems)
    .where(eq(studioItems.id, studioItemId))
    .limit(1);

  if (!item) {
    console.error(`[StudioAnalysis] Item not found: ${studioItemId}`);
    return;
  }

  if (item.analysisStatus === "RUNNING" || item.analysisStatus === "COMPLETE") {
    console.log(`[StudioAnalysis] Skipping ${studioItemId} — already ${item.analysisStatus}`);
    return;
  }

  await db
    .update(studioItems)
    .set({ analysisStatus: "RUNNING", updatedAt: new Date() })
    .where(eq(studioItems.id, studioItemId));

  try {
    const contentContext = [
      `Title: ${item.title || "Untitled"}`,
      `Content Type: ${item.contentType}`,
      item.caption ? `Existing Caption: ${item.caption}` : null,
      item.mediaUrl ? `Has Media: Yes` : `Has Media: No`,
      item.engineName ? `Created By: ${item.engineName}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const systemPrompt = `You are a social media content strategist. Analyze the following content and generate marketing metadata. Return ONLY valid JSON with these exact keys:
{
  "hook": "A compelling opening hook (first line/first 3 seconds) to grab attention",
  "suggestedCaption": "A full social media caption with line breaks, emojis where appropriate, and hashtags at the end",
  "suggestedCta": "A specific call-to-action (e.g., 'Link in bio', 'Save this for later', 'DM us to learn more')",
  "goal": "The primary marketing goal (e.g., 'Build awareness', 'Drive sales', 'Grow followers', 'Generate leads')",
  "contentAngle": "The strategic angle or messaging theme of this content",
  "keywords": "Comma-separated relevant keywords and hashtags without # symbol"
}`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      max_tokens: 800,
      accountId: item.accountId,
      endpoint: "studio-analysis",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze this content and generate marketing metadata:\n\n${contentContext}` },
      ],
    });

    const text = response.choices?.[0]?.message?.content || "";

    let parsed: any;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseErr) {
      console.error(`[StudioAnalysis] Parse error for ${studioItemId}:`, parseErr);
      await db
        .update(studioItems)
        .set({
          analysisStatus: "FAILED",
          analysisError: "Failed to parse AI response",
          updatedAt: new Date(),
        })
        .where(eq(studioItems.id, studioItemId));
      return;
    }

    const updateData: any = {
      analysisStatus: "COMPLETE",
      hook: parsed.hook || null,
      goal: parsed.goal || null,
      contentAngle: parsed.contentAngle || null,
      keywords: parsed.keywords || null,
      suggestedCta: parsed.suggestedCta || null,
      suggestedCaption: parsed.suggestedCaption || null,
      analysisError: null,
      updatedAt: new Date(),
    };

    await db
      .update(studioItems)
      .set(updateData)
      .where(eq(studioItems.id, studioItemId));

    console.log(`[StudioAnalysis] Complete for ${studioItemId}`);
  } catch (error: any) {
    const errorMsg = error.message || "Unknown analysis error";
    console.error(`[StudioAnalysis] Failed for ${studioItemId}:`, errorMsg);

    await db
      .update(studioItems)
      .set({
        analysisStatus: "FAILED",
        analysisError: errorMsg,
        updatedAt: new Date(),
      })
      .where(eq(studioItems.id, studioItemId));
  }
}
