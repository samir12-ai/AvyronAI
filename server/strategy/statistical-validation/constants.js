export const ENGINE_VERSION = 4;
export const SIGNAL_EQUIVALENCE_MAP = {
    offer_outcome: {
        canonicalClusters: ["audience_pain", "audience_desire", "market_opportunity"],
        traceOrigin: "offer",
    },
    offer_mechanism: {
        canonicalClusters: ["market_opportunity", "audience_pain"],
        traceOrigin: "offer",
    },
    offer_proof: {
        canonicalClusters: ["emotional_driver", "audience_pain", "audience_objection"],
        traceOrigin: "offer",
    },
    offer_proof_transparency: {
        canonicalClusters: ["audience_objection", "emotional_driver", "audience_pain"],
        traceOrigin: "offer",
    },
    offer_proof_outcome: {
        canonicalClusters: ["audience_desire", "audience_pain", "market_opportunity"],
        traceOrigin: "offer",
    },
    offer_proof_process: {
        canonicalClusters: ["audience_objection", "audience_pain", "emotional_driver"],
        traceOrigin: "offer",
    },
    persuasion_driver: {
        canonicalClusters: ["emotional_driver", "audience_pain", "audience_desire"],
        traceOrigin: "persuasion",
    },
    persuasion_driver_education: {
        canonicalClusters: ["audience_pain", "emotional_driver", "market_opportunity"],
        traceOrigin: "persuasion",
    },
    persuasion_driver_diagnosis: {
        canonicalClusters: ["audience_pain", "audience_objection", "emotional_driver"],
        traceOrigin: "persuasion",
    },
    persuasion_driver_authority: {
        canonicalClusters: ["emotional_driver", "audience_objection", "market_opportunity"],
        traceOrigin: "persuasion",
    },
    awareness_trigger: {
        canonicalClusters: ["market_opportunity", "audience_pain"],
        traceOrigin: "awareness",
    },
    awareness_trigger_trust_breakdown: {
        canonicalClusters: ["audience_objection", "emotional_driver", "audience_pain"],
        traceOrigin: "awareness",
    },
    awareness_trigger_cost_resistance: {
        canonicalClusters: ["audience_objection", "audience_pain", "market_threat"],
        traceOrigin: "awareness",
    },
    awareness_trigger_feasibility_doubt: {
        canonicalClusters: ["audience_objection", "audience_pain", "market_threat"],
        traceOrigin: "awareness",
    },
    awareness_entry: {
        canonicalClusters: ["audience_desire", "market_opportunity"],
        traceOrigin: "awareness",
    },
    awareness_entry_education: {
        canonicalClusters: ["audience_pain", "market_opportunity", "emotional_driver"],
        traceOrigin: "awareness",
    },
    awareness_entry_proof_supported: {
        canonicalClusters: ["audience_objection", "emotional_driver", "audience_desire"],
        traceOrigin: "awareness",
    },
    awareness_entry_authority: {
        canonicalClusters: ["emotional_driver", "market_opportunity", "audience_desire"],
        traceOrigin: "awareness",
    },
};
export const CANONICAL_SIGNAL_REGISTRY = {
    transparency_proof: {
        clusterId: "offer_proof_transparency",
        signalDefinition: "Proof elements demonstrating pricing clarity, refund policy visibility, and operational transparency",
        inputCriteria: ["pricing_visible", "refund_policy_stated", "no_hidden_fees", "process_visibility"],
        mappingKeywords: ["transparent", "clarity", "visible", "refund", "pricing", "hidden", "honest", "open", "trust", "reveal", "disclose"],
        parentCategory: "offer_proof",
    },
    outcome_proof: {
        clusterId: "offer_proof_outcome",
        signalDefinition: "Proof elements demonstrating measurable results, before/after transformations, and ROI evidence",
        inputCriteria: ["measurable_result", "before_after_comparison", "roi_demonstration", "case_study"],
        mappingKeywords: ["result", "outcome", "measurable", "before", "after", "roi", "return", "deliver", "achieve", "proof", "evidence", "data", "numbers"],
        parentCategory: "offer_proof",
    },
    process_proof: {
        clusterId: "offer_proof_process",
        signalDefinition: "Proof elements demonstrating clear methodology, systematic approach, and step-by-step clarity",
        inputCriteria: ["methodology_defined", "steps_documented", "system_clarity", "repeatable_process"],
        mappingKeywords: ["process", "method", "approach", "step", "system", "framework", "methodology", "structure", "blueprint", "roadmap", "plan"],
        parentCategory: "offer_proof",
    },
    education_driver: {
        clusterId: "persuasion_driver_education",
        signalDefinition: "Persuasion driver leveraging knowledge gaps — educating the audience to create awareness and understanding",
        inputCriteria: ["knowledge_gap_identified", "learning_need_present", "information_asymmetry"],
        mappingKeywords: ["education", "learn", "understand", "knowledge", "teach", "inform", "awareness", "insight", "discover", "realize", "gap"],
        parentCategory: "persuasion_driver",
    },
    diagnosis_driver: {
        clusterId: "persuasion_driver_diagnosis",
        signalDefinition: "Persuasion driver leveraging problem-awareness — diagnosing audience pain to create urgency",
        inputCriteria: ["problem_identified", "pain_quantified", "symptom_recognized", "diagnosis_needed"],
        mappingKeywords: ["diagnose", "diagnosis", "problem", "issue", "symptom", "identify", "assess", "evaluate", "analyze", "root cause", "pain"],
        parentCategory: "persuasion_driver",
    },
    authority_driver: {
        clusterId: "persuasion_driver_authority",
        signalDefinition: "Persuasion driver leveraging credibility and expertise markers to establish trust",
        inputCriteria: ["expertise_demonstrated", "credibility_markers", "trust_signals", "authority_evidence"],
        mappingKeywords: ["authority", "expert", "credible", "trust", "reputation", "credential", "proven", "established", "leader", "specialist", "experience"],
        parentCategory: "persuasion_driver",
    },
    trust_breakdown_trigger: {
        clusterId: "awareness_trigger_trust_breakdown",
        signalDefinition: "Awareness trigger driven by audience skepticism, negative sentiment, or broken trust signals",
        inputCriteria: ["skepticism_detected", "negative_sentiment", "trust_deficit", "prior_negative_experience"],
        mappingKeywords: ["trust", "skeptic", "doubt", "distrust", "scam", "fake", "lie", "broken", "betrayed", "suspicious", "credibility"],
        parentCategory: "awareness_trigger",
    },
    cost_resistance_trigger: {
        clusterId: "awareness_trigger_cost_resistance",
        signalDefinition: "Awareness trigger driven by price sensitivity and perceived value gap",
        inputCriteria: ["price_sensitivity_high", "value_perception_low", "budget_constraint"],
        mappingKeywords: ["cost", "price", "expensive", "afford", "budget", "value", "worth", "cheap", "investment", "money"],
        parentCategory: "awareness_trigger",
    },
    feasibility_doubt_trigger: {
        clusterId: "awareness_trigger_feasibility_doubt",
        signalDefinition: "Awareness trigger driven by perceived complexity or difficulty",
        inputCriteria: ["complexity_perceived", "difficulty_barrier", "technical_intimidation"],
        mappingKeywords: ["complex", "difficult", "hard", "complicated", "impossible", "overwhelm", "confuse", "technical", "feasible", "capability"],
        parentCategory: "awareness_trigger",
    },
    education_entry: {
        clusterId: "awareness_entry_education",
        signalDefinition: "Entry mechanism using education to bridge knowledge gaps and build problem awareness",
        inputCriteria: ["knowledge_gap_present", "audience_receptive_to_learning"],
        mappingKeywords: ["education", "learn", "guide", "tutorial", "workshop", "webinar", "course", "training", "teach"],
        parentCategory: "awareness_entry",
    },
    proof_supported_entry: {
        clusterId: "awareness_entry_proof_supported",
        signalDefinition: "Entry mechanism using proof and evidence to overcome skepticism barriers",
        inputCriteria: ["proof_available", "skepticism_barrier_present", "evidence_needed"],
        mappingKeywords: ["proof", "evidence", "case study", "testimonial", "result", "demo", "trial", "sample", "audit"],
        parentCategory: "awareness_entry",
    },
    authority_entry: {
        clusterId: "awareness_entry_authority",
        signalDefinition: "Entry mechanism leveraging authority positioning to establish immediate credibility",
        inputCriteria: ["authority_positioning_available", "credibility_transfer_possible"],
        mappingKeywords: ["authority", "expert", "leader", "credential", "endorsement", "partnership", "reputation"],
        parentCategory: "awareness_entry",
    },
};
export const SIGNAL_MAPPING_CONFIDENCE_THRESHOLD = 0.75;
export const PROOF_TYPE_CLASSIFIERS = {
    transparency: /\b(transparen|clarity|visible|refund|pricing|hidden|honest|open|trust|reveal|disclose|upfront|clear cost|no surprise)\b/i,
    outcome: /\b(result|outcome|measurable|before.?after|roi|return|deliver|achieve|proof|evidence|data|numbers|performance|growth|increase|improve)\b/i,
    process: /\b(process|method|approach|step|system|framework|methodology|structure|blueprint|roadmap|plan|how.?to|sequence|workflow)\b/i,
};
export const PERSUASION_DRIVER_CLASSIFIERS = {
    education: /\b(educat|learn|understand|knowledge|teach|inform|awareness|insight|discover|realize|gap|illuminate|explain)\b/i,
    diagnosis: /\b(diagnos|problem|issue|symptom|identify|assess|evaluat|analyz|root.?cause|pain|audit|check)\b/i,
    authority: /\b(authorit|expert|credib|trust|reputation|credential|proven|established|leader|specialist|experience|endorse)\b/i,
};
export const AWARENESS_TRIGGER_CLASSIFIERS = {
    trust_breakdown: /\b(trust|skeptic|doubt|distrust|scam|fake|lie|broken|betray|suspicious|credibility|fear)\b/i,
    cost_resistance: /\b(cost|price|expensive|afford|budget|value|worth|cheap|investment|money|fee)\b/i,
    feasibility_doubt: /\b(complex|difficult|hard|complicated|impossible|overwhelm|confus|technical|feasib|capabil)\b/i,
};
export const AWARENESS_ENTRY_CLASSIFIERS = {
    education: /\b(educat|learn|guide|tutorial|workshop|webinar|course|training|teach|content.?education)\b/i,
    proof_supported: /\b(proof|evidence|case.?study|testimonial|result|demo|trial|sample|audit|proof.?led)\b/i,
    authority: /\b(authorit|expert|leader|credential|endorse|partnership|reputation|thought.?leader)\b/i,
};
export const STATUS = {
    COMPLETE: "COMPLETE",
    MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
    INTEGRITY_FAILED: "INTEGRITY_FAILED",
};
export const LAYER_NAMES = [
    "evidence_density_assessment",
    "claim_signal_alignment",
    "narrative_vs_signal_check",
    "assumption_detection",
    "cross_engine_consistency",
    "proof_strength_validation",
    "confidence_calibration",
];
export const LAYER_WEIGHTS = {
    evidence_density_assessment: 0.20,
    claim_signal_alignment: 0.20,
    narrative_vs_signal_check: 0.15,
    assumption_detection: 0.15,
    cross_engine_consistency: 0.10,
    proof_strength_validation: 0.10,
    confidence_calibration: 0.10,
};
export const NARRATIVE_CLAIM_PATTERNS = [
    "our audience wants",
    "the market needs",
    "competitors are failing",
    "this will work because",
    "everyone knows",
    "it's obvious that",
    "clearly the best",
    "guaranteed results",
    "proven to work",
    "industry standard",
];
export const ASSUMPTION_INDICATORS = [
    "we believe",
    "we assume",
    "it seems like",
    "probably",
    "most likely",
    "should work",
    "might be",
    "could be",
    "we think",
    "presumably",
    "in our experience",
    "typically",
    "generally speaking",
    "we expect",
];
export const EVIDENCE_TYPES = [
    "market_signal",
    "competitor_data",
    "audience_feedback",
    "performance_metric",
    "proof_element",
    "objection_data",
];
export const VALIDATION_STATES = {
    VALIDATED: "validated",
    PROVISIONAL: "provisional",
    WEAK: "weak",
    REJECTED: "rejected",
};
export const BOUNDARY_HARD_PATTERNS = {
    "marketing copy": /\b(marketing copy|ad copy|sales copy|copywriting)\b/i,
    "ad creatives": /\b(ad creative|creative asset|banner design)\b/i,
    "content calendar": /\b(content calendar|editorial calendar|posting schedule)\b/i,
    "media plans": /\b(media plan|media planning|media buy)\b/i,
    "execution tasks": /\b(execution task|deployment plan|launch sequence)\b/i,
};
export const BOUNDARY_SOFT_PATTERNS = [
    { pattern: /\b(guaranteed|guarantee)\b/gi, domain: "guarantee", replacement: "evidence-supported expectation" },
    { pattern: /\b(proven formula)\b/gi, domain: "proven formula", replacement: "signal-validated approach" },
    { pattern: /\b(best practice)\b/gi, domain: "best practice", replacement: "evidence-based pattern" },
];
export const EVIDENCE_DENSITY_THRESHOLDS = {
    STRONG: 0.7,
    MODERATE: 0.4,
    WEAK: 0.2,
};
export const CLAIM_CONFIDENCE_THRESHOLDS = {
    VALIDATED: 0.7,
    PROVISIONAL: 0.5,
    WEAK: 0.3,
};
export const SIGNAL_GROUNDING_THRESHOLD = 0.75;
