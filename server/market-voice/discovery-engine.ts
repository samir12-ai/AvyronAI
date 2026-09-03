import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  marketVoiceDiscoveryJobs,
  marketVoiceSearchIntents,
  marketVoiceDiscoveryResults,
  campaignOfferings,
  offeringInputEvidence,
} from "@shared/schema";
import {
  type SearchIntentExecutionStatus,
  type DiscoveryJobStatus,
  type RawDiscoveryResultDraft,
  type IntentExecutionTelemetry,
  type DiscoveryJobExecutionSummary,
  generateDiscoveryResultId,
} from "@shared/contracts/market-voice";
import { executeSearchIntentByPlatform, normalizeCanonicalUrl } from "./provider-router";

export interface BudgetWatchdogConfig {
  maxIntentsPerJob: number;
  maxProviderCallsPerJob: number;
  maxResultsPerIntent: number;
  maxTotalResultsPerJob: number;
  maxRetries: number;
  timeoutMsPerCall: number;
}

export const DEFAULT_BUDGET_CONFIG: BudgetWatchdogConfig = {
  maxIntentsPerJob: 12,
  maxProviderCallsPerJob: 12,
  maxResultsPerIntent: 10,
  maxTotalResultsPerJob: 100,
  maxRetries: 2,
  timeoutMsPerCall: 60000,
};

export class BudgetWatchdog {
  public config: BudgetWatchdogConfig;
  public providerCallsMade = 0;
  public totalResultsFetched = 0;

  constructor(config: Partial<BudgetWatchdogConfig> = {}) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
  }

  public canExecuteIntent(): boolean {
    if (this.providerCallsMade >= this.config.maxProviderCallsPerJob) {
      return false;
    }
    if (this.totalResultsFetched >= this.config.maxTotalResultsPerJob) {
      return false;
    }
    return true;
  }

  public recordCall(): void {
    this.providerCallsMade++;
  }

  public recordResults(count: number): void {
    this.totalResultsFetched += count;
  }

  public getRemainingCallsBudget(): number {
    return Math.max(0, this.config.maxProviderCallsPerJob - this.providerCallsMade);
  }

  public getRemainingResultsBudget(): number {
    return Math.max(0, this.config.maxTotalResultsPerJob - this.totalResultsFetched);
  }
}

export interface DiscoveryExecutionOptions {
  budgetConfig?: Partial<BudgetWatchdogConfig>;
}

/**
 * Orchestrates Phase 3 Provider Search Discovery for an approved Market Voice Discovery Job.
 * 
 * Strict Invariants:
 * 1. Executes approved intents from market_voice_search_intents.
 * 2. Enforces BudgetWatchdog limits before every provider call.
 * 3. Persists raw discovery results to market_voice_discovery_results with full foreign key lineage.
 * 4. Deduplicates results structurally within the same intent.
 * 5. NEVER creates market_voice_evidence (Phase 4 only).
 * 6. NEVER creates or activates ci_competitors (Phase 5 only).
 * 7. NEVER touches Audience or Watchtower.
 */
