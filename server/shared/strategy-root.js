import crypto from "crypto";
import { db } from "../db";
import { strategyRoots, offerSnapshots, funnelSnapshots, integritySnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
export function computeRootHash(input) {
    const hashPayload = {
        mi: input.miSnapshotId,
        aud: input.audienceSnapshotId,
        pos: input.positioningSnapshotId,
        diff: input.differentiationSnapshotId,
        mech: input.mechanismSnapshotId,
        axis: input.primaryAxis,
        contrast: input.contrastAxisText,
        objections: input.approvedObjections ? JSON.stringify(input.approvedObjections) : null,
        proofTypes: input.approvedProofTypes ? JSON.stringify(input.approvedProofTypes) : null,
        posContext: input.approvedPositioningContext ? JSON.stringify(input.approvedPositioningContext) : null,
    };
    return crypto.createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex").substring(0, 16);
}
export function generateRunId() {
    return `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
export async function buildStrategyRoot(input) {
    const rootHash = computeRootHash(input);
    const runId = generateRunId();
    const [existing] = await db.select().from(strategyRoots)
        .where(and(eq(strategyRoots.campaignId, input.campaignId), eq(strategyRoots.accountId, input.accountId), eq(strategyRoots.rootHash, rootHash), eq(strategyRoots.status, "ACTIVE")))
        .limit(1);
    if (existing) {
        console.log(`[StrategyRoot] REUSE | existing root ${existing.id} | hash=${rootHash} | campaign=${input.campaignId}`);
        return { id: existing.id, runId: existing.runId, rootHash, isNew: false };
    }
    await db.update(strategyRoots)
        .set({ status: "SUPERSEDED" })
        .where(and(eq(strategyRoots.campaignId, input.campaignId), eq(strategyRoots.accountId, input.accountId), eq(strategyRoots.status, "ACTIVE")));
    const [created] = await db.insert(strategyRoots).values({
        accountId: input.accountId,
        campaignId: input.campaignId,
        runId,
        rootHash,
        primaryAxis: input.primaryAxis,
        contrastAxisText: input.contrastAxisText,
        approvedMechanism: JSON.stringify(input.approvedMechanism),
        approvedAudiencePains: JSON.stringify(input.approvedAudiencePains),
        approvedDesires: JSON.stringify(input.approvedDesires),
        approvedTransformation: input.approvedTransformation,
        approvedClaim: input.approvedClaim,
        approvedPromise: input.approvedPromise,
        approvedObjections: JSON.stringify(input.approvedObjections),
        approvedProofTypes: JSON.stringify(input.approvedProofTypes),
        approvedPositioningContext: JSON.stringify(input.approvedPositioningContext),
        miSnapshotId: input.miSnapshotId,
        audienceSnapshotId: input.audienceSnapshotId,
        positioningSnapshotId: input.positioningSnapshotId,
        differentiationSnapshotId: input.differentiationSnapshotId,
        mechanismSnapshotId: input.mechanismSnapshotId,
        status: "ACTIVE",
    }).returning();
    console.log(`[StrategyRoot] CREATED | id=${created.id} | hash=${rootHash} | runId=${runId} | campaign=${input.campaignId}`);
    return { id: created.id, runId, rootHash, isNew: true };
}
export async function getActiveRoot(campaignId, accountId = "default") {
    const [active] = await db.select().from(strategyRoots)
        .where(and(eq(strategyRoots.campaignId, campaignId), eq(strategyRoots.accountId, accountId), eq(strategyRoots.status, "ACTIVE")))
        .orderBy(desc(strategyRoots.createdAt))
        .limit(1);
    return active || null;
}
export function validateRootBinding(activeRoot, snapshotIds) {
    if (!activeRoot) {
        return {
            valid: false,
            issues: ["No active strategy root — run Mechanism Engine to create one"],
            rootId: null,
            rootHash: null,
            runId: null,
        };
    }
    const issues = [];
    if (snapshotIds.miSnapshotId && snapshotIds.miSnapshotId !== activeRoot.miSnapshotId) {
        issues.push(`MI snapshot mismatch: using ${snapshotIds.miSnapshotId} but root expects ${activeRoot.miSnapshotId}`);
    }
    if (snapshotIds.audienceSnapshotId && snapshotIds.audienceSnapshotId !== activeRoot.audienceSnapshotId) {
        issues.push(`Audience snapshot mismatch: using ${snapshotIds.audienceSnapshotId} but root expects ${activeRoot.audienceSnapshotId}`);
    }
    if (snapshotIds.positioningSnapshotId && snapshotIds.positioningSnapshotId !== activeRoot.positioningSnapshotId) {
        issues.push(`Positioning snapshot mismatch: using ${snapshotIds.positioningSnapshotId} but root expects ${activeRoot.positioningSnapshotId}`);
    }
    if (snapshotIds.differentiationSnapshotId && snapshotIds.differentiationSnapshotId !== activeRoot.differentiationSnapshotId) {
        issues.push(`Differentiation snapshot mismatch: using ${snapshotIds.differentiationSnapshotId} but root expects ${activeRoot.differentiationSnapshotId}`);
    }
    if (snapshotIds.mechanismSnapshotId && snapshotIds.mechanismSnapshotId !== activeRoot.mechanismSnapshotId) {
        issues.push(`Mechanism snapshot mismatch: using ${snapshotIds.mechanismSnapshotId} but root expects ${activeRoot.mechanismSnapshotId}`);
    }
    return {
        valid: issues.length === 0,
        issues,
        rootId: activeRoot.id,
        rootHash: activeRoot.rootHash,
        runId: activeRoot.runId,
    };
}
export async function invalidateDownstreamOnRegeneration(campaignId, accountId, regeneratedEngine) {
    const [activeRoot] = await db.select().from(strategyRoots)
        .where(and(eq(strategyRoots.campaignId, campaignId), eq(strategyRoots.accountId, accountId), eq(strategyRoots.status, "ACTIVE")))
        .limit(1);
    if (!activeRoot) {
        return { supersededRoots: 0, invalidatedOffers: 0, invalidatedFunnels: 0, invalidatedIntegrity: 0 };
    }
    const supersededRootId = activeRoot.id;
    await db.update(strategyRoots)
        .set({ status: "SUPERSEDED" })
        .where(and(eq(strategyRoots.campaignId, campaignId), eq(strategyRoots.accountId, accountId), eq(strategyRoots.status, "ACTIVE")));
    let invalidatedOffers = 0;
    let invalidatedFunnels = 0;
    let invalidatedIntegrity = 0;
    try {
        const offerResult = await db.update(offerSnapshots)
            .set({ statusMessage: `Invalidated: upstream ${regeneratedEngine} engine regenerated (root ${supersededRootId} superseded)` })
            .where(and(eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.strategyRootId, supersededRootId)));
        invalidatedOffers = offerResult?.rowCount || 0;
    }
    catch (e) {
        console.log(`[StrategyRoot] Could not mark offer snapshots (non-critical): ${e.message}`);
    }
    try {
        const funnelResult = await db.update(funnelSnapshots)
            .set({ statusMessage: `Invalidated: upstream ${regeneratedEngine} engine regenerated (root ${supersededRootId} superseded)` })
            .where(and(eq(funnelSnapshots.campaignId, campaignId), eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.strategyRootId, supersededRootId)));
        invalidatedFunnels = funnelResult?.rowCount || 0;
    }
    catch (e) {
        console.log(`[StrategyRoot] Could not mark funnel snapshots (non-critical): ${e.message}`);
    }
    try {
        const integrityResult = await db.update(integritySnapshots)
            .set({ statusMessage: `Invalidated: upstream ${regeneratedEngine} engine regenerated (root ${supersededRootId} superseded)` })
            .where(and(eq(integritySnapshots.campaignId, campaignId), eq(integritySnapshots.accountId, accountId), eq(integritySnapshots.strategyRootId, supersededRootId)));
        invalidatedIntegrity = integrityResult?.rowCount || 0;
    }
    catch (e) {
        console.log(`[StrategyRoot] Could not mark integrity snapshots (non-critical): ${e.message}`);
    }
    console.log(`[StrategyRoot] INVALIDATED | root=${supersededRootId} | trigger=${regeneratedEngine} | campaign=${campaignId} | offers=${invalidatedOffers} | funnels=${invalidatedFunnels} | integrity=${invalidatedIntegrity}`);
    return { supersededRoots: 1, invalidatedOffers, invalidatedFunnels, invalidatedIntegrity };
}
export function validatePreGeneration(activeRoot) {
    if (!activeRoot) {
        return { canGenerate: false, missingFields: ["strategy_root"] };
    }
    const missing = [];
    if (!activeRoot.primaryAxis)
        missing.push("primary_axis");
    if (!activeRoot.mechanismSnapshotId)
        missing.push("approved_mechanism");
    if (!activeRoot.audienceSnapshotId)
        missing.push("audience_data");
    if (!activeRoot.contrastAxisText)
        missing.push("contrast_axis");
    const pains = safeJsonParse(activeRoot.approvedAudiencePains);
    if (!pains || (Array.isArray(pains) && pains.length === 0)) {
        missing.push("approved_audience_pains");
    }
    return { canGenerate: missing.length === 0, missingFields: missing };
}
export function validatePostGeneration(activeRoot, generatedOffer) {
    if (!activeRoot || !generatedOffer) {
        return { valid: true, issues: [] };
    }
    const issues = [];
    const axis = activeRoot.primaryAxis || "";
    const axisTokens = axis.replace(/_/g, " ").toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    if (generatedOffer.offerName && axisTokens.length > 0) {
        const nameLC = generatedOffer.offerName.toLowerCase();
        const nameLC2 = (generatedOffer.coreOutcome || "").toLowerCase();
        const combined = `${nameLC} ${nameLC2} ${(generatedOffer.mechanismDescription || "").toLowerCase()}`;
        const hasAxisRef = axisTokens.some((t) => {
            if (combined.includes(t))
                return true;
            const stem = t.replace(/(ity|ness|ment|tion|sion|ance|ence|able|ible|ful|less|ing|ous|ive|ical|ally|ized|ise|ize)$/, "");
            return stem.length >= 3 && combined.includes(stem);
        });
        if (!hasAxisRef) {
            issues.push(`axis_mismatch: offer does not reference the active axis "${axis.replace(/_/g, " ")}" — required tokens: [${axisTokens.join(", ")}]`);
        }
    }
    const mechData = safeJsonParse(activeRoot.approvedMechanism);
    if (mechData?.mechanismName && generatedOffer.mechanismDescription) {
        const mechName = mechData.mechanismName.toLowerCase();
        const mechDesc = generatedOffer.mechanismDescription.toLowerCase();
        if (!mechDesc.includes(mechName.substring(0, Math.min(mechName.length, 10)))) {
            issues.push(`mechanism_mismatch: approved mechanism "${mechData.mechanismName}" not referenced in offer mechanism description`);
        }
    }
    const rootPains = safeJsonParse(activeRoot.approvedAudiencePains);
    if (rootPains && Array.isArray(rootPains) && rootPains.length > 0 && generatedOffer.coreOutcome) {
        const outcomeLC = generatedOffer.coreOutcome.toLowerCase();
        const painTokens = rootPains.slice(0, 8).flatMap((p) => {
            const text = typeof p === "string" ? p : p?.pain || p?.name || "";
            return text.toLowerCase().split(/\s+/).filter((t) => t.length > 4);
        });
        const hasPainRef = painTokens.some((t) => outcomeLC.includes(t));
        if (!hasPainRef && painTokens.length > 0) {
            issues.push(`audience_pain_alignment: offer outcome does not reference any approved audience pains`);
        }
    }
    return { valid: issues.length === 0, issues };
}
function safeJsonParse(text) {
    if (!text)
        return null;
    if (typeof text !== "string")
        return text;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
