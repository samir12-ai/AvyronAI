import { describe, it, expect } from "vitest";
import { deriveAnchorFromProductDna, ProductAnchorSchema, computeAnchorHash } from "../shared/strategic-doctrine";
import { classifyAudiencePainDetailed } from "../shared/audience-pain-registry";

describe("Product / Service Canonical Semantics & Product Anchor", () => {
  it("1. Product fields derive with correct PRODUCT semantics and sourceFacts", () => {
    const dna = {
      businessModel: "product",
      heroProduct: "Smart Watch Ultra",
      productSpecs: "AMOLED 1.4 inch, 48hr battery, Titanium Case",
      endConsumerUseCase: "Triathlon training and recovery monitoring",
      replacedCompetitor: "Garmin Fenix 7",
      productCategory: "Wearable Tech",
      businessType: "Consumer Electronics Brand",
    };

    const anchor = deriveAnchorFromProductDna(dna as any);
    expect(anchor).not.toBeNull();
    expect(anchor?.name).toBe("Smart Watch Ultra");
    expect(anchor?.offeringType).toBe("product");
    expect(anchor?.productSpecs).toEqual(["AMOLED 1.4 inch, 48hr battery, Titanium Case"]);
    expect(anchor?.customerUseCases).toEqual(["Triathlon training and recovery monitoring"]);
    expect(anchor?.alternativeReplaced).toBe("Garmin Fenix 7");

    // Must NOT fabricate service fields
    expect(anchor?.problemSolved).toBeUndefined();
    expect(anchor?.uniqueMechanism).toBeUndefined();
    expect(anchor?.strategicAdvantage).toBeUndefined();

    // SourceFacts must retain provenance
    const specsFact = anchor?.sourceFacts?.find(f => f.type === "PRODUCT_SPEC");
    expect(specsFact).toBeDefined();
    expect(specsFact?.source).toBe("business_data_layer.productSpecs");
    expect(specsFact?.provenance).toBe("USER_PROVIDED");
  });

  it("2. Service fields derive with correct SERVICE semantics and sourceFacts", () => {
    const dna = {
      businessModel: "service",
      coreOffer: "Enterprise Cloud Migration",
      uniqueMechanism: "Automated Zero-Downtime Pipeline",
      coreProblemSolved: "Legacy infrastructure migration failures and outages",
      strategicAdvantage: "100% SLA uptime guarantee backed by insurance",
      productCategory: "IT Consulting",
      businessType: "B2B Tech Services",
    };

    const anchor = deriveAnchorFromProductDna(dna as any);
    expect(anchor).not.toBeNull();
    expect(anchor?.name).toBe("Enterprise Cloud Migration");
    expect(anchor?.offeringType).toBe("service");
    expect(anchor?.problemSolved).toBe("Legacy infrastructure migration failures and outages");
    expect(anchor?.uniqueMechanism).toBe("Automated Zero-Downtime Pipeline");
    expect(anchor?.strategicAdvantage).toBe("100% SLA uptime guarantee backed by insurance");

    // Must NOT fabricate product specs
    expect(anchor?.productSpecs).toBeUndefined();
    expect(anchor?.customerUseCases).toBeUndefined();
    expect(anchor?.alternativeReplaced).toBeUndefined();

    // Provenance
    const mechFact = anchor?.sourceFacts?.find(f => f.type === "DELIVERY_MECHANISM");
    expect(mechFact?.source).toBe("business_data_layer.uniqueMechanism");
  });

  it("3. Mixed business retains both product and service facts independently", () => {
    const dna = {
      businessModel: "mixed",
      heroProduct: "Surgical Implants",
      productSpecs: "Medical grade titanium Grade 5",
      endConsumerUseCase: "Joint replacement surgery",
      coreOffer: "Hospital Consignment Supply & Rapid Sterilization Service",
      uniqueMechanism: "Direct-to-OR 2-hour courier protocol",
      coreProblemSolved: "Surgeons running out of critical sizes during emergency operations",
      strategicAdvantage: "On-demand consignment cabinet at clinic",
      productCategory: "Medical Devices & Logistics",
      businessType: "B2B Medical Supplier",
    };

    const anchor = deriveAnchorFromProductDna(dna as any);
    expect(anchor).not.toBeNull();
    expect(anchor?.offeringType).toBe("mixed");
    expect(anchor?.productSpecs).toEqual(["Medical grade titanium Grade 5"]);
    expect(anchor?.uniqueMechanism).toBe("Direct-to-OR 2-hour courier protocol");
    expect(anchor?.problemSolved).toBe("Surgeons running out of critical sizes during emergency operations");

    // Both facts exist in sourceFacts without overwriting each other
    expect(anchor?.sourceFacts?.some(f => f.type === "PRODUCT_SPEC")).toBe(true);
    expect(anchor?.sourceFacts?.some(f => f.type === "DELIVERY_MECHANISM")).toBe(true);
  });

  it("4. productSpecs does NOT automatically become uniqueMechanism", () => {
    const dna = {
      businessModel: "product",
      heroProduct: "Organic Green Tea",
      productSpecs: "100% shade-grown matcha leaves from Kyoto",
      productCategory: "Beverage",
      businessType: "E-commerce",
      endConsumerUseCase: "Daily energy and focus without jitters",
    };

    const anchor = deriveAnchorFromProductDna(dna as any);
    expect(anchor?.uniqueMechanism).toBeUndefined();
    expect(anchor?.productSpecs).toEqual(["100% shade-grown matcha leaves from Kyoto"]);
  });

  it("5. endConsumerUseCase does NOT become problemSolved automatically", () => {
    const dna = {
      businessModel: "product",
      heroProduct: "Running Shoes",
      productSpecs: "Carbon plate foam",
      endConsumerUseCase: "Marathon racing",
      productCategory: "Sporting Goods",
      businessType: "Retail",
    };

    const anchor = deriveAnchorFromProductDna(dna as any);
    expect(anchor?.problemSolved).toBeUndefined();
    expect(anchor?.customerUseCases).toEqual(["Marathon racing"]);
  });

  it("6. replacedCompetitor does NOT become strategicAdvantage automatically", () => {
    const dna = {
      businessModel: "product",
      heroProduct: "Custom CRM",
      productSpecs: "Offline SQLite sync",
      replacedCompetitor: "Salesforce Enterprise",
      productCategory: "Software",
      businessType: "SaaS",
      endConsumerUseCase: "Managing sales pipelines offline",
    };

    const anchor = deriveAnchorFromProductDna(dna as any);
    expect(anchor?.strategicAdvantage).toBeUndefined();
    expect(anchor?.alternativeReplaced).toBe("Salesforce Enterprise");
  });

  it("7. ProductAnchorSchema strictly validates the extended structured shape", () => {
    const validAnchor = {
      name: "Peptide Supply",
      type: "Wholesale Supplier",
      offeringType: "product",
      keyAttributes: ["Physical Product"],
      coreProblemSolved: "Procurement buyers struggle with reliable supply",
      differentiatingFeature: "Batch certified purity",
      productSpecs: ["99% purity HPLC tested"],
      customerUseCases: ["Clinical research protocols"],
      sourceFacts: [
        {
          fact: "99% purity HPLC tested",
          type: "PRODUCT_SPEC",
          source: "business_data_layer.productSpecs",
          provenance: "USER_PROVIDED",
        },
      ],
    };

    const parsed = ProductAnchorSchema.safeParse(validAnchor);
    expect(parsed.success).toBe(true);
  });

  it("8. Deterministic pain classification preserves post-purchase guards", () => {
    const refundPain = classifyAudiencePainDetailed("Customer asking for refund due to defective delivery");
    expect(refundPain.classification).toBe("POST_PURCHASE_FRICTION");

    const purchasePain = classifyAudiencePainDetailed("Struggle to find reliable supplier with stock in UAE");
    expect(purchasePain.classification).toBe("CORE_PURCHASE");
  });
});
