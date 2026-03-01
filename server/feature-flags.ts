import { db } from "./db";
import { featureFlags, featureFlagAudit, auditLog } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export type LeadEngineModule =
  | "lead_capture_enabled"
  | "cta_engine_enabled"
  | "conversion_tracking_enabled"
  | "funnel_logic_enabled"
  | "lead_magnet_enabled"
  | "landing_pages_enabled"
  | "revenue_attribution_enabled"
  | "ai_lead_optimization_enabled"
  | "lead_engine_global_off"
  | "competitive_intelligence_enabled"
  | "auto_studio_analyze_v2";

const MODULE_DEPENDENCIES: Record<string, string[]> = {
  lead_capture_enabled: [],
  conversion_tracking_enabled: [],
  cta_engine_enabled: ["conversion_tracking_enabled"],
  funnel_logic_enabled: [],
  lead_magnet_enabled: [],
  landing_pages_enabled: [],
  revenue_attribution_enabled: ["conversion_tracking_enabled"],
  ai_lead_optimization_enabled: ["conversion_tracking_enabled", "funnel_logic_enabled"],
  competitive_intelligence_enabled: [],
  auto_studio_analyze_v2: [],
};

export interface FlagCheckResult {
  enabled: boolean;
  safeMode: boolean;
  missingDependencies: string[];
}

export class FeatureFlagService {
  async isEnabled(flagName: LeadEngineModule, accountId: string = "default"): Promise<boolean> {
    const globalKill = await this.getRawFlag("lead_engine_global_off", accountId);
    if (globalKill) return false;

    if (flagName === "lead_engine_global_off") return false;

    return this.getRawFlag(flagName, accountId);
  }

  async checkWithDependencies(flagName: LeadEngineModule, accountId: string = "default"): Promise<FlagCheckResult> {
    const enabled = await this.isEnabled(flagName, accountId);
    if (!enabled) {
      return { enabled: false, safeMode: false, missingDependencies: [] };
    }

    const deps = MODULE_DEPENDENCIES[flagName] || [];
    const missingDependencies: string[] = [];

    for (const dep of deps) {
      const depEnabled = await this.getRawFlag(dep as LeadEngineModule, accountId);
      if (!depEnabled) {
        missingDependencies.push(dep);
      }
    }

    const safeMode = missingDependencies.length > 0;

    if (safeMode) {
      await this.logDependencyBlocked(accountId, flagName, missingDependencies);
    }

    return { enabled: true, safeMode, missingDependencies };
  }

  async getAllFlags(accountId: string = "default"): Promise<Record<string, boolean>> {
    const flags = await db.select().from(featureFlags)
      .where(eq(featureFlags.accountId, accountId));

    const result: Record<string, boolean> = {};
    const allModules: LeadEngineModule[] = [
      "lead_capture_enabled", "cta_engine_enabled", "conversion_tracking_enabled",
      "funnel_logic_enabled", "lead_magnet_enabled", "landing_pages_enabled",
      "revenue_attribution_enabled", "ai_lead_optimization_enabled", "lead_engine_global_off",
      "competitive_intelligence_enabled", "auto_studio_analyze_v2",
    ];

    for (const mod of allModules) {
      const flag = flags.find(f => f.flagName === mod);
      result[mod] = flag?.enabled ?? false;
    }

    const globalKill = result["lead_engine_global_off"];
    if (globalKill) {
      for (const mod of allModules) {
        if (mod !== "lead_engine_global_off") {
          result[mod] = false;
        }
      }
    }

    return result;
  }

  async setFlag(
    flagName: LeadEngineModule,
    enabled: boolean,
    accountId: string = "default",
    userId?: string,
    reason?: string
  ): Promise<void> {
    const existing = await db.select().from(featureFlags)
      .where(and(
        eq(featureFlags.accountId, accountId),
        eq(featureFlags.flagName, flagName)
      ))
      .limit(1);

    const fromValue = existing[0]?.enabled ?? false;

    if (existing.length > 0) {
      await db.update(featureFlags)
        .set({ enabled, updatedBy: userId || null, updatedAt: new Date() })
        .where(eq(featureFlags.id, existing[0].id));
    } else {
      await db.insert(featureFlags).values({
        accountId,
        flagName,
        enabled,
        updatedBy: userId || null,
      });
    }

    await db.insert(featureFlagAudit).values({
      accountId,
      userId: userId || null,
      flagName,
      fromValue,
      toValue: enabled,
      reason: reason || null,
    });

    await db.insert(auditLog).values({
      accountId,
      eventType: "FEATURE_FLAG_TOGGLED",
      details: JSON.stringify({
        flagName,
        fromValue,
        toValue: enabled,
        userId,
        reason,
        timestamp: new Date().toISOString(),
      }),
    });

    if (flagName === "lead_engine_global_off" && enabled) {
      await db.insert(auditLog).values({
        accountId,
        eventType: "LEAD_ENGINE_GLOBAL_KILL",
        details: JSON.stringify({
          action: "GLOBAL_KILL_SWITCH_ACTIVATED",
          userId,
          reason,
          timestamp: new Date().toISOString(),
        }),
      });
    }
  }

  async getFlagAuditHistory(accountId: string = "default", limit: number = 50) {
    return db.select().from(featureFlagAudit)
      .where(eq(featureFlagAudit.accountId, accountId))
      .orderBy(sql`${featureFlagAudit.createdAt} DESC`)
      .limit(limit);
  }

  private async getRawFlag(flagName: string, accountId: string): Promise<boolean> {
    const flag = await db.select().from(featureFlags)
      .where(and(
        eq(featureFlags.accountId, accountId),
        eq(featureFlags.flagName, flagName)
      ))
      .limit(1);

    return flag[0]?.enabled ?? false;
  }

  private async logDependencyBlocked(accountId: string, flagName: string, missingDeps: string[]) {
    await db.insert(auditLog).values({
      accountId,
      eventType: "FLAG_DEPENDENCY_BLOCKED",
      details: JSON.stringify({
        module: flagName,
        missingDependencies: missingDeps,
        mode: "safe_mode",
        timestamp: new Date().toISOString(),
      }),
    });
  }
}

export const featureFlagService = new FeatureFlagService();
