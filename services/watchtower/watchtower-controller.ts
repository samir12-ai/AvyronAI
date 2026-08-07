import { getApiUrl, authFetch } from '@/lib/query-client';
import { WatchtowerSectionState, WatchtowerPageState } from '@/types/watchtower';

/**
 * Controller mediating Watchtower UI and Backend APIs.
 * Enforces the Single Source of Truth rule.
 * Consumes the strict WatchtowerCardIdentity from the backend.
 */
export class WatchtowerController {
  private campaignId: string;

  constructor(campaignId: string) {
    this.campaignId = campaignId;
  }

  private mapSeverityToImpact(severity: string) {
    switch (severity?.toLowerCase()) {
      case 'major':
      case 'high':
        return 'High Impact';
      case 'medium':
        return 'Medium Impact';
      case 'mild':
      case 'low':
      default:
        return 'Low Impact';
    }
  }

  public async fetchWatchtowerState(filters: { tab?: string, impact?: string, status?: string, competitor?: string, category?: string } = {}): Promise<WatchtowerSectionState> {
    try {
      const url = new URL('/api/perception/market-signals', getApiUrl());
      url.searchParams.set('campaignId', this.campaignId);
      url.searchParams.set('limit', '50'); // Pull latest feed based on limit (can increase if needed)
      
      if (filters.tab && filters.tab !== 'All Changes') {
        url.searchParams.set('tab', filters.tab);
      }
      if (filters.impact && filters.impact !== 'All Impact') url.searchParams.set('impact', filters.impact);
      if (filters.competitor && filters.competitor !== 'All Competitors') url.searchParams.set('competitor', filters.competitor);
      if (filters.category && filters.category !== 'All Types') url.searchParams.set('category', filters.category);
      
      const res = await authFetch(url.toString());
      if (!res.ok) {
        return this.getEmptyState('ERROR', 'Failed to connect to Market Intelligence.');
      }

      const data = await res.json();
      
      if (!data.success) {
        return this.getEmptyState('ERROR', 'Failed to retrieve market data.');
      }

      const signals = data.signals || [];
      const summary = data.summary || {};
      const pageState = signals.length === 0 ? 'NO_SIGNALS' : 'CONFIRMED_CHANGES';
      
      const events = signals.map((s: any) => {
        let competitorName = s.competitor;
        if (!competitorName) {
          if (s.competitorIds && s.competitorIds.length > 0) {
            console.warn(`[WatchtowerController] Unresolved competitorId: ${s.competitorIds[0]}`);
          }
          competitorName = 'Competitor unavailable';
        }

        const isLineageIncomplete = (!s.sourceRecordIds || s.sourceRecordIds.length === 0) && (!s.evidenceRefIds || s.evidenceRefIds.length === 0);

        return {
          identity: {
            cardId: s.id,
            eventId: s.id,
            signalIds: [],
            campaignId: s.campaignId,
            accountId: s.accountId,
            cardType: s.status === 'confirmed' ? 'confirmed_change' : 'first_observation',
            semanticKind: s.kind,
            normalizedTheme: s.label || s.kind,
            direction: null,
            competitorIds: s.competitorIds || [],
            evidenceRefIds: s.evidenceRefIds || [],
            reasoningRunId: null,
            strategyRefreshId: null,
            executionTaskIds: [],
            sourceEngine: 'watchtower',
            sourceRecordIds: s.sourceRecordIds || [],
            schemaVersion: s.schemaVersion || '1.0',
            engineVersion: s.engineVersion || '1.0',
            classifierVersion: s.classifierVersion || '1.0',
            watchtowerVersion: s.watchtowerVersion || '1.0',
            baselineSnapshotId: s.baselineSnapshotId || 'none',
            currentSnapshotId: s.currentSnapshotId || 'none',
          },
          title: s.label || 'Market Change Detected',
          impact: this.mapSeverityToImpact(s.severity),
          status: s.status || 'candidate',
          competitors: [competitorName],
          timeDetected: s.detectedAt || s.createdAt || new Date().toISOString(),
          category: s.label || 'Market Signal',
          whatHappened: null,
          whyItMatters: null,
          recommendedResponse: null,
          // BUG 1 FIX: use first evidence note as the display description — never null if notes exist
          evidenceText: (s.evidence && s.evidence.length > 0) ? s.evidence[0] : null,
          
          displayTitle: s.label || 'Market Change',
          displayCategory: s.label || 'Market Signal',
          displayImpact: this.mapSeverityToImpact(s.severity),
          // BUG 3 FIX: clean status mapping — never expose internal flags like EVIDENCE_LINEAGE_INCOMPLETE
          displayStatus: (
            s.status === 'confirmed' ? 'Confirmed' :
            s.status === 'candidate' ? 'First Observation' :
            (s.status === 'archived' || s.status === 'dismissed') ? 'Archived' :
            s.status === 'closed' ? 'Closed' :
            'Unknown'
          ),
          // BUG 1 FIX: displayDescription must equal the same deterministic evidence the detail panel shows
          displayDescription: (s.evidence && s.evidence.length > 0) ? s.evidence[0] : null,
          displayCompetitorNames: competitorName,
          displayDate: s.createdAt || s.detectedAt,
          hasTrendData: false,
          trendValue: null,
          trendLabel: null
        };
      });
      
      return {
        pageState,
        events,
        // BUG 7 FIX: ALL KPI values MUST come exclusively from backend global summary — no frontend derivation
        activeAlertsCount: summary.activeChanges ?? 0,
        confirmedChangesCount: summary.confirmedChanges ?? 0,
        competitorsMovingCount: summary.competitorsMoving ?? 0,
        totalCompetitors: summary.totalCompetitors ?? 0,
        // BUG 6 FIX: Last scan ONLY from lastSuccessfulScan — never fall back to events[0].timeDetected
        lastScanTimestamp: summary.lastSuccessfulScan ?? null,
        impactBreakdown: summary.impactBreakdown || null,
        confirmedChangesPrev7d: summary.confirmedChangesPrev7d || null,
        movingPercentage: summary.movingPercentage || null,
        nextScanTimestamp: summary.nextScanTimestamp || null,
        // BUG 8 FIX: Tab counts ONLY from backend global summary — never compute from paginated feed
        tabCounts: summary.tabCounts || {
          "All Changes": 0, "High Impact": 0, "Confirmed": 0, "First Observation": 0, "Archived": 0
        },
        availableFilters: summary.availableFilters || {
          competitors: [], categories: [], impacts: ['High Impact', 'Medium Impact', 'Low Impact']
        },
        marketActivity: summary.marketActivity || null,
        adaptiveFlow: data.flowState || this.getEmptyState('NO_SIGNALS').adaptiveFlow,
        error: null,
      };
    } catch (err: any) {
      console.error('[WatchtowerController] Error fetching state:', err);
      return this.getEmptyState('ERROR', err.message || 'Failed to load Watchtower data');
    }
  }

  private getEmptyState(pageState: WatchtowerPageState, error: string | null = null): WatchtowerSectionState {
    return {
      pageState,
      events: [],
      activeAlertsCount: 0,
      confirmedChangesCount: 0,
      competitorsMovingCount: 0,
      totalCompetitors: 0,
      lastScanTimestamp: null,
      impactBreakdown: null,
      confirmedChangesPrev7d: null,
      movingPercentage: null,
      nextScanTimestamp: null,
      tabCounts: {
        "All Changes": 0, "High Impact": 0, "Confirmed": 0, "First Observation": 0, "Archived": 0
      },
      availableFilters: { competitors: [], categories: [], impacts: ['High Impact', 'Medium Impact', 'Low Impact'] },
      adaptiveFlow: {
        watchtowerState: pageState === 'CONFIRMED_CHANGES' ? 'confirmed' : 'scanning',
        strategyState: 'up_to_date',
        tasksState: 'no_task',
        dashboardState: 'pending',
      },
      error,
    };
  }
}

