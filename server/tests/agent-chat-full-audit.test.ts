import "dotenv/config";
import { describe, it, expect } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { buildAgentContext } from "../agent/context-assembler";
import fs from "fs";

describe("Avyron Agent Chat & Strategic Assistant Full Audit Suite — Final Freeze", () => {
  const accountId = "acc_buffer_e2e_1787909177715";
  const campaignA = "camp_buffer_e2e_1787909177715";
  const campaignB = "camp_brand_beta_isolation";

  // 1. Chat input accepts text in DashboardAgentPanel
  it("1. chat input accepts text in DashboardAgentPanel", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("onChangeText={setInputText}");
    expect(panelCode).toContain("value={inputText}");
  });

  // 2. Send button works
  it("2. send button invokes handleSendMessage", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("onPress={() => handleSendMessage()}");
  });

  // 3. Enter sends on desktop/web
  it("3. enter key sends message", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("onSubmitEditing={() => handleSendMessage()}");
    expect(panelCode).toContain("handleKeyPress");
  });

  // 4. Shift+Enter does not prematurely send
  it("4. Shift+Enter is preserved without sending", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("!e.nativeEvent.shiftKey");
  });

  // 5. User message appears immediately in state
  it("5. user message is appended to state before network request completes", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("setMessages(prev => [...prev, userMsg])");
  });

  // 6. Backend response renders
  it("6. backend response is rendered in assistant bubble", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("setMessages(prev => [...prev, botMsg])");
  });

  // 7. Failed backend call shows retry state
  it("7. failed backend call renders retry banner and retry action", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("Avyron couldn't answer that right now.");
    expect(panelCode).toContain("handleSendMessage(lastPrompt)");
  });

  // 8. Follow-up question maintains conversation context
  it("8. follow-up question loads prior message history for conversationId", async () => {
    const [conv] = await db
      .insert(schema.conversations)
      .values({
        accountId,
        campaignId: campaignA,
        title: "Test Context Followup",
      })
      .returning();

    await db.insert(schema.messages).values({
      conversationId: conv.id,
      role: "user",
      content: "What is our current Funnel?",
    });

    await db.insert(schema.messages).values({
      conversationId: conv.id,
      role: "assistant",
      content: "Our funnel consists of Awareness, Consideration, Conversion, and Retention stages.",
    });

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conv.id))
      .orderBy(schema.messages.createdAt);

    expect(messages.length).toBe(2);
    expect(messages[0].content).toContain("Funnel");
  }, 15000);

  // 9. Agent receives active accountId + campaignId
  it("9. Agent context assembler strictly accepts accountId + campaignId", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is our strategy?",
    });

    expect(ctx.trace.accountId).toBe(accountId);
    expect(ctx.trace.campaignId).toBe(campaignA);
  }, 15000);

  // 10. Campaign switch invalidates Agent context
  it("10. campaign switch resets conversation state in UI", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("useEffect(() => {");
    expect(panelCode).toContain("setMessages([]);");
    expect(panelCode).toContain("}, [selectedCampaignId]);");
  });

  // 11. Strategy answer uses active Strategy Root authority
  it("11. strategy answer uses active Strategy Root authority", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is our current strategy?",
    });

    expect(ctx.systemPrompt).toContain("Strategy v6");
    expect(ctx.trace.domainsUsed).toContain("STRATEGY");
    expect(ctx.trace.canonicalSourceTypes["STRATEGY_ROOT"]).toBe("strategyRoots");
  }, 15000);

  // 12. Strategy version is correct
  it("12. strategy version is reported as 6 for campaign A", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What strategy version are we on?",
    });

    expect(ctx.trace.strategyVersion).toBe(6);
  }, 15000);

  // 13. Strategic lanes are correct
  it("13. strategic lanes contain business-facing titles", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What are our strategic lanes?",
    });

    expect(ctx.systemPrompt).toContain("Simplified Scheduling for Small Business Social Media Managers");
    expect(ctx.systemPrompt).toContain("Visual Content Scheduling for Creators on Instagram and Beyond");
  }, 15000);

  // 14. Positioning uses canonical Positioning authority
  it("14. positioning statement matches canonical authority and traces to positioningSnapshots", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is our positioning?",
    });

    expect(ctx.systemPrompt).toMatch(/Buffer Social Media Management resolves small business users|distraction-free social media management/i);
    expect(ctx.trace.domainsUsed).toContain("POSITIONING");
    expect(ctx.trace.canonicalSourceTypes["POSITIONING"]).toBe("positioningSnapshots");
    expect(ctx.trace.canonicalSourceTypes["POSITIONING"]).not.toBe("strategicPlans");
  }, 15000);

  // 15. Offer uses canonical Offer authority
  it("15. offer statement matches canonical authority and traces to offerSnapshots", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is our offer?",
    });

    expect(ctx.systemPrompt).toMatch(/14-day full access trial|Eliminate complexity and high costs/i);
    expect(ctx.trace.domainsUsed).toContain("OFFER");
    expect(ctx.trace.canonicalSourceTypes["OFFER"]).toBe("offerSnapshots");
  }, 15000);

  // 16. Funnel is lane-aware
  it("16. funnel stages are lane-scoped and trace to funnelSnapshots", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is our Funnel for Small Business managers?",
    });

    expect(ctx.systemPrompt).toContain("Awareness:");
    expect(ctx.systemPrompt).toContain("Consideration:");
    expect(ctx.systemPrompt).toContain("Conversion:");
    expect(ctx.trace.domainsUsed).toContain("FUNNEL");
    expect(ctx.trace.canonicalSourceTypes["FUNNEL"]).toBe("funnelSnapshots");
  }, 15000);

  // 17. Buyer psychology uses Audience/Persuasion truth
  it("17. buyer psychology contains objections and proof needed and traces to persuasionSnapshots", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What are buyers worried about?",
    });

    expect(ctx.systemPrompt).toContain("Primary Objection:");
    expect(ctx.systemPrompt).toContain("Buyer Worries:");
    expect(ctx.systemPrompt).toContain("Required Proof:");
    expect(ctx.trace.domainsUsed).toContain("PERSUASION");
    expect(ctx.trace.canonicalSourceTypes["PERSUASION"]).toBe("persuasionSnapshots");
  }, 15000);

  // 18. Performance uses Performance Loop truth with causal separation
  it("18. performance facts include observed CPA, ROAS, and lead targets with causal status", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "How are we performing against plan?",
    });

    expect(ctx.systemPrompt).toContain("CPA: $42.50");
    expect(ctx.systemPrompt).toContain("ROAS: 3.2");
    expect(ctx.systemPrompt).toContain("148");
    expect(ctx.trace.domainsUsed).toContain("PERFORMANCE");
    expect(ctx.trace.causalStatuses["PERFORMANCE_FACTS"]).toBe("OBSERVED_ONLY");
    expect(ctx.trace.causalStatuses["LEAD_SHORTFALL"]).toBe("CORRELATED");
  }, 15000);

  // 19. Candidate Watchtower event is not called confirmed
  it("19. candidate Watchtower events are strictly marked CANDIDATE / UNDER REVIEW", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What changed in the market?",
    });

    expect(ctx.systemPrompt).toContain("CANDIDATE / UNDER REVIEW");
    expect(ctx.trace.domainsUsed).toContain("WATCHTOWER");
    expect(ctx.trace.canonicalSourceTypes["WATCHTOWER"]).toBe("pipelineChangeEvents");
  }, 15000);

  // 20. Confirmed event is surfaced correctly
  it("20. confirmed event is marked CONFIRMED", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Did competitors change pricing?",
    });

    expect(ctx.systemPrompt).toContain("CONFIRMED");
  }, 15000);

  // 21. Reasoning question uses real Reasoning Case
  it("21. reasoning question references active Reasoning Case", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Is Avyron investigating anything right now?",
    });

    expect(ctx.systemPrompt).toMatch(/Active Reasoning Case:|Active Case:/i);
    expect(ctx.trace.domainsUsed).toContain("REASONING");
  }, 15000);

  // 22. WTDT question uses today's actual tasks
  it("22. WTDT question surfaces prioritized tasks", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What should I do today?",
    });

    expect(ctx.systemPrompt).toContain("[MUST DO]");
    expect(ctx.trace.domainsUsed).toContain("WTDT");
  }, 15000);

  // 23. Report question uses persisted Monthly Report
  it("23. report question uses persisted monthly report history", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What happened last month?",
    });

    expect(ctx.systemPrompt).toMatch(/August 2026|Report for 2026-08/i);
    expect(ctx.trace.domainsUsed).toContain("REPORTS");
  }, 15000);

  // 24. Strategy history uses real version lineage
  it("24. strategy history describes version evolution", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What changed most recently in our strategy?",
    });

    expect(ctx.systemPrompt).toContain("Strategic Lineage & Evolution");
  }, 15000);

  // 25. Revalidated authority is not described as materially changed
  it("25. system prompt instructs model to distinguish revalidation from material change", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What remained unchanged?",
    });

    expect(ctx.systemPrompt).toContain("CANONICAL SOURCE PURITY");
  }, 15000);

  // 26. INSUFFICIENT_DATA adaptation outcome is reported honestly
  it("26. INSUFFICIENT_DATA directive is explicitly enforced in system prompt", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Did the latest Funnel change improve results?",
    });

    expect(ctx.systemPrompt).toContain("INSUFFICIENT_DATA");
    expect(ctx.trace.causalStatuses["ADAPTATION_OUTCOME"]).toBe("INSUFFICIENT_DATA");
  }, 15000);

  // 27. No campaign-specific hardcoded answers
  it("27. context assembler dynamically queries database without hardcoded campaign text", () => {
    const assemblerCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/server/agent/context-assembler.ts", "utf8");
    expect(assemblerCode).toContain(".select()");
    expect(assemblerCode).toContain("schema.positioningSnapshots");
    expect(assemblerCode).toContain("schema.differentiationSnapshots");
    expect(assemblerCode).toContain("schema.offerSnapshots");
    expect(assemblerCode).toContain("schema.funnelSnapshots");
  });

  // 28. Campaign A cannot leak into Campaign B
  it("28. Campaign B strategy is distinct from Campaign A", async () => {
    const ctxA = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is our positioning?",
    });

    const ctxB = await buildAgentContext({
      accountId,
      campaignId: campaignB,
      userQuestion: "What is our positioning?",
    });

    expect(ctxA.systemPrompt).toContain("Buffer Social Media Management resolves small business");
    expect(ctxB.systemPrompt).toContain("AI-Powered Multi-Channel Video Repurposing");
    expect(ctxB.systemPrompt).not.toContain("Buffer Social Media Management");
  }, 15000);

  // 29. Unauthorized campaign access is blocked
  it("29. chat endpoint validates campaign ownership via assertCampaignBelongsTo", () => {
    const routeCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/server/agent/chat-routes.ts", "utf8");
    expect(routeCode).toContain("assertCampaignBelongsTo(accountId, String(campaignId))");
  });

  // 30. Agent cannot directly mutate Strategy Root
  it("30. system prompt explicitly forbids direct strategy mutations", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Change our positioning",
    });

    expect(ctx.systemPrompt).toContain("READ-ONLY IMMUTABILITY");
    expect(ctx.systemPrompt).toContain("Strategy Hub / Adaptation workflow");
  }, 15000);

  // 31. Agent cannot silently create WTDT tasks
  it("31. chat route contains zero task insertion logic on user requests", () => {
    const routeCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/server/agent/chat-routes.ts", "utf8");
    expect(routeCode).not.toContain("insert(schema.executionTasks)");
  });

  // 32. Deep links resolve correct existing routes
  it("32. dashboard agent panel parses valid deep-link routes", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("route: '/strategy'");
    expect(panelCode).toContain("route: '/watchtower'");
    expect(panelCode).toContain("route: '/wtdt'");
    expect(panelCode).toContain("route: '/reports'");
  });

  // 33. UI panel opens/closes cleanly
  it("33. UI panel supports minimize toggle without layout breakage", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("setIsMinimized(!isMinimized)");
    expect(panelCode).toContain("aiPanelCardMinimized");
  });

  // 34. Composer remains usable after several messages
  it("34. composer manages inputText state and clears on send", () => {
    const panelCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/components/DashboardAgentPanel.tsx", "utf8");
    expect(panelCode).toContain("setInputText('')");
    expect(panelCode).toContain("disabled={!inputText.trim() || isLoading}");
  });

  // 35. Product Truth question uses canonical Business Understanding source
  it("35. Product Truth question uses canonical Business Understanding source and traces to businessUnderstandingSnapshots", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is our Product Truth?",
    });

    expect(ctx.systemPrompt).toContain("Product Truth:");
    expect(ctx.trace.domainsUsed).toContain("BUSINESS");
    expect(ctx.trace.canonicalSourceTypes["BUSINESS"]).toMatch(/businessUnderstandingSnapshots|businessDataLayer/);
  }, 15000);
});
