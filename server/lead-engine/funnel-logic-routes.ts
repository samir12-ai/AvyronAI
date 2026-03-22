import type { Express } from "express";
import { db } from "../db";
import { funnelDefinitions, funnelContentMap, leads, conversionEvents } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { aiChat } from "../ai-client";

import { resolveAccountId } from "../auth";
const DEFAULT_FUNNEL_STAGES = JSON.stringify([
  { name: "awareness", label: "Awareness", order: 1, description: "First touchpoint - brand discovery" },
  { name: "engagement", label: "Engagement", order: 2, description: "Active interaction with content" },
  { name: "lead", label: "Lead", order: 3, description: "Captured contact information" },
  { name: "customer", label: "Customer", order: 4, description: "Completed purchase or conversion" },
]);

export function registerFunnelLogicRoutes(app: Express) {
  app.get("/api/funnels", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      if (!(await featureFlagService.isEnabled("funnel_logic_enabled", accountId))) {
        return res.json({ funnels: [], disabled: true });
      }
      const result = await db.select().from(funnelDefinitions)
        .where(eq(funnelDefinitions.accountId, accountId))
        .orderBy(desc(funnelDefinitions.createdAt));

      if (result.length === 0) {
        const inserted = await db.insert(funnelDefinitions).values({
          accountId, name: "Default Marketing Funnel",
          stages: DEFAULT_FUNNEL_STAGES, isDefault: true,
        }).returning();
        return res.json({ funnels: inserted });
      }
      res.json({ funnels: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/funnels", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      if (!(await featureFlagService.isEnabled("funnel_logic_enabled", accountId))) {
        return res.status(403).json({ error: "Funnel Logic is not enabled" });
      }
      const { name, stages } = req.body;
      if (!name || !stages) {
        return res.status(400).json({ error: "name and stages are required" });
      }
      const inserted = await db.insert(funnelDefinitions).values({
        accountId, name,
        stages: typeof stages === "string" ? stages : JSON.stringify(stages),
      }).returning();
      res.json({ funnel: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/funnels/map-content", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      if (!(await featureFlagService.isEnabled("funnel_logic_enabled", accountId))) {
        return res.status(403).json({ error: "Funnel Logic is not enabled" });
      }
      const { funnelId, stage, postId, contentType } = req.body;
      const inserted = await db.insert(funnelContentMap).values({
        accountId, funnelId, stage, postId, contentType,
      }).returning();
      res.json({ mapping: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/funnels/:id/content-map", async (req, res) => {
    try {
      const result = await db.select().from(funnelContentMap)
        .where(eq(funnelContentMap.funnelId, req.params.id));
      res.json({ contentMap: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/funnels/health", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      if (!(await featureFlagService.isEnabled("funnel_logic_enabled", accountId))) {
        return res.json({ health: null, disabled: true });
      }

      const allLeads = await db.select().from(leads).where(eq(leads.accountId, accountId));
      const stages = {
        awareness: 0, engagement: 0, lead: 0, customer: 0,
      };

      const events = await db.select().from(conversionEvents).where(eq(conversionEvents.accountId, accountId));
      stages.awareness = events.filter(e => e.eventType === "page_view" || e.eventType === "link_click").length;
      stages.engagement = events.filter(e => e.eventType === "cta_click" || e.eventType === "whatsapp_click").length;
      stages.lead = allLeads.filter(l => ["new", "contacted", "qualified"].includes(l.status || "")).length;
      stages.customer = allLeads.filter(l => l.status === "converted").length;

      const bottlenecks: string[] = [];
      if (stages.awareness > 0 && stages.engagement === 0) bottlenecks.push("awareness_to_engagement");
      if (stages.engagement > 0 && stages.lead === 0) bottlenecks.push("engagement_to_lead");
      if (stages.lead > 0 && stages.customer === 0) bottlenecks.push("lead_to_customer");

      const conversionRates = {
        awareness_to_engagement: stages.awareness > 0 ? ((stages.engagement / stages.awareness) * 100).toFixed(1) : "0",
        engagement_to_lead: stages.engagement > 0 ? ((stages.lead / stages.engagement) * 100).toFixed(1) : "0",
        lead_to_customer: stages.lead > 0 ? ((stages.customer / stages.lead) * 100).toFixed(1) : "0",
        overall: stages.awareness > 0 ? ((stages.customer / stages.awareness) * 100).toFixed(2) : "0",
      };

      if (bottlenecks.length > 0) {
        await logAudit(accountId, "FUNNEL_BOTTLENECK_DETECTED", {
          details: { bottlenecks, stages, conversionRates },
        });
      }

      res.json({
        health: {
          stages,
          conversionRates,
          bottlenecks,
          healthScore: bottlenecks.length === 0 ? 100 : Math.max(0, 100 - bottlenecks.length * 30),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/funnels/ai-suggestions", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      if (!(await featureFlagService.isEnabled("funnel_logic_enabled", accountId))) {
        return res.status(403).json({ error: "Funnel Logic is not enabled" });
      }

      const { funnelHealth, brandContext } = req.body;

      const response = await aiChat({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content: `You are a funnel optimization expert. Based on the funnel health data, suggest content strategies to fix bottlenecks and improve conversion at each stage. Return a JSON object with "suggestions" array, each having: "stage", "issue", "contentIdea", "expectedImpact".`,
          },
          {
            role: "user",
            content: `Funnel health data: ${JSON.stringify(funnelHealth)}. Brand context: ${brandContext || "general business"}. Identify gaps and suggest content to fill them.`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 800,
        accountId,
        endpoint: "funnel-suggestions",
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
      res.json({ suggestions: parsed.suggestions || [] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
