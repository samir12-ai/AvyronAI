export type WatchtowerImpact = 'Low Impact' | 'Medium Impact' | 'High Impact';

export interface WatchtowerCardIdentity {
  cardId: string;
  eventId: string;
  signalIds: string[];
  campaignId: string;
  accountId: string;
  cardType: 'single_shift' | 'grouped_shift' | 'first_observation' | 'confirmed_change';
  semanticKind: string;
  normalizedTheme: string;
  direction: string | null;
  competitorIds: string[];
  evidenceRefIds: string[];
  reasoningRunId: string | null;
  strategyRefreshId: string | null;
  executionTaskIds: string[];
  sourceEngine: string;
  sourceRecordIds: string[];
  schemaVersion: string;
  engineVersion: string;
  classifierVersion: string;
  watchtowerVersion: string;
  baselineSnapshotId: string;
  currentSnapshotId: string;
}

export interface WatchtowerEvent {
  identity: WatchtowerCardIdentity;
  // Raw Fields
  title: string; 
  impact: WatchtowerImpact;
  status: string; 
  competitors: string[]; 
  timeDetected: string;
  category: string;
  whatHappened: string | null;
  whyItMatters: string | null;
  recommendedResponse: string | null;
  evidenceText: string | null;
  
  // Display (View Model) Fields
  displayTitle: string;
  displayCategory: string;
  displayImpact: string;
  displayStatus: string;
  displayDescription: string | null;
  displayCompetitorNames: string;
  displayDate: string;
  
  // Trend Fields
  hasTrendData: boolean;
  trendValue: string | null;
  trendLabel: string | null;
}

export interface AdaptiveFlowState {
  watchtowerState: 'scanning' | 'detected' | 'confirmed';
  strategyState: 'up_to_date' | 'refresh_available' | 'updated';
  tasksState: 'no_task' | 'task_created';
  dashboardState: 'pending' | 'updated';
}

export type WatchtowerPageState = 
  | 'MONITORING'
  | 'NO_SIGNALS'
  | 'FIRST_OBSERVATION'
  | 'CONFIRMED_CHANGES'
  | 'ERROR'
  | 'DEGRADED';

export interface WatchtowerSectionState {
  pageState: WatchtowerPageState;
  events: WatchtowerEvent[];
  
  // KPI Ribbons (Backend Computed)
  activeAlertsCount: number;
  confirmedChangesCount: number;
  competitorsMovingCount: number;
  totalCompetitors: number;
  lastScanTimestamp: string | null;
  
  impactBreakdown: {
    high: number;
    medium: number;
    low: number;
  } | null;
  confirmedChangesPrev7d: number | null;
  movingPercentage: string | null;
  nextScanTimestamp: string | null;

  // Tabs (Backend Computed)
  tabCounts: Record<string, number>;

  // Filters (Backend Computed)
  availableFilters: {
    competitors: string[];
    categories: string[];
    impacts: string[];
  };

  adaptiveFlow: AdaptiveFlowState;
  error: string | null;

  // Market Activity (Backend Computed)
  marketActivity?: {
    available: boolean;
    trend: { date: string; eventCount: number }[];
    mostActiveCategory: string | null;
    mostActiveCompetitors: { name: string; eventCount: number }[];
  } | null;
}

export interface WatchtowerEventDetailResponse {
  identity: {
    eventId: string;
    accountId: string;
    campaignId: string;
    competitorIds: string[];
    baselineSnapshotId: string;
    comparisonSnapshotId: string;
    reasoningRunId: string | null;
    evidenceUids: string[];
    sourceRecordIds: string[];
    schemaVersion: string;
    engineVersion: string;
    classifierVersion: string;
    watchtowerVersion: string;
  };
  event: {
    semanticKind: string;
    normalizedTheme: string;
    direction: string | null;
    status: string;
    severity: string;
    detectedAt: string | null;
    firstObservedAt: string | null;
    confirmedAt: string | null;
    updatedAt: string | null;
  };
  presentation: {
    title: string;
    category: string;
    impactLabel: string;
    statusLabel: string;
  };
  observation: {
    whatChanged: string | null;
    evidenceNotes: string[];
    whyItMatters?: string | null;
    diff?: {
      prev?: unknown;
      curr?: unknown;
    } | null;
  };
  strategicBrief?: WatchtowerStrategicBriefData | null;
  competitors: {
    competitorId: string;
    competitorName: string | null;
    observedChange: string | null;
    impact: string;
    sourceRecordIds: string[];
    evidenceUids: string[];
  }[];
  lineage: {
    complete: boolean;
    missingFields: string[];
    // Snapshot IDs for evidence traceability
    baselineSnapshotId?: string | null;
    comparisonSnapshotId?: string | null;
  };
}

export interface StrategicBriefClaim {
  claimId: string;
  claimText: string;
  claimType: string;
  factuality: string;
  criticality: string;
  evidenceRefs?: string[];
}

export interface StrategicBriefContent {
  executiveSummary?: string;
  marketSignificance?: string;
  directionOfMovement?: string;
  impactOnOurStrategy?: string;
  strategicImportance?: string;
  affectedStrategyAreas?: string[];
  strategicInterpretation?: string;
  likelyStrategicObjective?: string;
  recommendation?: string;
  assumptions?: string[];
  missingEvidence?: string[];
  claims?: StrategicBriefClaim[];
  evidenceRefs?: string[];
  modelProposedConfidence?: number;
}

export interface WatchtowerStrategicBriefData {
  id?: string;
  eventId: string;
  status: 'ready' | 'generating' | 'queued' | 'awaiting_analysis' | 'insufficient_evidence' | 'failed';
  brief?: StrategicBriefContent | null;
  evidenceRegistry?: Record<string, unknown> | null;
  contextLineage?: Record<string, unknown> | null;
  sourceVersions?: Record<string, unknown> | null;
  finalValidatedConfidence?: number | null;
  modelProposedConfidence?: number | null;
  confidenceAdjustmentReasons?: string[] | null;
  completedAt?: string | null;
  isLatest?: boolean;
}
