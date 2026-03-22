import { Router } from "express";
import { db } from "./db";
import { brandConfig } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

async function ensureBrandConfig(accountId: string) {
  const existing = await db.select().from(brandConfig)
    .where(eq(brandConfig.accountId, accountId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(brandConfig).values({ accountId });
    const created = await db.select().from(brandConfig)
      .where(eq(brandConfig.accountId, accountId))
      .limit(1);
    return created[0];
  }
  return existing[0];
}

router.get("/api/brand-config", async (req, res) => {
  try {
    const accountId = (req as any).accountId || "default";
    const config = await ensureBrandConfig(accountId);
    res.json(config);
  } catch (error) {
    console.error("[BrandConfig] Error getting config:", error);
    res.status(500).json({ error: "Failed to get brand config" });
  }
});

router.patch("/api/brand-config", async (req, res) => {
  try {
    const accountId = (req as any).accountId || "default";
    await ensureBrandConfig(accountId);

    const {
      brandName,
      tone,
      forbiddenClaims,
      ctaStyle,
      hashtagPolicy,
      maxHashtags,
      preferredEmojis,
      languageStyle,
      targetIndustry,
    } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (brandName !== undefined) updates.brandName = brandName;
    if (tone !== undefined) updates.tone = tone;
    if (forbiddenClaims !== undefined) updates.forbiddenClaims = forbiddenClaims;
    if (ctaStyle !== undefined) updates.ctaStyle = ctaStyle;
    if (hashtagPolicy !== undefined) updates.hashtagPolicy = hashtagPolicy;
    if (maxHashtags !== undefined) updates.maxHashtags = maxHashtags;
    if (preferredEmojis !== undefined) updates.preferredEmojis = preferredEmojis;
    if (languageStyle !== undefined) updates.languageStyle = languageStyle;
    if (targetIndustry !== undefined) updates.targetIndustry = targetIndustry;

    await db.update(brandConfig)
      .set(updates)
      .where(eq(brandConfig.accountId, accountId));

    const updated = await db.select().from(brandConfig)
      .where(eq(brandConfig.accountId, accountId))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    console.error("[BrandConfig] Error updating config:", error);
    res.status(500).json({ error: "Failed to update brand config" });
  }
});

export function registerBrandConfigRoutes(app: any) {
  app.use(router);
}
