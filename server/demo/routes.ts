/**
 * AVYRON DEMO ENVIRONMENT — Server Routes & Internal Evidence Viewer
 *
 * Exposes:
 *   - GET  /api/demo/status
 *   - POST /api/demo/scenario
 *   - POST /api/demo/reset
 *   - POST /api/demo/approve-plan
 *   - GET  /api/demo/evidence/:domainSlug/:evidenceId
 *   - GET  /api/demo/evidence/:evidenceId
 */

import type { Express, Request, Response } from "express";
import {
  assertDemoEnvironmentSafe,
  DEMO_BRAND_NAME,
  DEMO_OFFERING_NAME,
  DEMO_SCENARIO_ORDER,
  DemoScenarioState,
  isDemoMode,
} from "./config";
import { DEMO_EVIDENCE_RECORDS, DEMO_PRODUCT_FACTS } from "./fixtures";
import {
  DEMO_ADDITIONAL_EVIDENCE_RECORDS,
  DEMO_DEEP_REASONING_SCENARIOS,
  DEMO_PERFORMANCE_LOOP_CASES,
  DEMO_WATCHTOWER_EVENTS_LIST,
} from "./scenarios-extension";
import {
  applyDemoScenarioState,
  approveDemoScenarioProposal,
  approveDemoStrategyPlan,
  getDemoStatus,
  investigateDemoScenario,
} from "./scenario-service";

const ALL_DEMO_EVIDENCE_RECORDS = [
  ...DEMO_EVIDENCE_RECORDS,
  ...DEMO_ADDITIONAL_EVIDENCE_RECORDS,
];

