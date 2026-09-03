export interface BuyerConversionStage {
  stageId?: string;
  stageName: string;
  goal: string;
  buyerState: string;
  coreMessage: string;
  contentAction: string;
  proof: string[];
  cta: string;
}

export interface BuyerBeliefTransformation {
  currentBelief: string;
  desiredBelief: string;
  contradictionLogic?: string;
}

export interface BuyerMessageStep {
  step: string;
  stepLabel: string;
  rationale: string;
}

export interface BuyerObjection {
  objectionId?: string;
  objection: string;
  response: string;
  requiredProof: string;
  funnelStageId?: string;
}

export interface BuyerTrustStrategy {
  buyerRiskState: string;
  trustDeficit: string;
  transferMechanismName: string;
  proofArtifact: string;
  primaryCialdiniPrinciple: string;
  principleRationale: string;
}

export interface BuyerPersuasionStrategy {
  mode: string;
  modeLabel: string;
  coreBeliefTransformation?: BuyerBeliefTransformation;
  messageSequence?: BuyerMessageStep[];
  objections?: BuyerObjection[];
  trustStrategy?: BuyerTrustStrategy;
}

export interface BuyerConversionJourneyItem {
  laneId?: string;
  laneLabel?: string;
  primaryPainId?: string;
  primaryPainText?: string;
  segmentIds?: string[];
  targetSegmentName?: string;
  sourceFunnelSnapshotId?: string;
  sourcePersuasionSnapshotId?: string;
  journeyName: string;
  journeyType: string;
  whyThisJourney: string;
  entryTrigger?: {
    mechanismType: string;
    purpose: string;
  };
  stages: BuyerConversionStage[];
  persuasionStrategy?: BuyerPersuasionStrategy;
}
