export interface GovernedSignal {
  signalId: string;
  category: "pain" | "desire" | "objection" | "pattern" | "root_cause" | "psychological_driver";
  text: string;
  confidence: number;
  evidence: string[];
  sourceEngine: string;
  sourceLayer: string;
  traceId: string;
  consumedBy: string[];
}

export interface SignalCoverageReport {
  pains: number;
  desires: number;
  objections: number;
  patterns: number;
  rootCauses: number;
  psychologicalDrivers: number;
  totalSignals: number;
  coverageSufficient: boolean;
  missingCategories: string[];
}

export interface EngineSignalConsumption {
  engineId: string;
  signalsConsumed: string[];
  coverageReport: SignalCoverageReport;
  timestamp: string;
}

export interface SignalGovernanceState {
  initialized: boolean;
  sourceEngine: string;
  governedSignals: GovernedSignal[];
  coverageReport: SignalCoverageReport;
  consumptionLog: EngineSignalConsumption[];
  createdAt: string;
  traceToken: string;
}

export interface SignalResolution {
  signals: GovernedSignal[];
  coverage: SignalCoverageReport;
  traceToken: string;
  engineId: string;
}

export type EngineId =
  | "positioning"
  | "differentiation"
  | "mechanism"
  | "offer"
  | "funnel"
  | "awareness"
  | "persuasion";

export const ENGINE_SIGNAL_REQUIREMENTS: Record<EngineId, string[]> = {
  positioning: ["pain", "desire", "pattern", "root_cause", "psychological_driver"],
  differentiation: ["pain", "desire", "objection"],
  mechanism: ["pain", "desire", "root_cause"],
  offer: ["pain", "desire", "objection"],
  funnel: ["pain", "desire", "objection"],
  awareness: ["pain", "desire", "psychological_driver"],
  persuasion: ["pain", "desire", "objection", "root_cause", "psychological_driver"],
};
