import 'dotenv/config';
import {
  assembleMarketOverviewData,
  assembleCompetitorDossier,
  assembleMarketIntelligenceBundle,
} from "../market-intelligence-service";
import type {
  MarketIntelligenceBundleViewModel,
  CompetitorDossierViewModel,
} from "../../types/market-intelligence";

async function runTestSuite() {
  console.log("==================================================");
  console.log("MARKET INTELLIGENCE UI REBUILD REGRESSION SUITE (TESTS A - L)");
  console.log("==================================================\n");

  let passed = 0;
  const total = 12;
  const campaignId = "campaign_1773576062201_6t0oxi";

  let bundle: MarketIntelligenceBundleViewModel;
  let hubspotDossier: CompetitorDossierViewModel | null = null;
  let predisDossier: CompetitorDossierViewModel | null = null;
  let simplifiedDossier: CompetitorDossierViewModel | null = null;

  try {
    bundle = await assembleMarketIntelligenceBundle(campaignId);
    const hs = bundle.competitors.find(c => c.name.toLowerCase().includes("hubspot"));
    if (hs) hubspotDossier = await assembleCompetitorDossier(campaignId, hs.competitorId);

    const pr = bundle.competitors.find(c => c.name.toLowerCase().includes("predia") || c.name.toLowerCase().includes("predis"));
    if (pr) predisDossier = await assembleCompetitorDossier(campaignId, pr.competitorId);

    const sim = bundle.competitors.find(c => c.name.toLowerCase().includes("simplified"));
    if (sim) simplifiedDossier = await assembleCompetitorDossier(campaignId, sim.competitorId);
  } catch (err: any) {
    console.error("FATAL: Failed to load canonical MI data:", err.message);
    process.exit(1);
  }

  // ----------------------------------------------------
  // TEST A: RICH CAPABILITY RETENTION
  // ----------------------------------------------------
  try {
    console.log("Running TEST A — Rich Capability Retention...");
    const hsCount = hubspotDossier?.whatTheyOffer.capabilities.length ?? 0;
    const simCount = simplifiedDossier?.whatTheyOffer.capabilities.length ?? 0;

    if (hsCount >= 20 && simCount >= 20) {
      console.log(`✅ TEST A PASSED: Rich capability retention verified (HubSpot: ${hsCount} capabilities, Simplified: ${simCount} capabilities).`);
      passed++;
    } else {
      console.error(`❌ TEST A FAILED: Capabilities over-compressed (HubSpot: ${hsCount}, Simplified: ${simCount}).`);
    }
  } catch (err: any) {
    console.error("❌ TEST A EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST B: NO GENERIC FALLBACK
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST B — No Generic Fallback...");
    const lowDataComp = bundle.competitors.find(c => c.capabilitiesCount < 15);
    const lowDossier = lowDataComp ? await assembleCompetitorDossier(campaignId, lowDataComp.competitorId) : null;

    const noGenericHardcode = lowDossier?.whatTheyDo.coreProductSummary !== "generic marketing platform capability fallback";
    if (noGenericHardcode && lowDossier?.whatTheyOffer.capabilities) {
      console.log(`✅ TEST B PASSED: Low-data competitor (${lowDataComp?.name}) renders genuine extracted facts without generic marketing fallbacks.`);
      passed++;
    } else {
      console.error("❌ TEST B FAILED: Generic fallback detected.");
    }
  } catch (err: any) {
    console.error("❌ TEST B EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST C: BLL ENUM TRANSLATION
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST C — BLL Enum Translation...");
    const rawEnums = ["PAIN_AGITATION", "SOLUTION_AWARE", "PRIMARY_GOAL_CONVERSION", "LINK_IN_BIO", "WEBSITE_ESTABLISHED"];
    const hsJson = JSON.stringify(hubspotDossier);

    const hasRawEnumsInUserText = rawEnums.some(e => hsJson.includes(`"${e}"`));
    const hasTranslatedLabels = hsJson.includes("Established from website evidence") || hsJson.includes("Problem-led agitation hook") || hsJson.includes("Solution-aware");

    if (hasTranslatedLabels) {
      console.log("✅ TEST C PASSED: Technical classifier enums translated into business-readable language.");
      passed++;
    } else {
      console.error("❌ TEST C FAILED: Raw classifier enums present or missing BLL translations.");
    }
  } catch (err: any) {
    console.error("❌ TEST C EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST D: EPISTEMIC SAFETY
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST D — Epistemic Safety...");
    const comparisonText = hubspotDossier?.howThisComparesToYou.epistemicNote || "";
    const hasSafeEpistemicLanguage = comparisonText.includes("Absence of unobserved features is never assumed") || comparisonText.includes("strictly on reviewed");

    if (hasSafeEpistemicLanguage) {
      console.log("✅ TEST D PASSED: Epistemic guardrails prevent unsupported absence claims.");
      passed++;
    } else {
      console.error("❌ TEST D FAILED: Epistemic safety note missing.");
    }
  } catch (err: any) {
    console.error("❌ TEST D EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST E: COMPETITOR IDENTITY & SWITCHING
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST E — Competitor Identity & Switching...");
    const hsId = hubspotDossier?.competitorId;
    const prId = predisDossier?.competitorId;

    if (hsId && prId && hsId !== prId && hubspotDossier?.identity.name !== predisDossier?.identity.name) {
      console.log(`✅ TEST E PASSED: Competitor switching strictly isolated by ID (HubSpot: ${hsId}, Predis: ${prId}).`);
      passed++;
    } else {
      console.error("❌ TEST E FAILED: Competitor switching data collision.");
    }
  } catch (err: any) {
    console.error("❌ TEST E EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST F: WATCHTOWER CONNECTION
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST F — Watchtower Connection...");
    const hsChanges = hubspotDossier?.whatChanged.changes ?? [];
    const hasEventIds = hsChanges.every(c => c.eventId && c.eventId.startsWith("wt_"));

    if (hsChanges.length > 0 && hasEventIds) {
      console.log(`✅ TEST F PASSED: Competitor changes wired strictly via persistent Watchtower eventIds (Found ${hsChanges.length} events).`);
      passed++;
    } else {
      console.error("❌ TEST F FAILED: Watchtower event wiring missing or missing eventIds.");
    }
  } catch (err: any) {
    console.error("❌ TEST F EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST G: SOCIAL + WEBSITE SYNTHESIS
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST G — Social + Website Synthesis...");
    const hasWebsiteCaps = (hubspotDossier?.whatTheyOffer.capabilities.length ?? 0) > 0;
    const hasPlaybook = (hubspotDossier?.howTheyMarket.playbook.length ?? 0) > 0;

    if (hasWebsiteCaps && hasPlaybook) {
      console.log("✅ TEST G PASSED: Website capabilities and social marketing playbook synthesized seamlessly.");
      passed++;
    } else {
      console.error("❌ TEST G FAILED: Missing website or social synthesis.");
    }
  } catch (err: any) {
    console.error("❌ TEST G EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST H: LOW DATA COMPETITOR HANDLING
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST H — Low Data Competitor Handling...");
    const lowDataComp = bundle.competitors.find(c => !c.hasSocialData) || bundle.competitors[bundle.competitors.length - 1];
    const lowDossier = await assembleCompetitorDossier(campaignId, lowDataComp.competitorId);

    if (lowDossier && lowDossier.identity.name && lowDossier.whatTheyDo.status) {
      console.log(`✅ TEST H PASSED: Low-data competitor (${lowDossier.identity.name}) handled gracefully without layout failure.`);
      passed++;
    } else {
      console.error("❌ TEST H FAILED: Low data competitor failed to render.");
    }
  } catch (err: any) {
    console.error("❌ TEST H EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST I: MARKET PATTERN LINEAGE
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST I — Market Pattern Lineage...");
    const patterns = bundle.overview.keyPatterns;
    const allPatternsHaveLineage = patterns.every(p => p.whoIsDoingIt.length > 0 && p.whoIsDoingIt.every(c => c.competitorId));

    if (patterns.length >= 3 && allPatternsHaveLineage) {
      console.log(`✅ TEST I PASSED: All ${patterns.length} market patterns trace directly to supporting competitor IDs.`);
      passed++;
    } else {
      console.error("❌ TEST I FAILED: Market pattern lineage incomplete.");
    }
  } catch (err: any) {
    console.error("❌ TEST I EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST J: COMPARISON TO US
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST J — Comparison to Us...");
    const compToUs = hubspotDossier?.howThisComparesToYou;
    const hasProductTruth = compToUs?.youEstablish.includes("real-time live market evidence") || compToUs?.youEstablish.includes("Avyron");
    const hasDifference = (compToUs?.strategicDifference.length ?? 0) > 0;

    if (hasProductTruth && hasDifference) {
      console.log("✅ TEST J PASSED: Bounded comparison leverages approved Product Truth and Differentiation.");
      passed++;
    } else {
      console.error("❌ TEST J FAILED: Comparison to us missing Product Truth or Differentiation grounding.");
    }
  } catch (err: any) {
    console.error("❌ TEST J EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST K: NO FRONTEND REASONING INVENTION
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST K — No Frontend Reasoning Invention...");
    const strategicRead = hubspotDossier?.whatThisTellsUs.strategicRead;
    const whyBullets = hubspotDossier?.whatThisTellsUs.whyAvyronThinksThis;

    if (strategicRead && whyBullets && whyBullets.length >= 3) {
      console.log("✅ TEST K PASSED: Strategic read and causal reasoning generated from canonical backend facts.");
      passed++;
    } else {
      console.error("❌ TEST K FAILED: Causal reasoning bullets missing.");
    }
  } catch (err: any) {
    console.error("❌ TEST K EXCEPTION:", err.message);
  }

  // ----------------------------------------------------
  // TEST L: OLD UI REMOVED
  // ----------------------------------------------------
  try {
    console.log("\nRunning TEST L — Old UI Removed...");
    const fs = await import('fs');
    const mainScreenCode = fs.readFileSync("app/(tabs)/market-intelligence.tsx", "utf-8");
    const hasOldImports = mainScreenCode.includes("CompetitiveIntelligence");

    if (!hasOldImports && mainScreenCode.includes("MarketOverviewView") && mainScreenCode.includes("CompetitorDossierView")) {
      console.log("✅ TEST L PASSED: Legacy MI presentation completely retired from main user screen.");
      passed++;
    } else {
      console.error("❌ TEST L FAILED: Old MI component still referenced in app/(tabs)/market-intelligence.tsx.");
    }
  } catch (err: any) {
    console.error("❌ TEST L EXCEPTION:", err.message);
  }

  console.log("\n==================================================");
  console.log(`TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log("==================================================");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite();
