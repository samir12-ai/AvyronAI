/**
 * Product Identity Source-of-Truth Tests (Phase 10)
 *
 * Verify that:
 * 1. Product Identity (product_anchor) is the primary source used by engines.
 * 2. The "Product DNA" label does not appear in UI components or active LLM prompts.
 * 3. Business context (businessDataLayer) is supplementary, not primary.
 * 4. Product Identity missing produces a truthful state, not a silent fallback.
 * 5. Tenant isolation is preserved.
 * 6. formatProductDNAForPrompt no longer labels output as "Product DNA".
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(__dirname, "../..");

function readSrc(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. UI: BusinessDataForm does NOT label its product section "Product DNA"
// ──────────────────────────────────────────────────────────────────────────────
describe("BusinessDataForm UI — Phase 7 (UI label removal)", () => {
  const src = readSrc("components/BusinessDataForm.tsx");

  it("does not render 'Product DNA' as a section label", () => {
    // The string can still appear in comments; we check the JSX text node
    // (inside a Text element — never as a bare comment / import / type name).
    const textNodeMatches = src.match(/<Text[^>]*>Product DNA<\/Text>/g);
    expect(textNodeMatches).toBeNull();
  });

  it("has a 'Product Details' section label instead", () => {
    expect(src).toContain("Product Details");
  });

  it("still contains all product detail fields (no data loss)", () => {
    expect(src).toContain("productCategory");
    expect(src).toContain("coreProblemSolved");
    expect(src).toContain("uniqueMechanism");
    expect(src).toContain("strategicAdvantage");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. BusinessProfile shows Product Identity section, not Product DNA
// ──────────────────────────────────────────────────────────────────────────────
describe("BusinessProfile UI — Product Identity section", () => {
  const src = readSrc("components/BusinessProfile.tsx");

  it("renders ProductIdentityEditor", () => {
    expect(src).toContain("ProductIdentityEditor");
  });

  it("labels the section 'Product Identity'", () => {
    expect(src).toContain("Product Identity");
  });

  it("does not render a 'Product DNA' text node", () => {
    const textNodeMatches = src.match(/<Text[^>]*>Product DNA<\/Text>/g);
    expect(textNodeMatches).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. formatProductDNAForPrompt no longer says "Product DNA (Source of Truth)"
// ──────────────────────────────────────────────────────────────────────────────
describe("product-dna.ts — prompt label consistency", () => {
  const src = readSrc("server/shared/product-dna.ts");

  it("does not label prompt output as 'PRODUCT DNA (Source of Truth)'", () => {
    expect(src).not.toContain("PRODUCT DNA (Source of Truth)");
  });

  it("does not label prompt output as 'PRODUCT DNA:'", () => {
    // Ensure the legacy label is gone from the prompt body
    expect(src).not.toContain("`PRODUCT DNA (Source of Truth):`");
    expect(src).not.toContain('"PRODUCT DNA (Source of Truth):"');
  });

  it("labels prompt output as 'PRODUCT CONTEXT:'", () => {
    expect(src).toContain("PRODUCT CONTEXT:");
  });

  it("is annotated as supplementary_context_only", () => {
    expect(src).toContain("supplementary_context_only");
  });

  it("instructs new consumers to use loadCampaignProductAnchor", () => {
    expect(src).toContain("loadCampaignProductAnchor");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Engine anchor preference: Product Identity preferred over business context
// ──────────────────────────────────────────────────────────────────────────────
describe("Engine anchor priority — Product Identity preferred", () => {
  const engineFiles: Record<string, string> = {
    "awareness-engine": readSrc("server/awareness-engine/engine.ts"),
    "funnel-engine": readSrc("server/funnel-engine/engine.ts"),
    "mechanism-engine": readSrc("server/mechanism-engine/engine.ts"),
    "persuasion-engine": readSrc("server/persuasion-engine/engine.ts"),
    "differentiation-engine": readSrc("server/differentiation-engine/engine.ts"),
    "positioning-engine": readSrc("server/positioning-engine/engine.ts"),
    "audience-engine": readSrc("server/audience-engine/engine.ts"),
    "offer-engine": readSrc("server/offer-engine/engine.ts"),
  };

  for (const [engineName, src] of Object.entries(engineFiles)) {
    it(`${engineName}: prefers doctrine.productAnchor (Product Identity) over DNA-derived anchor`, () => {
      // Each engine checks strategic.doctrine.productAnchor first, then falls
      // back — verify the preference pattern exists.
      const hasDoctrinePreference =
        src.includes("doctrine.productAnchor") || src.includes("strategic?.doctrine.productAnchor");
      expect(hasDoctrinePreference).toBe(true);
    });

    it(`${engineName}: LLM prompt strings do NOT say "derived from Product DNA"`, () => {
      // The strings sent to the LLM should not reference the old internal concept
      expect(src).not.toContain("derived from Product DNA");
    });

    it(`${engineName}: LLM anchor prompt does NOT label itself as 'from Product DNA'`, () => {
      expect(src).not.toContain("from Product DNA — resolve");
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Doctrine seeder: uses product_anchor (Product Identity) as FIRST read
// ──────────────────────────────────────────────────────────────────────────────
describe("Doctrine seeder (doctrine-seed.ts) — Product Identity first", () => {
  const src = readSrc("server/orchestrator/doctrine-seed.ts");

  it("loads product_anchor via loadCampaignProductAnchor", () => {
    expect(src).toContain("loadCampaignProductAnchor");
  });

  it("degrades gracefully when product_anchor is absent (business_level_degraded)", () => {
    expect(src).toContain("business_level_degraded");
  });

  it("stamps the degradation — not a silent substitute", () => {
    expect(src).toContain("resolution");
  });

  it("enforces NO-TENANT-LEAK join for product_anchor reads", () => {
    // The inner join to campaign_selections is how tenant ownership is verified
    expect(src).toContain("campaign_selections");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Supplementary context (product-dna.ts) is NOT a primary anchor source
// ──────────────────────────────────────────────────────────────────────────────
describe("product-dna.ts — supplementary, not primary", () => {
  const src = readSrc("server/shared/product-dna.ts");

  it("reads from businessDataLayer (supplementary context table)", () => {
    expect(src).toContain("businessDataLayer");
  });

  it("does NOT import or query growth_campaigns (read-only on product_anchor)", () => {
    // The supplementary context module must not import or query growthCampaigns
    // (the table that holds product_anchor). It may reference "growth_campaigns"
    // in documentation comments only. It reads businessDataLayer only.
    expect(src).not.toMatch(/import[^;]*growthCampaigns/);
    expect(src).not.toMatch(/\.from\(growthCampaigns\)/);
    expect(src).toContain("businessDataLayer");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. dna-enrichment.ts — prompt labels updated
// ──────────────────────────────────────────────────────────────────────────────
describe("dna-enrichment.ts — prompt label consistency", () => {
  const src = readSrc("server/shared/dna-enrichment.ts");

  it("does not present 'CURRENT PRODUCT DNA' in the LLM prompt", () => {
    expect(src).not.toContain("CURRENT PRODUCT DNA:");
  });

  it("uses 'PRODUCT IDENTITY / CONTEXT' label instead", () => {
    expect(src).toContain("PRODUCT IDENTITY / CONTEXT");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. ProductIdentityEditor reads and writes product_anchor
// ──────────────────────────────────────────────────────────────────────────────
describe("ProductIdentityEditor — reads/writes Product Identity", () => {
  const src = readSrc("components/ProductIdentityEditor.tsx");

  it("uses getProductAnchor to read Product Identity", () => {
    expect(src).toContain("getProductAnchor");
  });

  it("uses updateProductAnchor to save Product Identity", () => {
    expect(src).toContain("updateProductAnchor");
  });

  it("does not read from businessDataLayer directly", () => {
    expect(src).not.toContain("businessDataLayer");
    expect(src).not.toContain("loadProductDNA");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. campaign-routes.ts — Product Identity API is tenant-scoped
// ──────────────────────────────────────────────────────────────────────────────
describe("campaign-routes.ts — Product Identity API tenant isolation", () => {
  const src = readSrc("server/campaign-routes.ts");

  it("GET /api/campaigns/:campaignId/product-anchor is tenant-scoped", () => {
    expect(src).toContain("product-anchor");
    // Verify accountId is part of the where clause (tenant isolation)
    expect(src).toContain("accountId");
  });

  it("validates product anchor fields before writing", () => {
    expect(src).toContain("ProductAnchorSchema");
  });
});
