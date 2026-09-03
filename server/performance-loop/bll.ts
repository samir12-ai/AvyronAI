import type { ExecutionMode, PrimaryBottleneck, ExecutionConfidence } from "./business-state-reasoner";
import type { BusinessExecutionStateRow, PerformanceContextRow, ClarificationRequestRow } from "@shared/schema";

export interface BusinessPerformancePresentation {
  stateBadgeLabel: string;
  stateBadgeDescription: string;
  bottleneckLabel: string | null;
  bottleneckDescription: string | null;
  confidenceLabel: string;
  executiveSummary: string;
  reasoningSections: {
    whatAvyronObserved: string;
    whatItMeans: string;
    uncertainties: string[];
    supportingEvidence: string[];
  };
  dataCoverage: Array<{
    sourceName: string;
    status: "CONNECTED" | "PARTIAL" | "NOT_CONNECTED" | "COMING_SOON" | "FAILED" | "STALE";
    statusLabel: string;
    detail: string;
  }>;
  clarificationCard?: {
    requestId: string;
    missingFactType: string;
    question: string;
    reason: string;
  } | null;
}

export function translatePerformanceToBll(
  executionState: BusinessExecutionStateRow,
  performanceContext?: PerformanceContextRow | null,
  clarificationRequest?: ClarificationRequestRow | null
): BusinessPerformancePresentation {
  const mode = (executionState.mode as ExecutionMode) || "UNKNOWN";
  const bottleneck = (executionState.primaryBottleneck as PrimaryBottleneck) || "UNKNOWN";
  const confidence = (executionState.confidence as ExecutionConfidence) || "LOW";

  // 1. Business State Badge
  let stateBadgeLabel = "More Business Context Needed";
  let stateBadgeDescription = "Avyron is analyzing performance sources to verify operational history.";
  if (mode === "BUILD") {
    stateBadgeLabel = "Building Market Traction";
    stateBadgeDescription = "Focusing on prospect discovery, message resonance, lead capture, and early proof.";
  } else if (mode === "OPTIMIZE") {
    stateBadgeLabel = "Optimizing Existing Growth";
    stateBadgeDescription = "Evaluating verified operational history to diagnose and resolve growth bottlenecks.";
  }

  // 2. Bottleneck Translation
  let bottleneckLabel: string | null = null;
  let bottleneckDescription: string | null = null;

  if (mode === "OPTIMIZE" && bottleneck !== "UNKNOWN" && bottleneck !== "NONE") {
    switch (bottleneck) {
      case "REACH":
        bottleneckLabel = "Expanding Audience Reach";
        bottleneckDescription = "Current content and channel distribution require broader prospect exposure.";
        break;
      case "ENGAGEMENT":
        bottleneckLabel = "Deepening Prospect Engagement";
        bottleneckDescription = "Content reach is healthy, but audience interactions and interest require strengthening.";
        break;
      case "INTENT":
        bottleneckLabel = "Sharpening Buyer Intent";
        bottleneckDescription = "Prospects engage with content, but call-to-action click-throughs need higher clarity.";
        break;
      case "CONVERSATION":
        bottleneckLabel = "Generating High-Intent Conversations";
        bottleneckDescription = "Prospects visit offerings, but sales inquiries and direct discussions require acceleration.";
        break;
      case "CONVERSION":
        bottleneckLabel = "Converting Interest Into Customers";
        bottleneckDescription = "Inquiries and leads are active, but closing friction requires risk-reversal and proof.";
        break;
      case "RETENTION":
        bottleneckLabel = "Maximizing Customer Retention";
        bottleneckDescription = "Initial customer conversions are active; repeat engagement and retention are prioritized.";
        break;
    }
  }

  // 3. Confidence Label
  const confidenceLabel = confidence === "HIGH" ? "High Confidence" : confidence === "MEDIUM" ? "Moderate Confidence" : "Low Confidence / Gathering Data";

  // 4. Executive Summary & Reasoning
  const executiveSummary = executionState.evidenceSummary || "Performance analysis complete.";
  const uncertainties = (performanceContext?.weakestSignals as string[]) || [];
  const supportingEvidence = (performanceContext?.provenAssets as string[]) || [];

  // 5. Data Coverage Translation
  const channelState = (executionState.observedChannelState as any) || {};
  const dataCoverage = [
    {
      sourceName: "Website",
      status: (executionState.observedDemandState as any)?.hasWebsite ? "CONNECTED" as const : "NOT_CONNECTED" as const,
      statusLabel: (executionState.observedDemandState as any)?.hasWebsite ? "Connected" : "Not Connected",
      detail: (executionState.observedDemandState as any)?.hasWebsite ? "Website product offering analyzed" : "No live website detected",
    },
    {
      sourceName: "Instagram",
      status: channelState.instagramConnected ? "CONNECTED" as const : "NOT_CONNECTED" as const,
      statusLabel: channelState.instagramConnected ? "Connected" : "Not Connected",
      detail: channelState.instagramConnected ? `${(executionState.observedBusinessHistory as any)?.totalHistoricalPosts ?? 0} historical posts observed` : "No active Instagram profile linked",
    },
    {
      sourceName: "TikTok",
      status: (channelState.tikTokStatus as any) || "COMING_SOON",
      statusLabel: channelState.tikTokStatus === "CONNECTED" ? "Connected" : "Coming Soon",
      detail: "Source contract ready for future scraper integration",
    },
    {
      sourceName: "YouTube",
      status: (channelState.youTubeStatus as any) || "COMING_SOON",
      statusLabel: channelState.youTubeStatus === "CONNECTED" ? "Connected" : "Coming Soon",
      detail: "Source contract ready for future scraper integration",
    },
    {
      sourceName: "LinkedIn",
      status: "COMING_SOON" as const,
      statusLabel: "Coming Soon",
      detail: "Source contract ready for future scraper integration",
    },
    {
      sourceName: "Facebook",
      status: "COMING_SOON" as const,
      statusLabel: "Coming Soon",
      detail: "Source contract ready for future scraper integration",
    },
    {
      sourceName: "X / Twitter",
      status: "COMING_SOON" as const,
      statusLabel: "Coming Soon",
      detail: "Source contract ready for future scraper integration",
    },
    {
      sourceName: "Manual Business Metrics",
      status: (executionState.observedConversionState as any)?.hasUserTruth ? "CONNECTED" as const : "NOT_CONNECTED" as const,
      statusLabel: (executionState.observedConversionState as any)?.hasUserTruth ? "User Confirmed" : "Not Provided",
      detail: (executionState.observedConversionState as any)?.hasUserTruth ? "User-entered sales and lead metrics active" : "User-entered business truth optional",
    },
  ];

  // 6. Clarification Card Translation
  let clarificationCard: BusinessPerformancePresentation["clarificationCard"] = null;
  if (clarificationRequest && clarificationRequest.status === "PENDING") {
    clarificationCard = {
      requestId: clarificationRequest.id,
      missingFactType: clarificationRequest.missingFactType,
      question: clarificationRequest.question,
      reason: clarificationRequest.reason || "Clarification needed to establish business mode.",
    };
  }

  return {
    stateBadgeLabel,
    stateBadgeDescription,
    bottleneckLabel,
    bottleneckDescription,
    confidenceLabel,
    executiveSummary,
    reasoningSections: {
      whatAvyronObserved: executionState.evidenceSummary || "Verified factual evidence analyzed.",
      whatItMeans: executionState.reason || "Business execution mode evaluated.",
      uncertainties,
      supportingEvidence,
    },
    dataCoverage,
    clarificationCard,
  };
}
