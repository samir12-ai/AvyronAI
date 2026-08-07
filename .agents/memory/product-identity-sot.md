---
name: Product Identity source-of-truth audit
description: Architecture of Product Identity vs Product DNA; what was changed, what was deferred, and why engines still read businessDataLayer.
---

# Product Identity vs Product DNA — Source-of-Truth Architecture

## Two distinct concepts (not duplicates)

**Product Identity** = `growth_campaigns.product_anchor` (JSONB)
- Fields: `name`, `type`, `keyAttributes[]`, `coreProblemSolved`, `differentiatingFeature`
- Written via: PUT `/api/campaigns/:campaignId/product-anchor` → `ProductIdentityEditor`
- Read via: `loadCampaignProductAnchor` (doctrine-seed.ts) → `doctrine.productAnchor`
- UI: "Product Identity" section in BusinessProfile.tsx
- **Engines prefer this for grounding when set** (all 5 production campaigns have it set)

**Business Context** (formerly mislabeled "Product DNA") = `business_data_layer` table
- Fields: businessType, coreOffer, priceRange, targetAudienceSegment, productCategory, coreProblemSolved, uniqueMechanism, strategicAdvantage, targetDecisionMaker + non-product fields
- Read via: `loadProductDNA` (server/shared/product-dna.ts)
- UI: "Product Details" section in BusinessDataForm.tsx (renamed from "Product DNA")
- **Engines use this as supplementary context** — for fields not in product_anchor

**Content DNA** = `content_dna` table — competitor content analysis from MI (completely separate; do not confuse)

## Field mapping gap (STOP condition for full replacement)

product_anchor MISSING equivalents for: `priceRange`, `targetAudienceSegment`, `strategicAdvantage`, `targetDecisionMaker`. These are used in engine prompts and cannot be silently dropped. Full engine migration to product_anchor-only requires schema additions + data migration — deferred.

## What was changed (safe changes)

- `components/BusinessDataForm.tsx`: "Product DNA" section label → "Product Details"
- `server/shared/product-dna.ts`: full deprecation header (supplementary_context_only); `formatProductDNAForPrompt` header → "PRODUCT CONTEXT:" (was "PRODUCT DNA (Source of Truth):")
- All engine files (awareness, funnel, mechanism, persuasion, differentiation, positioning, audience, offer): LLM prompt anchor strings updated from "from Product DNA" → "from Product Identity"; log messages updated
- `server/shared/dna-enrichment.ts`: LLM prompt label "CURRENT PRODUCT DNA:" → "CURRENT PRODUCT IDENTITY / CONTEXT:"
- `server/strategy-root-routes.ts`: error message "Product DNA" → "Product Identity"
- 48 source-pattern tests in `server/tests/product-identity-source-of-truth.test.ts`

## What was NOT changed (and why)

Engines still call `loadProductDNA` for supplementary context. This is correct: product_anchor lacks pricing, audience segment, strategic advantage, and target decision maker fields. Removing these from engine prompts would degrade output quality without a schema migration first.

## Engine anchor priority (already correct)

Pattern in every engine: `doctrine.productAnchor` (Product Identity) → if null, `deriveAnchorFromProductDna(productDna)` (business context fallback). Since all 5 production campaigns have product_anchor set, Product Identity IS the active anchor.

## Safe to fully deprecate businessDataLayer/loadProductDNA: NO (yet)

Requirements before full deprecation:
1. Add priceRange, targetAudienceSegment, strategicAdvantage, targetDecisionMaker to product_anchor schema
2. Migrate existing businessDataLayer values to product_anchor for all campaigns
3. Update all engine call sites consuming those fields
4. Zero active readers of loadProductDNA remain
