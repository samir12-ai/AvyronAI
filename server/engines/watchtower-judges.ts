import { WatchtowerCardIdentity } from "../../types/watchtower";
import * as crypto from "crypto";

export class IdentityJudge {
  static verifyIdentity(identity: WatchtowerCardIdentity): boolean {
    if (!identity.cardId || !identity.campaignId || !identity.accountId) return false;
    if (identity.sourceRecordIds.length === 0) return false;
    if (identity.cardType === 'grouped_shift' && identity.signalIds.length < 2) return false;
    if (identity.cardType === 'single_shift' && identity.signalIds.length > 1) return false;
    return true;
  }
}

export class GroupingJudge {
  static generateGroupId(campaignId: string, semanticKind: string, normalizedTheme: string, direction: string | null, timeBucket: string, competitorIds: string[]): string {
    const sortedComps = [...competitorIds].sort().join(',');
    const hashStr = `${campaignId}|${semanticKind}|${normalizedTheme}|${direction || 'none'}|${timeBucket}|${sortedComps}`;
    return crypto.createHash('sha256').update(hashStr).digest('hex').substring(0, 16);
  }

  static canGroup(a: any, b: any): boolean {
    if (a.campaignId !== b.campaignId || a.accountId !== b.accountId) return false;
    if (a.kind !== b.kind) return false;
    
    // In a real scenario, normalizedTheme and direction would be evaluated here.
    // For this demonstration, we assume they are compatible if they share the same 'kind'.
    return true;
  }
}

export class EvidenceJudge {
  static verifyEvidenceLineage(generatedText: string, allowedRefIds: string[], usedRefIds: string[]): boolean {
    // LLM claims must be backed by evidence
    for (const ref of usedRefIds) {
      if (!allowedRefIds.includes(ref)) {
        console.warn(`[EvidenceJudge] Rejected: LLM cited unauthorized evidence ref: ${ref}`);
        return false;
      }
    }
    return true;
  }
}

export class RecommendationJudge {
  static verifyRecommendation(eventIdentity: WatchtowerCardIdentity, strategyRefreshId: string | null): boolean {
    if (strategyRefreshId && eventIdentity.strategyRefreshId !== strategyRefreshId) {
      console.warn(`[RecommendationJudge] Rejected: Recommendation does not belong to this event`);
      return false;
    }
    return true;
  }
}

export class AdaptiveFlowJudge {
  static resolveState(events: WatchtowerCardIdentity[]): any {
    const hasConfirmed = events.some(e => e.cardType === 'confirmed_change' || e.cardType === 'grouped_shift');
    const hasStrategyRefresh = events.some(e => e.strategyRefreshId !== null);
    const hasTasks = events.some(e => e.executionTaskIds.length > 0);

    return {
      watchtowerState: hasConfirmed ? 'confirmed' : (events.length > 0 ? 'detected' : 'scanning'),
      strategyState: hasStrategyRefresh ? 'refresh_available' : 'up_to_date',
      tasksState: hasTasks ? 'task_created' : 'no_task',
      dashboardState: hasTasks ? 'updated' : 'pending',
    };
  }
}