export async function executeMarketVoiceDiscoveryJob(
  discoveryJobId: string,
  options: DiscoveryExecutionOptions = {}
): Promise<DiscoveryJobExecutionSummary> {
  const [job] = await db
    .select()
    .from(marketVoiceDiscoveryJobs)
    .where(eq(marketVoiceDiscoveryJobs.id, discoveryJobId))
    .limit(1);

  if (!job) {
    throw new Error(`[DiscoveryEngine] Discovery job ${discoveryJobId} not found`);
  }

  // Verify offering authority
  const [offering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(eq(campaignOfferings.id, job.campaignOfferingId), eq(campaignOfferings.campaignId, job.campaignId)))
    .limit(1);

  if (!offering) {
    throw new Error(`[DiscoveryEngine] Canonical offering ${job.campaignOfferingId} not found`);
  }

  // Load approved search intents
  const intents = await db
    .select()
    .from(marketVoiceSearchIntents)
    .where(eq(marketVoiceSearchIntents.discoveryJobId, discoveryJobId));

  if (!intents || intents.length === 0) {
    throw new Error(`[DiscoveryEngine] No search intents found for discoveryJobId=${discoveryJobId}`);
  }

  // Update job status to RUNNING
  await db
    .update(marketVoiceDiscoveryJobs)
    .set({ status: "RUNNING" })
    .where(eq(marketVoiceDiscoveryJobs.id, discoveryJobId));

  const watchdog = new BudgetWatchdog(options.budgetConfig);
  const telemetry: IntentExecutionTelemetry[] = [];

  let successfulIntents = 0;
  let failedIntents = 0;
  let unavailableIntents = 0;
  let totalResultsPersisted = 0;
  let budgetLimitReached = false;

  for (const intent of intents) {
    const isBudgetAvailable = watchdog.canExecuteIntent();

    if (!isBudgetAvailable) {
      budgetLimitReached = true;
      await db
        .update(marketVoiceSearchIntents)
        .set({ status: "BUDGET_EXHAUSTED", resultsCount: 0 })
        .where(eq(marketVoiceSearchIntents.id, intent.id));

      telemetry.push({
        searchIntentId: intent.id,
        targetPlatform: intent.targetPlatform as any,
        query: intent.query,
        status: "BUDGET_EXHAUSTED",
        provider: "budget_watchdog",
        requestedResultLimit: 0,
        resultsReceived: 0,
        resultsPersisted: 0,
        runtimeMs: 0,
        retryCount: 0,
        budgetRemaining: 0,
        error: "Job-level budget exhausted before executing intent",
      });
      continue;
    }

    watchdog.recordCall();
    const resultLimit = Math.min(watchdog.config.maxResultsPerIntent, watchdog.getRemainingResultsBudget());

    const execResult = await executeSearchIntentByPlatform({
      accountId: job.accountId,
      campaignId: job.campaignId,
      campaignOfferingId: job.campaignOfferingId,
      discoveryJobId: job.id,
      searchIntentId: intent.id,
      query: intent.query,
      targetPlatform: intent.targetPlatform as any,
      marketScope: intent.marketScope as any,
      targetGeography: intent.targetGeography,
      languageHint: intent.languageHint,
      limit: resultLimit,
      budgetMs: watchdog.config.timeoutMsPerCall,
    });

    let persistedForIntent = 0;
    const seenUrlsInIntent = new Set<string>();

    if (execResult.results.length > 0) {
      for (const item of execResult.results) {
        const canonicalUrl = normalizeCanonicalUrl(item.canonicalUrl || item.url);
        if (seenUrlsInIntent.has(canonicalUrl)) {
          // Structural deduplication within the same search intent
          continue;
        }
        seenUrlsInIntent.add(canonicalUrl);

        const resultId = generateDiscoveryResultId(intent.id, canonicalUrl);

        // Transactional write per discovery result with strict foreign key lineage
        await db.insert(marketVoiceDiscoveryResults).values({
          id: resultId,
          searchIntentId: intent.id,
          discoveryJobId: job.id,
          accountId: job.accountId,
          campaignId: job.campaignId,
          campaignOfferingId: job.campaignOfferingId,
          url: item.url,
          canonicalUrl,
          title: item.title || null,
          snippet: item.snippet || null,
          sourcePlatform: item.sourcePlatform,
          discoveredType: item.discoveredType || "WEB_PAGE",
          verificationStatus: "DISCOVERED",
          fetchJobId: job.id,
          providerRunId: execResult.providerRunId || null,
          metadata: item.metadata || {},
        }).onConflictDoNothing();

        persistedForIntent++;
      }

      watchdog.recordResults(persistedForIntent);
      totalResultsPersisted += persistedForIntent;
    }

    if (execResult.status === "COMPLETED" || execResult.status === "NO_RESULTS") {
      successfulIntents++;
    } else if (execResult.status === "PROVIDER_UNAVAILABLE") {
      unavailableIntents++;
    } else {
      failedIntents++;
    }

    await db
      .update(marketVoiceSearchIntents)
      .set({
        status: execResult.status,
        resultsCount: persistedForIntent,
      })
      .where(eq(marketVoiceSearchIntents.id, intent.id));

    telemetry.push({
      searchIntentId: intent.id,
      targetPlatform: intent.targetPlatform as any,
      approvedQuery: execResult.approvedQuery || intent.query,
      providerQuery: execResult.providerQuery || intent.query,
      query: intent.query,
      status: execResult.status,
      provider: execResult.provider,
      providerRunId: execResult.providerRunId,
      requestedResultLimit: resultLimit,
      resultsReceived: execResult.results.length,
      resultsPersisted: persistedForIntent,
      runtimeMs: execResult.runtimeMs,
      retryCount: execResult.retryCount,
      budgetRemaining: watchdog.getRemainingResultsBudget(),
      error: execResult.error,
    });
  }

  let finalJobStatus: DiscoveryJobStatus;
  if (successfulIntents === intents.length) {
    finalJobStatus = "COMPLETED";
  } else if (successfulIntents === 0) {
    finalJobStatus = "FAILED";
  } else if (budgetLimitReached && failedIntents === 0 && unavailableIntents === 0) {
    finalJobStatus = "COMPLETED_WITH_BUDGET_LIMIT";
  } else {
    finalJobStatus = "COMPLETED_WITH_GAPS";
  }

  await db
    .update(marketVoiceDiscoveryJobs)
    .set({ status: finalJobStatus })
    .where(eq(marketVoiceDiscoveryJobs.id, discoveryJobId));

  return {
    discoveryJobId,
    status: finalJobStatus,
    totalIntents: intents.length,
    executedIntents: intents.length - (budgetLimitReached ? telemetry.filter(t => t.status === "BUDGET_EXHAUSTED").length : 0),
    successfulIntents,
    failedIntents,
    unavailableIntents,
    totalResultsDiscovered: totalResultsPersisted,
    totalResultsPersisted,
    telemetry,
    budgetRemaining: watchdog.getRemainingResultsBudget(),
  };
}
