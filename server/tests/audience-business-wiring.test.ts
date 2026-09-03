import "dotenv/config";
import { describe, it, expect } from "vitest";
import { loadProductDNA, formatProductDNAForPrompt } from "../shared/product-dna";

const REAL_CAMPAIGN_ID = "campaign_1773576062201_6t0oxi";
const REAL_ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

describe("BUSINESS AUTHORITY → AUDIENCE WIRING REPAIR TESTS", () => {
  it("TEST A — CURRENT SCHEMA PARSING: loadProductDNA returns actual canonical values without placeholders", async () => {
    const dna = await loadProductDNA(REAL_CAMPAIGN_ID, REAL_ACCOUNT_ID);
    expect(dna).not.toBeNull();
    if (!dna) return;

    // Check core offer and category
    expect(dna.coreOffer).toBe("Avyron AI");
    expect(dna.productCategory).toBeTruthy();

    // Must NOT contain placeholder semantics
    expect(dna.coreProblemSolved).not.toBe("Migrated");
    expect(dna.uniqueMechanism).not.toBe("Migrated");
    expect(dna.strategicAdvantage).not.toBe("Migrated");
    expect(dna.targetDecisionMaker).not.toBe("Unknown");
    expect(dna.targetAudienceSegment).not.toBe("Market");

    // Must contain meaningful text
    expect(dna.coreProblemSolved).toBeTruthy();
    expect(dna.uniqueMechanism).toBeTruthy();
    expect(dna.targetDecisionMaker).toBeTruthy();
  });

  it("TEST B — PRODUCT TRUTH TO AUDIENCE: productTruthFacts are extracted with IDs and statements", async () => {
    const dna = await loadProductDNA(REAL_CAMPAIGN_ID, REAL_ACCOUNT_ID);
    expect(dna).not.toBeNull();
    if (!dna) return;

    expect(Array.isArray(dna.productTruthFacts)).toBe(true);
    expect(dna.productTruthFacts!.length).toBeGreaterThan(0);

    // Verify first fact structure
    const fact = dna.productTruthFacts![0];
    expect(fact.productTruthFactId).toBeDefined();
    expect(typeof fact.productTruthFactId).toBe("string");
    expect(fact.statement).toBeDefined();
    expect(fact.statement.length).toBeGreaterThan(10);
    expect(fact.factType).toBeDefined();
  });

  it("TEST C — TARGET UNDERSTANDING TO AUDIENCE: targetRoles are extracted with roleTitle and roleType", async () => {
    const dna = await loadProductDNA(REAL_CAMPAIGN_ID, REAL_ACCOUNT_ID);
    expect(dna).not.toBeNull();
    if (!dna) return;

    expect(Array.isArray(dna.targetRoles)).toBe(true);
    expect(dna.targetRoles!.length).toBeGreaterThan(0);

    const role = dna.targetRoles![0];
    expect(role.targetRoleFactId).toBeDefined();
    expect(role.roleTitle).toBeDefined();
    expect(role.roleTitle.length).toBeGreaterThan(5);
    expect(role.roleType).toBeDefined();

    // Verify decision maker and user roles exist
    const hasDecisionMaker = dna.targetRoles!.some(r => r.roleType === "DECISION_MAKER");
    expect(hasDecisionMaker).toBe(true);
  });

  it("TEST D — JUDGE PARITY: formatProductDNAForPrompt renders both Target Roles and Product Truth Facts", async () => {
    const dna = await loadProductDNA(REAL_CAMPAIGN_ID, REAL_ACCOUNT_ID);
    expect(dna).not.toBeNull();
    if (!dna) return;

    const formatted = formatProductDNAForPrompt(dna);
    
    // Check for target roles rendering
    expect(formatted).toContain("Canonical Target Roles:");
    expect(formatted).toContain("[DECISION_MAKER]");
    expect(formatted).toContain(dna.targetRoles![0].targetRoleFactId);

    // Check for product truth facts rendering
    expect(formatted).toContain("Canonical Product Truth Capabilities & Facts:");
    expect(formatted).toContain(dna.productTruthFacts![0].productTruthFactId);
    expect(formatted).toContain(dna.productTruthFacts![0].statement);
  });

  it("TEST E — NO LEGACY SILENT FALLBACK: returns null for non-existent campaign", async () => {
    const nonExistentCampaign = `non_existent_campaign_${Date.now()}`;
    const dna = await loadProductDNA(nonExistentCampaign, REAL_ACCOUNT_ID);
    expect(dna).toBeNull();
  });

  it("TEST F — NO PLACEHOLDER SEMANTICS: 0 occurrences of placeholder words in formatted output", async () => {
    const dna = await loadProductDNA(REAL_CAMPAIGN_ID, REAL_ACCOUNT_ID);
    expect(dna).not.toBeNull();
    if (!dna) return;

    const formatted = formatProductDNAForPrompt(dna);

    expect(formatted).not.toContain("Core Problem Solved: Migrated");
    expect(formatted).not.toContain("Unique Mechanism: Migrated");
    expect(formatted).not.toContain("Strategic Advantage: Migrated");
    expect(formatted).not.toContain("Target Decision Maker: Unknown");
    expect(formatted).not.toContain("Target Audience: Market\n");
  });
});
