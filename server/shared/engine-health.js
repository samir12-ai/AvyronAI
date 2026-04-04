import { db } from "../db";
import { miSnapshots, audienceSnapshots } from "../../shared/schema";
import { inArray, eq, desc, and } from "drizzle-orm";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/engine";
import { executeSemanticBridge, validateBridgeIntegrity } from "../audience-engine/semantic-bridge";
const MAX_FRESHNESS_DAYS = 14;
export async function checkMIv3Freshness(accountId, campaignId) {
    const [latest] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId), inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"])))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(1);
    if (!latest) {
        return {
            snapshotId: null,
            isFresh: false,
            ageInDays: Infinity,
            maxAllowedDays: MAX_FRESHNESS_DAYS,
            requiresRefresh: true,
            version: null,
            versionMatch: false,
        };
    }
    const ageMs = Date.now() - new Date(latest.createdAt).getTime();
    const ageInDays = Math.round(ageMs / (1000 * 60 * 60 * 24));
    const version = latest.analysisVersion ?? null;
    const versionMatch = version === MI_ENGINE_VERSION;
    return {
        snapshotId: latest.id,
        isFresh: ageInDays <= MAX_FRESHNESS_DAYS && versionMatch,
        ageInDays,
        maxAllowedDays: MAX_FRESHNESS_DAYS,
        requiresRefresh: ageInDays > MAX_FRESHNESS_DAYS || !versionMatch,
        version,
        versionMatch,
    };
}
export async function validateRoutingIntegrity(accountId, campaignId) {
    const engines = [];
    const brokenRoutes = [];
    let staleSnapshots = 0;
    const miFreshness = await checkMIv3Freshness(accountId, campaignId);
    const miHealth = {
        engine: "MarketIntelligence-V3",
        healthy: miFreshness.isFresh,
        version: miFreshness.version ?? "NONE",
        issues: [],
    };
    if (!miFreshness.snapshotId) {
        miHealth.issues.push("No MIv3 snapshot found for this campaign");
        brokenRoutes.push("MIv3 → Positioning: No source data");
        brokenRoutes.push("MIv3 → Offer: No source data");
    }
    else {
        if (!miFreshness.versionMatch) {
            miHealth.issues.push(`Version mismatch: snapshot=${miFreshness.version}, current=${MI_ENGINE_VERSION}`);
            staleSnapshots++;
        }
        if (miFreshness.ageInDays > MAX_FRESHNESS_DAYS) {
            miHealth.issues.push(`Data stale: ${miFreshness.ageInDays}d > ${MAX_FRESHNESS_DAYS}d max`);
            staleSnapshots++;
        }
    }
    engines.push(miHealth);
    const importedEngines = [
        { name: "OfferEngine", importPath: "../offer-engine/constants", versionKey: "ENGINE_VERSION" },
        { name: "PositioningEngine", importPath: "../positioning-engine/engine", versionKey: "POSITIONING_ENGINE_VERSION" },
    ];
    for (const eng of importedEngines) {
        try {
            const mod = await import(eng.importPath);
            const version = mod[eng.versionKey] || mod.ENGINE_VERSION || "unknown";
            engines.push({
                engine: eng.name,
                healthy: true,
                version,
                issues: [],
            });
        }
        catch {
            engines.push({
                engine: eng.name,
                healthy: false,
                version: "LOAD_FAILED",
                issues: [`Failed to load engine module: ${eng.importPath}`],
            });
            brokenRoutes.push(`${eng.name}: Module load failed`);
        }
    }
    if (!miFreshness.isFresh && miFreshness.snapshotId) {
        brokenRoutes.push("MIv3 → Positioning: Stale/version-mismatched data buffer");
        brokenRoutes.push("MIv3 → Offer: Stale/version-mismatched data buffer");
    }
    const audienceBridgeHealth = {
        engine: "SemanticBridge-MIv3→Audience",
        healthy: true,
        version: MI_ENGINE_VERSION,
        issues: [],
    };
    if (miFreshness.snapshotId) {
        try {
            const [miSnap] = await db.select().from(miSnapshots)
                .where(eq(miSnapshots.id, miFreshness.snapshotId))
                .limit(1);
            if (miSnap) {
                const bridgeResult = executeSemanticBridge(miSnap);
                const bridgeValidation = validateBridgeIntegrity(bridgeResult);
                if (!bridgeValidation.valid) {
                    audienceBridgeHealth.healthy = false;
                    audienceBridgeHealth.issues.push(...bridgeValidation.issues);
                    brokenRoutes.push("MIv3 → Audience: Semantic bridge integrity failure");
                }
                if (!bridgeResult.cleanPipeEnforced) {
                    audienceBridgeHealth.issues.push("Clean-pipe architecture not enforced — unverified signals may reach audience profiles");
                    audienceBridgeHealth.healthy = false;
                }
            }
            const [latestAudience] = await db.select().from(audienceSnapshots)
                .where(and(eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.campaignId, campaignId)))
                .orderBy(desc(audienceSnapshots.createdAt))
                .limit(1);
            if (latestAudience?.signalLineage) {
                try {
                    const lineage = JSON.parse(latestAudience.signalLineage);
                    const bridgeEntries = lineage.filter((e) => e.category?.startsWith("bridge_"));
                    const orphanEntries = bridgeEntries.filter((e) => !e.description?.includes("[parent:"));
                    if (orphanEntries.length > 0) {
                        audienceBridgeHealth.healthy = false;
                        audienceBridgeHealth.issues.push(`Inference without evidence: ${orphanEntries.length} bridged signal(s) lack parent traceability`);
                    }
                }
                catch { }
            }
        }
        catch (err) {
            audienceBridgeHealth.healthy = false;
            audienceBridgeHealth.issues.push(`Bridge validation error: ${err instanceof Error ? err.message : "unknown"}`);
        }
    }
    else {
        audienceBridgeHealth.issues.push("No MIv3 snapshot available — semantic bridge inactive");
    }
    engines.push(audienceBridgeHealth);
    const healthy = engines.every(e => e.healthy) && brokenRoutes.length === 0;
    return {
        healthy,
        engines,
        staleSnapshots,
        brokenRoutes,
        timestamp: Date.now(),
    };
}
export async function enforceGlobalStateRefresh(accountId, campaignId) {
    const freshness = await checkMIv3Freshness(accountId, campaignId);
    return {
        fresh: freshness.isFresh,
        refreshRequired: freshness.requiresRefresh,
        details: freshness,
    };
}