function renderEvidenceHtmlPage(record: {
  id: string;
  domainSlug: string;
  competitorName: string;
  sourceType: string;
  platform: string;
  sentiment: string;
  publishedAt: string;
  title: string;
  verbatimText: string;
  productReferenced: string;
  packSizeAndPrice: string;
  strategicTakeaway: string;
  linkedPains: string[];
}): string {
  const sentimentColor =
    record.sentiment === "POSITIVE"
      ? "#10B981"
      : record.sentiment === "NEGATIVE"
      ? "#EF4444"
      : record.sentiment === "MIXED"
      ? "#F59E0B"
      : "#8B5CF6";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Avyron Demo Evidence Inspector — ${record.id}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 20px;
      background: #0B0F19;
      color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
    }
    .container {
      max-width: 780px;
      margin: 0 auto;
      background: #111827;
      border: 1px solid #1E293B;
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    }
    .demo-banner {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid rgba(139, 92, 246, 0.45);
      color: #C4B5FD;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      padding: 6px 12px;
      border-radius: 999px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 12px 0;
      color: #FFFFFF;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      background: #0F172A;
      border: 1px solid #1E293B;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .meta-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #64748B;
      margin-bottom: 4px;
    }
    .meta-val {
      font-size: 13px;
      font-weight: 600;
      color: #E2E8F0;
    }
    .verbatim-box {
      background: #1E293B;
      border-left: 4px solid ${sentimentColor};
      border-radius: 10px;
      padding: 18px 20px;
      margin-bottom: 20px;
      white-space: pre-wrap;
      font-size: 15px;
      color: #F1F5F9;
    }
    .takeaway-box {
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .takeaway-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: #34D399;
      margin-bottom: 6px;
    }
    .footer-note {
      font-size: 12px;
      color: #64748B;
      border-top: 1px solid #1E293B;
      padding-top: 14px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="demo-banner">DEMO · Synthetic Internal Evidence Record (${record.id})</div>
    <h1>${record.title}</h1>
    <div class="meta-grid">
      <div>
        <div class="meta-label">Attributed Entity</div>
        <div class="meta-val">${record.competitorName}</div>
      </div>
      <div>
        <div class="meta-label">Product & Pack Size</div>
        <div class="meta-val">${record.productReferenced} (${record.packSizeAndPrice})</div>
      </div>
      <div>
        <div class="meta-label">Source & Platform</div>
        <div class="meta-val">${record.sourceType} · ${record.platform}</div>
      </div>
      <div>
        <div class="meta-label">Sentiment & Date</div>
        <div class="meta-val" style="color: ${sentimentColor}">${record.sentiment} · ${record.publishedAt}</div>
      </div>
    </div>
    <div class="meta-label" style="margin-bottom: 6px;">Recorded Verbatim / Diff Extract</div>
    <div class="verbatim-box">${record.verbatimText}</div>
    <div class="takeaway-box">
      <div class="takeaway-title">Strategic Takeaway for ${DEMO_BRAND_NAME} (${DEMO_OFFERING_NAME})</div>
      <div>${record.strategicTakeaway}</div>
    </div>
    <div class="footer-note">
      This internal evidence view is part of the isolated Avyron Demo Environment. All competitors, reviews, and telemetry are fictionalized for product demonstration and are never presented as externally verified live URLs.
    </div>
  </div>
</body>
</html>`;
}

export function registerDemoRoutes(app: Express) {
  // 1. GET /api/demo/status
  app.get("/api/demo/status", async (_req: Request, res: Response) => {
    if (!isDemoMode()) {
      return res.json({ demoMode: false });
    }
    try {
      const status = await getDemoStatus();
      return res.json({ success: true, ...status });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        demoMode: true,
        error: err?.message || "Failed to read demo status.",
      });
    }
  });

  // 2. POST /api/demo/scenario
  app.post("/api/demo/scenario", async (req: Request, res: Response) => {
    try {
      assertDemoEnvironmentSafe();
      const targetState = req.body?.state as DemoScenarioState;
      if (!targetState || !DEMO_SCENARIO_ORDER.includes(targetState)) {
        return res.status(400).json({
          success: false,
          error: `Invalid scenario state. Expected one of: ${DEMO_SCENARIO_ORDER.join(", ")}`,
        });
      }
      const status = await applyDemoScenarioState(targetState);
      return res.json({ success: true, ...status });
    } catch (err: any) {
      console.error("[DemoRoutes] Failed to apply scenario state:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Failed to apply demo scenario state.",
      });
    }
  });

  // 3. POST /api/demo/reset
  // Defaults to MARKET_CHANGE_DETECTED (Recording Baseline: Strategy v1 Approved + 10 Watchtower events + 5 Historical Performance cases + 3 Scenarios Pending Investigation)
  app.post("/api/demo/reset", async (req: Request, res: Response) => {
    try {
      assertDemoEnvironmentSafe();
      const requestedState = (req.body?.state ||
        req.body?.targetState ||
        "MARKET_CHANGE_DETECTED") as DemoScenarioState;
      const targetState = DEMO_SCENARIO_ORDER.includes(requestedState)
        ? requestedState
        : "MARKET_CHANGE_DETECTED";
      const status = await applyDemoScenarioState(targetState);
      return res.json({
        success: true,
        message: `Demo environment reset to ${targetState} (Recording Baseline ready).`,
        ...status,
      });
    } catch (err: any) {
      console.error("[DemoRoutes] Failed to reset demo environment:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Failed to reset demo environment.",
      });
    }
  });

  // 4. POST /api/demo/approve-plan
  app.post("/api/demo/approve-plan", async (req: Request, res: Response) => {
    try {
      assertDemoEnvironmentSafe();
      const approval = await approveDemoStrategyPlan(req.body?.planId);
      const status = await getDemoStatus();
      return res.json({
        ...status,
        ...approval,
        demoStatus: status,
      });
    } catch (err: any) {
      console.error("[DemoRoutes] Failed to approve demo strategy plan:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Failed to approve demo strategy plan.",
      });
    }
  });

  // 5. POST /api/demo/investigate/:eventId (and POST /api/demo/investigate)
  const handleInvestigate = async (req: Request, res: Response) => {
    try {
      assertDemoEnvironmentSafe();
      const targetId =
        req.params.eventId ||
        req.body?.eventId ||
        req.body?.scenarioId ||
        req.body?.proposalId;
      if (!targetId) {
        return res.status(400).json({
          success: false,
          error: "Missing eventId or scenarioId to investigate.",
        });
      }
      const result = await investigateDemoScenario(String(targetId));
      const status = await getDemoStatus();
      return res.json({
        ...result,
        demoStatus: status,
      });
    } catch (err: any) {
      console.error("[DemoRoutes] Failed to investigate demo scenario:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Failed to open Deep Reasoning investigation.",
      });
    }
  };
  app.post("/api/demo/investigate/:eventId", handleInvestigate);
  app.post("/api/demo/investigate", handleInvestigate);

  // 6. POST /api/demo/approve-proposal/:proposalId
  app.post(
    "/api/demo/approve-proposal/:proposalId",
    async (req: Request, res: Response) => {
      try {
        assertDemoEnvironmentSafe();
        const proposalId = req.params.proposalId || req.body?.proposalId;
        const result = await approveDemoScenarioProposal(String(proposalId));
        const status = await getDemoStatus();
        return res.json({
          success: true,
          ...result,
          demoStatus: status,
        });
      } catch (err: any) {
        console.error("[DemoRoutes] Failed to approve demo proposal:", err);
        return res.status(500).json({
          success: false,
          error: err?.message || "Failed to approve demo proposal.",
        });
      }
    },
  );

  // 7. GET /api/demo/scenarios-catalog
  app.get("/api/demo/scenarios-catalog", async (_req: Request, res: Response) => {
    try {
      const status = await getDemoStatus();
      return res.json({
        success: true,
        watchtowerEvents: DEMO_WATCHTOWER_EVENTS_LIST,
        performanceLoopCases: DEMO_PERFORMANCE_LOOP_CASES,
        deepReasoningScenarios: DEMO_DEEP_REASONING_SCENARIOS,
        demoStatus: status,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || "Failed to load demo scenarios catalog.",
      });
    }
  });

  // 8. Internal Synthetic Evidence Detail Views
  const handleEvidenceRequest = (req: Request, res: Response) => {
    const evidenceId = req.params.evidenceId;
    const domainSlug = req.params.domainSlug || "zeytun-atelier.demo.invalid";

    const found = ALL_DEMO_EVIDENCE_RECORDS.find((r) => r.id === evidenceId);
    if (found) {
      if (
        req.query.format === "json" ||
        (req.headers.accept &&
          req.headers.accept.includes("application/json") &&
          !req.headers.accept.includes("text/html"))
      ) {
        return res.json({
          success: true,
          demoSyntheticEvidence: true,
          evidence: found,
        });
      }
      return res
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .send(renderEvidenceHtmlPage(found));
    }

    const foundFact = DEMO_PRODUCT_FACTS.find((f) => f.factId === evidenceId);
    if (foundFact) {
      const syntheticRecord = {
        id: foundFact.factId,
        domainSlug,
        competitorName: DEMO_BRAND_NAME,
        sourceType: `FIRST_PARTY_${foundFact.factType}`,
        platform: "zeytun_atelier_dossier",
        sentiment: "OBSERVATION",
        publishedAt: "2026-10-01",
        title: `First-Party Product Fact (${foundFact.factType}): ${foundFact.factId}`,
        verbatimText: foundFact.statement,
        productReferenced: DEMO_OFFERING_NAME,
        packSizeAndPrice: "400g · $32.00 USD",
        strategicTakeaway:
          "Verified first-party product truth fact governing strategy synthesis and claim boundaries.",
        linkedPains: [],
      };
      if (req.query.format === "json") {
        return res.json({
          success: true,
          demoSyntheticEvidence: true,
          evidence: syntheticRecord,
        });
      }
      return res
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .send(renderEvidenceHtmlPage(syntheticRecord));
    }

    return res.status(404).json({
      success: false,
      error: `Synthetic demo evidence "${evidenceId}" not found.`,
    });
  };

  app.get("/api/demo/evidence/:domainSlug/:evidenceId", handleEvidenceRequest);
  app.get("/api/demo/evidence/:evidenceId", handleEvidenceRequest);
}
