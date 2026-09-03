import "dotenv/config";
import { describe, it, expect } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { buildAgentContext } from "../agent/context-assembler";
import fs from "fs";

describe("Avyron Agent Strategic Explainer UX — Explain First, Navigate Second", () => {
  const accountId = "acc_buffer_e2e_1787909177715";
  const campaignA = "camp_buffer_e2e_1787909177715";
  const campaignB = "camp_brand_beta_isolation";

  // 1. Direct strategy explanation instruction exists
  it("1. system prompt instructs model to answer first and explain fully inside chat", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Explain our strategy simply.",
    });

    expect(ctx.systemPrompt).toContain("CORE DOCTRINE — EXPLAIN FIRST, NAVIGATE SECOND");
    expect(ctx.systemPrompt).toContain("ANSWER FIRST & EXPLAIN FULLY");
    expect(ctx.systemPrompt).toContain("NEVER deflect or replace an explanation with");
  }, 15000);

  // 2. Plain-language explanation instruction
  it("2. system prompt supports plain-language explanations with zero marketing jargon", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Explain it like I know nothing about marketing.",
    });

    expect(ctx.systemPrompt).toContain("Explain like I'm not a marketer");
    expect(ctx.systemPrompt).toContain("zero marketing jargon, and plain business English");
  }, 15000);

  // 3. Why reasoning connects strategic chain
  it("3. system prompt provides connected strategic chain (Audience -> Positioning -> Differentiation -> Offer -> Funnel -> Channels)", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Why did we choose this positioning?",
    });

    expect(ctx.systemPrompt).toContain("CONNECT THE STRATEGIC CHAIN");
    expect(ctx.systemPrompt).toContain("Enemy Definition:");
    expect(ctx.systemPrompt).toContain("Contrast Axis:");
    expect(ctx.trace.domainsUsed).toContain("POSITIONING");
  }, 15000);

  // 4. Distinction between Positioning and Differentiation
  it("4. context contains explicit Positioning and Differentiation authorities for contrast", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What's the difference between our positioning and differentiation?",
    });

    expect(ctx.systemPrompt).toContain("3. POSITIONING AUTHORITY");
    expect(ctx.systemPrompt).toContain("4. DIFFERENTIATION AUTHORITY");
    expect(ctx.trace.domainsUsed).toContain("POSITIONING");
    expect(ctx.trace.domainsUsed).toContain("DIFFERENTIATION");
  }, 15000);

  // 5. Funnel step-by-step breakdown
  it("5. context provides 4-stage funnel breakdown for each approved lane", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Explain the Funnel step by step.",
    });

    expect(ctx.systemPrompt).toContain("STEP-BY-STEP FUNNEL & BUYER PSYCHOLOGY");
    expect(ctx.systemPrompt).toContain("Awareness:");
    expect(ctx.systemPrompt).toContain("Consideration:");
    expect(ctx.systemPrompt).toContain("Conversion:");
    expect(ctx.systemPrompt).toContain("Retention:");
    expect(ctx.trace.domainsUsed).toContain("FUNNEL");
  }, 15000);

  // 6. Buyer hesitation and psychology
  it("6. context articulates buyer fears, objections, and required proof", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Why does the buyer hesitate?",
    });

    expect(ctx.systemPrompt).toContain("7. PERSUASION & BUYER PSYCHOLOGY BY LANE");
    expect(ctx.systemPrompt).toContain("Primary Objection:");
    expect(ctx.systemPrompt).toContain("Buyer Worries:");
    expect(ctx.systemPrompt).toContain("Required Proof:");
    expect(ctx.trace.domainsUsed).toContain("PERSUASION");
  }, 15000);

  // 7. Offer solves hesitation
  it("7. context links offer and risk reversal to buyer objection elimination", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "How does our offer solve that?",
    });

    expect(ctx.systemPrompt).toContain("5. OFFER AUTHORITY");
    expect(ctx.systemPrompt).toContain("Risk Reversal:");
    expect(ctx.trace.domainsUsed).toContain("OFFER");
  }, 15000);

  // 8. Multi-lane contrast
  it("8. context contrasts Lane 1 (SMB Managers) and Lane 2 (Content Creators)", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Why is this lane different from the other one?",
    });

    expect(ctx.systemPrompt).toContain("Lane 1: \"Simplified Scheduling for Small Business Social Media Managers\"");
    expect(ctx.systemPrompt).toContain("Lane 2: \"Visual Content Scheduling for Creators on Instagram and Beyond\"");
    expect(ctx.systemPrompt).toContain("LANE COMPARISON & SCOPING");
  }, 15000);

  // 9. Channel strategy & distribution rationale
  it("9. context includes channel selection and strategic distribution rationale", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Why are we using these channels?",
    });

    expect(ctx.systemPrompt).toContain("8. CHANNEL STRATEGY");
    expect(ctx.systemPrompt).toContain("Channel Rationale:");
    expect(ctx.trace.domainsUsed).toContain("CHANNELS");
  }, 15000);

  // 10. Strategy update evolution breakdown
  it("10. context provides Before -> Why -> What Changed -> Expected Effect -> Result lifecycle", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What changed in the latest strategy update?",
    });

    expect(ctx.systemPrompt).toContain("STRATEGY EVOLUTION & CHANGES");
    expect(ctx.systemPrompt).toContain("Strategic Lineage & Evolution");
  }, 15000);

  // 11. Causal discipline with INSUFFICIENT_DATA
  it("11. causal discipline enforces INSUFFICIENT_DATA for in-flight adaptation outcomes", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Did it work?",
    });

    expect(ctx.systemPrompt).toContain("STRICT CAUSAL DISCIPLINE");
    expect(ctx.systemPrompt).toContain("INSUFFICIENT_DATA");
    expect(ctx.trace.causalStatuses["ADAPTATION_OUTCOME"]).toBe("INSUFFICIENT_DATA");
  }, 15000);

  // 12. Ad example generation instructions
  it("12. system prompt directs model to provide concrete ad and marketing examples", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Give me a real example of how this strategy should look in an ad.",
    });

    expect(ctx.systemPrompt).toContain("Ad example");
    expect(ctx.systemPrompt).toContain("Provide concrete, realistic examples (e.g. ad hook, video scene, visual copy, CTA)");
  }, 15000);

  // 13. Strategic weakness & risk analysis
  it("13. system prompt enables honest strategic risk and weakness analysis", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "What is the biggest weakness in this strategy?",
    });

    expect(ctx.systemPrompt).toContain("What is the biggest weakness / risk?");
    expect(ctx.systemPrompt).toContain("Honestly discuss strategic risks");
  }, 15000);

  // 14. Concise summarization
  it("14. system prompt handles exact sentence-count summarization requests", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Summarize everything in 5 sentences.",
    });

    expect(ctx.systemPrompt).toContain("Summarize in N sentences");
    expect(ctx.systemPrompt).toContain("Provide an exact, high-impact N-sentence summary");
  }, 15000);

  // 15. Secondary deep links only
  it("15. navigation links are strictly designated as optional secondary shortcuts", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Explain our strategy.",
    });

    expect(ctx.systemPrompt).toContain("OPTIONAL SECONDARY NAVIGATION");
    expect(ctx.systemPrompt).toContain("ONLY after your full conversational explanation is complete");
  }, 15000);

  // 16. Multi-turn conversation retention in routes
  it("16. chat route loads 10 past messages and preserves context across follow-ups", () => {
    const routeCode = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/server/agent/chat-routes.ts", "utf8");
    expect(routeCode).toContain(".limit(10)");
    expect(routeCode).toContain("priorUserQueries");
  });

  // 17. Broken UI page safety
  it("17. Agent reads directly from database snapshots without depending on UI page state", async () => {
    const ctx = await buildAgentContext({
      accountId,
      campaignId: campaignA,
      userQuestion: "Explain our strategy.",
    });

    expect(ctx.trace.artifactIds.length).toBeGreaterThan(0);
    expect(ctx.trace.canonicalSourceTypes["STRATEGY_ROOT"]).toBe("strategyRoots");
    expect(ctx.trace.canonicalSourceTypes["POSITIONING"]).toBe("positioningSnapshots");
    expect(ctx.trace.canonicalSourceTypes["OFFER"]).toBe("offerSnapshots");
  }, 15000);
});
