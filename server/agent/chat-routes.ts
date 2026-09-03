import { Router, Request, Response, Express } from "express";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { aiChat } from "../ai-client";
import { buildAgentContext } from "./context-assembler";
import { assertCampaignBelongsTo } from "../auth-helpers";

export const agentChatRouter = Router();

// GET /api/agent/history?campaignId=xxx&conversationId=xxx
agentChatRouter.get("/history", async (req: Request, res: Response) => {
  try {
    const accountId = (req as any).accountId || (req.query.accountId as string);
    const campaignId = req.query.campaignId as string;
    const convId = req.query.conversationId ? Number(req.query.conversationId) : null;

    if (!accountId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!campaignId) {
      return res.status(400).json({ success: false, error: "campaignId is required" });
    }

    // Tenant isolation verification
    await assertCampaignBelongsTo(accountId, campaignId);

    let activeConvId = convId;
    if (!activeConvId) {
      // Find latest conversation for this campaign
      const [latest] = await db
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.accountId, accountId),
            eq(schema.conversations.campaignId, campaignId)
          )
        )
        .orderBy(desc(schema.conversations.updatedAt))
        .limit(1);

      if (latest) {
        activeConvId = latest.id;
      }
    }

    if (!activeConvId) {
      return res.json({ success: true, conversationId: null, messages: [] });
    }

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, activeConvId))
      .orderBy(schema.messages.createdAt);

    return res.json({
      success: true,
      conversationId: activeConvId,
      messages: messages.map(m => ({
        id: String(m.id),
        role: m.role,
        content: m.content,
        time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      })),
    });
  } catch (err: any) {
    console.error("[AgentChat] Error fetching history:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to fetch history" });
  }
});

// POST /api/agent/chat
agentChatRouter.post("/chat", async (req: Request, res: Response) => {
  try {
    const accountId = (req as any).accountId || req.body.accountId;
    const { campaignId, message, conversationId: incomingConvId } = req.body;

    if (!accountId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!campaignId || !message || typeof message !== "string") {
      return res.status(400).json({ success: false, error: "campaignId and message are required" });
    }

    // Tenant & Campaign isolation check
    await assertCampaignBelongsTo(accountId, String(campaignId));

    // Resolve or create conversation
    let conversationId = incomingConvId;
    if (!conversationId) {
      const [newConv] = await db
        .insert(schema.conversations)
        .values({
          accountId,
          campaignId: String(campaignId),
          title: message.slice(0, 40) + (message.length > 40 ? "..." : ""),
        })
        .returning();
      conversationId = newConv.id;
    }

    // Persist user message
    await db.insert(schema.messages).values({
      conversationId,
      role: "user",
      content: message.trim(),
    });

    // Load previous messages for conversational memory (up to last 10)
    const prevMessages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(10);

    const orderedHistory = prevMessages.reverse().map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Composite inquiry text to retain domain context across follow-up questions
    const priorUserQueries = orderedHistory
      .filter(m => m.role === "user")
      .map(m => m.content)
      .join(" ");

    // Assemble question-aware canonical context
    const { systemPrompt, trace } = await buildAgentContext({
      accountId,
      campaignId: String(campaignId),
      userQuestion: message.trim() + " " + priorUserQueries,
    });

    // Call AI Chat with generous token budget and low temperature for crisp strategic explanation
    let aiText = "";
    try {
      const aiRes = await aiChat({
        messages: [
          { role: "system", content: systemPrompt },
          ...orderedHistory,
        ],
        model: "gpt-4o-mini",
        max_tokens: 1500,
        temperature: 0.25,
        accountId,
        endpoint: "agent-chat",
      });
      aiText = aiRes.choices?.[0]?.message?.content || "I have reviewed your strategy and performance data.";
    } catch (err: any) {
      console.warn("[AgentChat] Primary model failed, trying fallback:", err.message);
      try {
        const fallbackRes = await aiChat({
          messages: [
            { role: "system", content: systemPrompt },
            ...orderedHistory,
          ],
          model: "gpt-4o",
          max_tokens: 1500,
          temperature: 0.25,
          accountId,
          endpoint: "agent-chat-fallback",
        });
        aiText = fallbackRes.choices?.[0]?.message?.content || "I have reviewed your strategy and performance data.";
      } catch (fallbackErr: any) {
        console.error("[AgentChat] Fallback also failed:", fallbackErr.message);
        aiText = "Avyron is processing your campaign intelligence. Please check the Strategy Hub or What To Do Today for live priorities.";
      }
    }

    // Persist assistant message
    const [assistantMsg] = await db
      .insert(schema.messages)
      .values({
        conversationId,
        role: "assistant",
        content: aiText,
      })
      .returning();

    // Update conversation timestamp
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));

    return res.json({
      success: true,
      conversationId,
      messageId: assistantMsg.id,
      response: aiText,
      trace,
    });
  } catch (err: any) {
    console.error("[AgentChat] Chat error:", err);
    return res.status(500).json({ success: false, error: err.message || "Chat failed" });
  }
});

export function registerAgentChatRoutes(app: Express) {
  app.use("/api/agent", agentChatRouter);
}
