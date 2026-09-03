/**
 * Business Language Layer (BLL) Presentation Translators
 * 
 * Cleanly translates internal engine terminology and enums into 
 * professional, business-friendly English for the executive reader.
 * Pure translation only — does not modify underlying strategic facts.
 */

export function translateJourneyType(rawType: string | undefined | null): string {
  if (!rawType) return "Strategic Conversion Path";
  const norm = rawType.toLowerCase().replace(/[-_\s]+/g, "_");
  
  const map: Record<string, string> = {
    consultative_b2b: "Consultative B2B",
    product_led: "Product-Led Inbound",
    product_led_inbound: "Product-Led Inbound",
    education_led: "Education-Led Conversion",
    proof_led: "Proof-Led Decision Acceleration",
    proof_led_conversion: "Proof-Led Decision Acceleration",
    high_touch_enterprise: "High-Touch Enterprise",
    standard: "Strategic Conversion Flow",
    b2b_saas: "B2B SaaS Conversion",
    direct_response: "Direct Response Flow",
  };

  return map[norm] || rawType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function translatePersuasionPrinciple(rawPrinciple: string | undefined | null): string {
  if (!rawPrinciple) return "Evidence-Backed Authority";
  const norm = rawPrinciple.toLowerCase().replace(/[-_\s]+/g, "_");

  const map: Record<string, string> = {
    authority: "Evidence-Backed Authority",
    social_proof: "Verified Peer Validation",
    social_proof_reciprocity: "Peer Validation & High-Value Demonstration",
    reciprocity: "Value-First Demonstration",
    commitment_consistency: "Progressive Commitment Flow",
    scarcity: "Priority Capacity Access",
    liking: "Shared Mission Alignment",
    authority_social_proof: "Verified Authority & Peer Validation",
  };

  return map[norm] || rawPrinciple.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function translateEntryTrigger(rawTrigger: string | undefined | null): string {
  if (!rawTrigger) return "Start With Evidence";
  const norm = rawTrigger.toLowerCase().replace(/[-_\s]+/g, "_");

  const map: Record<string, string> = {
    proof_led_entry: "Start With Proof",
    primary_problem_agitation: "Primary Problem Agitation",
    diagnostic_assessment: "Diagnostic Audit",
    interactive_demo: "Interactive Demonstration",
    case_study_benchmark: "Verified Case Benchmark",
    expert_narrative: "Expert Strategic Insight",
  };

  return map[norm] || rawTrigger.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function translateMessageStepLabel(rawLabel: string | undefined | null, idx: number): string {
  if (!rawLabel) return `Step ${idx + 1}`;
  const norm = rawLabel.toLowerCase().replace(/[-_\s]+/g, "_");

  const map: Record<string, string> = {
    disrupt_belief: "Challenge the Current Assumption",
    break_old_model: "Expose Why Existing Approaches Fail",
    introduce_mechanism: "Introduce the Core Mechanism",
    demonstrate_contrast: "Demonstrate the Strategic Difference",
    prove_efficacy: "Provide Verifiable Proof",
    neutralize_objections: "Pre-empt Key Commercial Objections",
    invite_commitment: "Invite Action & Next Steps",
    expose_drift: "Expose Hidden Operational Decay",
    show_speed: "Demonstrate Rapid Value",
  };

  return map[norm] || rawLabel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
