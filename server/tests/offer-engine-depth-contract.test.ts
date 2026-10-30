import { describe, it, expect } from "vitest";
import { buildDeterministicOfferSkeletons } from "../offer-engine/engine";
import { enforceEngineDepthCompliance, isDepthBlocking } from "../causal-enforcement-layer/engine";
import { shouldBlockDownstream } from "../orchestrator/priority-matrix";
import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";

describe("Offer Engine Causal Depth and Contract Repair", () => {
  const mockAel: AnalyticalPackage = {
    timestamp: new Date().toISOString(),
    campaignId: "test_camp",
    version: "v2",
    isPartial: false,
    dominant_pain_theme: "market_tradeoffs",
    root_causes: [
      {
        id: "rc_1",
        surfaceSignal: "Difficulty finding modest summer dresses that are fashionable, high quality, and fairly priced",
        deepCause: "Mass-market fast fashion cuts costs on fabric weight and stitch density, making summer dresses sheer and flimsy",
        causalReasoning: "Retailers optimize for high-turnover margins, sacrificing opacity and structured tailoring",
        confidenceLevel: "high",
        sourceData: "Market research",
      },
    ],
    causal_chains: [
      {
        pain: "Difficulty finding modest summer dresses that are fashionable, high quality, and fairly priced",
        cause: "Fast-fashion brands reduce fabric density to cut shipping weight and raw material costs",
        impact: "Buyers receive sheer garments requiring extra under-layers, causing overheating in summer",
        behavior: "Buyers repeatedly return purchases or abandon carts due to sheer fabric disappointment",
        conversionEffect: "High cart abandonment due to opacity skepticism",
      },
    ],
    buying_barriers: [
      {
        barrier: "Opacity skepticism",
        rootCause: "Past disappointment with thin, transparent summer fabrics claiming to be modest",
        userThinking: "Will I need to wear a slip underneath this in 90-degree heat?",
        requiredResolution: "Verifiable fabric density specifications and non-sheer guarantees",
      },
    ],
    product_truth: {
      verified_capabilities: [
        "Curated catalog of 9 modest dress SKUs ($35 - $62)",
        "24-hour return and exchange pickup window upon delivery",
        "Multi-point quality inspection on seams, opacity, and finish prior to dispatch",
        "Worldwide express delivery within 3-5 business days",
      ],
      key_facts: [
        "Direct-to-consumer modest dress brand founded in 2024",
        "9 tailored versatile dress silhouettes",
      ],
      unverified_claims: [
        "100% natural organic mulberry silk",
        "Laboratory certified thermal cooling coefficient",
      ],
    },
  };

  const mockStrategyRoot = {
    primaryAxis: "curated_premium_architecture",
    contrastAxisText: "overwhelming mass catalog vs curated essential architecture",
    approvedTransformation: "Effortless summer confidence with breathable, fully opaque modest silhouettes",
    approvedMechanism: {
      mechanismName: "Curated Premium SKU Architecture",
      whyItWorks: "By engineering custom high-density weave fabric and curating a tight line of 9 silhouettes, we eliminate retail markups while ensuring total opacity without heat-trapping layers.",
      mechanismLogic: "Direct-to-consumer fabric development bypassing fast-fashion distribution margins",
      mechanismSteps: [
        "High-density opaque linen-cotton blend that breathes without layering",
        "9 essential versatile silhouettes covering all summer occasions",
        "Direct-to-consumer pricing with zero retail markup",
      ],
    },
    approvedAudiencePains: [
      {
        painId: "pain_1",
        canonical: "Difficulty finding modest summer dresses that are fashionable, high quality, and fairly priced",
      },
    ],
    approvedDesires: ["Effortless summer elegance", "Breathable comfort in heat"],
    approvedObjections: [
      "Are these dresses truly opaque without being heavy?",
      "Why is the price fair if the fabric is premium?",
    ],
    approvedProofTypes: ["fabric_weight_spec", "customer_transparency_reviews"],
    approvedLanes: [
      {
        laneId: "lane_everyday_modesty",
        title: "Everyday Modest Elegance",
        valueContext: "Daily wear seeking effortless modesty without overheating",
        painIds: ["pain_1"],
        desires: ["Effortless summer elegance"],
        objections: ["Are these dresses truly opaque without being heavy?"],
      },
    ],
  };

  const mockAudience = {
    audiencePains: ["Difficulty finding modest summer dresses that are fashionable, high quality, and fairly priced"],
    painRegistry: [
      {
        painId: "pain_1",
        canonical: "Difficulty finding modest summer dresses that are fashionable, high quality, and fairly priced",
      },
    ],
    desireMap: { "Effortless summer elegance": { label: "Effortless summer elegance" } },
    objectionMap: { "Are these dresses truly opaque without being heavy?": "Are these dresses truly opaque without being heavy?" },
  };

  const mockPositioning = {
    territories: [],
    primaryTerritory: { name: "Curated Modesty" },
  };

  const mockDifferentiation = {
    pillars: [],
    proofArchitecture: [
      { name: "High-density weave certification", assetType: "fabric_spec" },
    ],
    productTruthVerification: {
      verifiedFacts: [
        "Custom 220 GSM linen-cotton blend certified non-sheer under direct light",
        "9 tailored versatile dress silhouettes",
        "Direct-to-consumer pricing $35–$62",
      ],
    },
    mechanismCore: {
      mechanismType: "architecture",
      mechanismName: "Curated Premium SKU Architecture",
      mechanismSteps: [
        "High-density opaque linen-cotton blend that breathes without layering",
        "9 essential versatile silhouettes covering all summer occasions",
        "Direct-to-consumer pricing with zero retail markup",
      ],
    },
  };

  // 1. Causal root-cause extraction
  it("1. extracts causal root causes and deep causal chains into problemStatement", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      mockPositioning as any,
      mockDifferentiation as any,
      undefined,
      mockAel,
    );

    expect(skeletons.primary.problemStatement).toBeDefined();
    const prob = skeletons.primary.problemStatement.toLowerCase();
    expect(
      prob.includes("mass-market fast fashion cuts costs") ||
      prob.includes("fast-fashion brands reduce fabric density") ||
      prob.includes("cuts costs on fabric weight")
    ).toBe(true);
  });

  // 2. whyItWorks and mechanismLogic propagation
  it("2. propagates whyItWorks and mechanismLogic into primary mechanism description", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      mockPositioning as any,
      mockDifferentiation as any,
      undefined,
      mockAel,
    );

    expect(skeletons.primary.mechanism).toBeDefined();
    expect(skeletons.primary.mechanism).toContain("Curated Premium SKU Architecture");
    expect(skeletons.primary.mechanism).toContain(mockStrategyRoot.approvedMechanism.whyItWorks);
    expect(skeletons.primary.mechanism).toContain(mockStrategyRoot.approvedMechanism.mechanismLogic);
  });

  // 3. CEL causal-depth pass
  it("3. passes CEL causal-depth compliance with score >= 0.20 and non-blocking status", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      mockPositioning as any,
      mockDifferentiation as any,
      undefined,
      mockAel,
    );

    const skeletonTexts = [
      skeletons.primary.name,
      skeletons.primary.outcome,
      skeletons.primary.mechanism,
      skeletons.primary.problemStatement,
      ...skeletons.primary.objectionHandling,
      ...skeletons.primary.deliverables,
    ].filter(Boolean);

    const depthResult = enforceEngineDepthCompliance("offer", skeletonTexts, mockAel);
    expect(depthResult.causalDepthScore).toBeGreaterThanOrEqual(0.20);
    expect(depthResult.depthDiagnostics.hasRootCauseGrounding).toBe(true);
    expect(depthResult.depthDiagnostics.hasCausalChainUsage).toBe(true);
    expect(isDepthBlocking(depthResult, skeletonTexts)).toBe(false);
  });

  // 4. Product Truth factual boundaries
  it("4. grounds deliverables in Product Truth verified capabilities and pricing", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      mockPositioning as any,
      mockDifferentiation as any,
      undefined,
      mockAel,
    );

    expect(skeletons.primary.deliverables.length).toBeGreaterThan(0);
    const delivText = skeletons.primary.deliverables.join(" ");
    expect(delivText).toContain("9 modest dress SKUs");
    expect(delivText).toContain("$35 - $62");
    expect(delivText).toContain("24-hour return and exchange");
  });

  // 5. Pain-inversion rejection
  it("5. rejects pain inversion: never asserts unverified audience desires as product facts", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      mockPositioning as any,
      mockDifferentiation as any,
      undefined,
      mockAel,
    );

    const fullOfferText = [
      skeletons.primary.name,
      skeletons.primary.outcome,
      skeletons.primary.mechanism,
      skeletons.primary.problemStatement,
      ...skeletons.primary.objectionHandling,
      ...skeletons.primary.deliverables,
    ].join(" ");

    expect(fullOfferText).not.toContain("100% natural organic mulberry silk");
    expect(fullOfferText).not.toContain("certified thermal cooling coefficient");
  });

  // 6. Canonical objection coverage
  it("6. guarantees canonical objection coverage with valid status tags", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      mockPositioning as any,
      mockDifferentiation as any,
      undefined,
      mockAel,
    );

    expect(skeletons.primary.objectionHandling.length).toBeGreaterThanOrEqual(2);
    for (const objLine of skeletons.primary.objectionHandling) {
      expect(objLine).toMatch(/^\[(ADDRESSED|PROPOSED|UNADDRESSED|PARTIALLY_MITIGATED|UNRESOLVED|UNSUPPORTED)\] Addresses: /);
    }

    const allObjText = skeletons.primary.objectionHandling.join(" ");
    expect(allObjText).toContain("Are these dresses truly opaque without being heavy?");
    expect(allObjText).toContain("Why is the price fair if the fabric is premium?");
  });

  // 7. Failed-candidate preservation
  it("7. preserves rejected candidate with structural rejectionReason contrasting against root axis", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot,
      mockAudience as any,
      mockPositioning as any,
      mockDifferentiation as any,
      undefined,
      mockAel,
    );

    expect(skeletons.rejected).toBeDefined();
    expect(skeletons.rejected.rejectionReason).toBeDefined();
    expect(skeletons.rejected.rejectionReason.length).toBeGreaterThan(20);
    expect(skeletons.rejected.rejectionReason).toContain("Curated Premium SKU Architecture");
  });

  // 8. Truthful DEPTH_FAILED -> BLOCKED orchestration
  it("8. treats DEPTH_FAILED and AUDIENCE_MISALIGNMENT as blocking results in orchestration", () => {
    const depthFailedResult = {
      engineId: "offer",
      status: "BLOCKED" as const,
      output: { status: "DEPTH_FAILED", statusMessage: "Depth gate failed after 2 attempts: depthScore=0.10" },
      durationMs: 120,
      error: "Depth gate failed after 2 attempts",
      blockReason: "Depth gate failed after 2 attempts",
    };
    expect(shouldBlockDownstream(depthFailedResult)).toBe(true);

    const misalignedResult = {
      engineId: "offer",
      status: "BLOCKED" as const,
      output: { status: "AUDIENCE_MISALIGNMENT", statusMessage: "Offer outcome does not reference identified audience pain points" },
      durationMs: 110,
      error: "Offer outcome does not reference identified audience pain points",
      blockReason: "Offer outcome does not reference identified audience pain points",
    };
    expect(shouldBlockDownstream(misalignedResult)).toBe(true);
  });

  // 9. Downstream halt after Offer failure
  it("9. shouldBlockDownstream enforces halting downstream engines when Offer fails or blocks", () => {
    const statuses = ["BLOCKED", "FAILED", "ERROR", "SIGNAL_BLOCKED", "DEPTH_BLOCKED", "CONTRACT_INCOMPLETE"];
    for (const status of statuses) {
      const stepResult = {
        engineId: "offer",
        status: status as any,
        output: null,
        durationMs: 50,
        blockReason: "Engine halted",
      };
      expect(shouldBlockDownstream(stepResult)).toBe(true);
    }
  });

  // 10. Tenant neutrality
  it("10. operates tenant-neutrally across non-fashion B2B enterprise domains without hardcoded brand tokens", () => {
    const b2bAel: AnalyticalPackage = {
      timestamp: new Date().toISOString(),
      campaignId: "camp_enterprise_cyber",
      version: "v2",
      isPartial: false,
      dominant_pain_theme: "regulatory_compliance_overload",
      root_causes: [
        {
          id: "rc_cyber_1",
          surfaceSignal: "High incident response times during ransomware alerts",
          deepCause: "Legacy SIEM platforms flood analysts with 10,000+ daily raw syslog events without behavioral context",
          causalReasoning: "Alert fatigue leads security operations to deprioritize legitimate intrusions",
          confidenceLevel: "high",
          sourceData: "SOC telemetry",
        },
      ],
      causal_chains: [
        {
          pain: "High incident response times during ransomware alerts",
          cause: "Legacy SIEM platforms flood analysts with 10,000+ daily raw syslog events without behavioral context",
          impact: "Dwell time increases to 28 days before anomalous lateral movement is detected",
          behavior: "Security analysts suffer alert fatigue and triage only tier-1 obvious alerts",
          conversionEffect: "CISO budget freeze on point security tools due to lack of measurable ROI",
        },
      ],
      buying_barriers: [
        {
          barrier: "Agent deployment resistance",
          rootCause: "Past kernel panic incidents caused by heavyweight endpoint monitoring agents",
          userThinking: "Will this agent destabilize our production Kubernetes clusters?",
          requiredResolution: "eBPF-based kernel-safe telemetry with zero daemon downtime guarantee",
        },
      ],
      product_truth: {
        verified_capabilities: [
          "Zero-overhead eBPF kernel telemetry engine",
          "Automated blast-radius isolation within 350 milliseconds",
          "SOC 2 Type II certified with 99.99% uptime SLA",
        ],
        key_facts: [
          "B2B cloud infrastructure security platform",
          "Supports Linux kernel 5.4+",
        ],
      },
    };

    const b2bStrategyRoot = {
      primaryAxis: "ebpf_autonomous_containment",
      contrastAxisText: "noisy signature-based alerts vs autonomous kernel containment",
      approvedTransformation: "Sub-second lateral breach containment without analyst alert fatigue",
      approvedMechanism: {
        mechanismName: "Autonomous eBPF Telemetry Fabric",
        whyItWorks: "By hooking Linux kernel tracepoints directly via eBPF without user-space context switching, anomalies are isolated in-memory before malicious payloads write to disk.",
        mechanismLogic: "Kernel-native event streaming bypassing user-space logging bottlenecks",
        mechanismSteps: [
          "Deploy zero-privilege eBPF probes into host kernel space",
          "Synthesize behavioral graph with streaming causal inference",
          "Enforce cryptographic process containment on anomalous syscall sequences",
        ],
      },
      approvedAudiencePains: [
        {
          painId: "pain_cyber_1",
          canonical: "High incident response times during ransomware alerts",
        },
      ],
      approvedDesires: ["Sub-second breach containment", "Zero false-positive alert fatigue"],
      approvedObjections: [
        "Will this agent destabilize our production Kubernetes clusters?",
      ],
      approvedProofTypes: ["kernel_benchmark_spec", "third_party_audit"],
      approvedLanes: [],
    };

    const b2bAudience = {
      audiencePains: ["High incident response times during ransomware alerts"],
      painRegistry: [
        {
          painId: "pain_cyber_1",
          canonical: "High incident response times during ransomware alerts",
        },
      ],
      desireMap: { "Sub-second breach containment": { label: "Sub-second breach containment" } },
      objectionMap: { "Will this agent destabilize our production Kubernetes clusters?": "Will this agent destabilize our production Kubernetes clusters?" },
    };

    const b2bPositioning = {
      territories: [],
      primaryTerritory: { name: "Autonomous Kernel Security" },
    };

    const b2bDifferentiation = {
      pillars: [],
      proofArchitecture: [],
      productTruthVerification: {
        verifiedFacts: [
          "Zero-overhead eBPF kernel telemetry engine",
          "Automated blast-radius isolation within 350 milliseconds",
        ],
      },
      mechanismCore: {
        mechanismType: "architecture",
        mechanismName: "Autonomous eBPF Telemetry Fabric",
        mechanismSteps: [
          "Deploy zero-privilege eBPF probes into host kernel space",
          "Synthesize behavioral graph with streaming causal inference",
          "Enforce cryptographic process containment on anomalous syscall sequences",
        ],
      },
    };

    const b2bSkeletons = buildDeterministicOfferSkeletons(
      b2bStrategyRoot,
      b2bAudience as any,
      b2bPositioning as any,
      b2bDifferentiation as any,
      undefined,
      b2bAel,
    );

    expect(b2bSkeletons.primary.name).toBeDefined();
    expect(b2bSkeletons.primary.name).toContain("High incident response times");
    expect(b2bSkeletons.primary.mechanism).toContain("Autonomous eBPF Telemetry Fabric");
    expect(b2bSkeletons.primary.mechanism).toContain("context switching");
    expect(b2bSkeletons.primary.problemStatement).toContain("Legacy SIEM platforms flood analysts");
    expect(b2bSkeletons.primary.deliverables.join(" ")).toContain("Zero-overhead eBPF");
    expect(b2bSkeletons.primary.objectionHandling[0]).toContain("destabilize our production Kubernetes clusters");

    const b2bText = JSON.stringify(b2bSkeletons).toLowerCase();
    expect(b2bText).not.toMatch(/\bdresses?\b/);
    expect(b2bText).not.toContain("sara");
    expect(b2bText).not.toContain("modest");
    expect(b2bText).not.toContain("opacity");

    const b2bTexts = [
      b2bSkeletons.primary.name,
      b2bSkeletons.primary.outcome,
      b2bSkeletons.primary.mechanism,
      b2bSkeletons.primary.problemStatement,
      ...b2bSkeletons.primary.objectionHandling,
      ...b2bSkeletons.primary.deliverables,
    ].filter(Boolean);

    const b2bDepthResult = enforceEngineDepthCompliance("offer", b2bTexts, b2bAel);
    expect(b2bDepthResult.causalDepthScore).toBeGreaterThanOrEqual(0.20);
    expect(isDepthBlocking(b2bDepthResult, b2bTexts)).toBe(false);
  });
});
