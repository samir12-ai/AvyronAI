export interface MechanismEnginePositioningInput {
  contrastAxis: string | null;
  enemyDefinition: string | null;
  narrativeDirection: string | null;
  differentiationVector: string[];
  territories: any[];
}

export interface MechanismEngineDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  mechanismCore: {
    mechanismName: string;
    mechanismType: string;
    mechanismSteps: string[];
    mechanismPromise: string;
    mechanismProblem: string;
    mechanismLogic: string;
  } | null;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
}

export interface MechanismOutput {
  mechanismName: string;
  mechanismType: string;
  mechanismDescription: string;
  mechanismSteps: string[];
  mechanismPromise: string;
  mechanismProblem: string;
  mechanismLogic: string;
  axisAlignment: {
    primaryAxis: string;
    axisEmphasis: string[];
    axisConfidence: number;
  };
  structuralFrame: string;
  differentiationLink: string;
}

export interface MechanismEngineResult {
  status: string;
  statusMessage: string | null;
  primaryMechanism: MechanismOutput;
  alternativeMechanism: MechanismOutput | null;
  axisConsistency: {
    consistent: boolean;
    primaryAxis: string;
    mechanismAxis: string;
    failures: string[];
  };
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  diagnostics: Record<string, any>;
}
