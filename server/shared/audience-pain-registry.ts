import crypto from "crypto";

export type AudiencePainClass =
  | "CORE_PURCHASE"
  | "OBJECTION"
  | "POST_PURCHASE_FRICTION"
  | "SUPPORTING";

export type PainUse =
  | "positioning"
  | "differentiation"
  | "mechanism"
  | "offer_core"
  | "offer_objection"
  | "awareness"
  | "funnel"
  | "persuasion"
  | "channel"
  | "retention";

export interface AuthoritativeAudiencePain {
  painId: string;
  canonical: string;
  classification: AudiencePainClass;
  rank: number;
  productFit: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
  eligible: boolean;
  allowedUses: PainUse[];
  prohibitedUses: PainUse[];
  evidenceUids: string[];
  sourceSignalIds: string[];
  lineage: { accountId: string; audienceSnapshotId: string };
}

export interface PainRegistryValidation {
  valid: boolean;
  issues: string[];
}

const USES_BY_CLASS: Record<AudiencePainClass, PainUse[]> = {
  CORE_PURCHASE: ["positioning", "differentiation", "mechanism", "offer_core", "awareness", "funnel", "persuasion", "channel"],
  OBJECTION: ["offer_objection", "awareness", "funnel", "persuasion"],
  POST_PURCHASE_FRICTION: ["retention"],
  SUPPORTING: ["awareness", "funnel", "persuasion", "channel"],
};

function painText(pain: any): string {
  return typeof pain === "string"
    ? pain
    : String(pain?.canonical ?? pain?.pain ?? pain?.text ?? pain?.label ?? pain?.name ?? "").trim();
}

function stableId(snapshotId: string, text: string): string {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `pain_${crypto.createHash("sha256").update(`${snapshotId}:${normalized}`).digest("hex").slice(0, 16)}`;
}

/** Evidence-only semantic classifier. It only classifies the supplied Audience
 * wording; it never creates or combines pain statements. */
export function classifyAudiencePain(text: string): AudiencePainClass {
  const value = text.toLowerCase();
  if (/\b(refund|return|cancel|churn|onboard|support|access|delivery|shipping|bug|billing error)\b/.test(value)) {
    return "POST_PURCHASE_FRICTION";
  }
  if (/\b(price|pricing|cost|afford|risk|trust|proof|skeptic|objection|time|complex)\b/.test(value)) {
    return "OBJECTION";
  }
  if (/\b(cannot|can't|struggle|lack|need|want|slow|inefficient|inconsistent|poor|problem)\b/.test(value)) {
    return "CORE_PURCHASE";
  }
  return "SUPPORTING";
}

function values(value: any): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw.map((item) => {
    if (typeof item === "string") return item;
    return item?.uid ?? item?.evidenceUid ?? item?.id ?? item?.signalId ?? "";
  }).filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function buildAudiencePainRegistry(
  pains: any[],
  lineage: { accountId: string; audienceSnapshotId: string },
): AuthoritativeAudiencePain[] {
  return pains.map((raw, index) => {
    const canonical = painText(raw);
    const classification = (raw?.classification && Object.hasOwn(USES_BY_CLASS, raw.classification))
      ? raw.classification as AudiencePainClass
      : classifyAudiencePain(canonical);
    const evidenceUids = values(raw?.evidenceUids ?? raw?.evidence ?? raw?.groundingRefs);
    const sourceSignalIds = values(raw?.sourceSignalIds ?? raw?.signalIds ?? raw?.parentSignalId);
    const productFit = raw?.productFit === "INELIGIBLE" || raw?.productFit === "UNKNOWN"
      ? raw.productFit
      : "ELIGIBLE";
    const allowedUses = Array.isArray(raw?.allowedUses)
      ? raw.allowedUses.filter((use: unknown): use is PainUse => typeof use === "string" && (USES_BY_CLASS[classification] as string[]).includes(use))
      : USES_BY_CLASS[classification];
    return {
      painId: typeof raw?.painId === "string" ? raw.painId : stableId(lineage.audienceSnapshotId, canonical),
      canonical,
      classification,
      rank: Number.isFinite(raw?.rank) ? raw.rank : index + 1,
      productFit,
      eligible: raw?.eligible === false ? false : productFit === "ELIGIBLE" && canonical.length > 0,
      allowedUses,
      prohibitedUses: (Object.keys(USES_BY_CLASS) as AudiencePainClass[])
        .flatMap((kind) => USES_BY_CLASS[kind])
        .filter((use, position, all) => all.indexOf(use) === position && !allowedUses.includes(use)),
      evidenceUids,
      sourceSignalIds,
      lineage,
    };
  }).sort((a, b) => a.rank - b.rank);
}

export function selectPainForUse(pains: any[], use: PainUse): AuthoritativeAudiencePain | null {
  const registry = pains as AuthoritativeAudiencePain[];
  return registry.find((pain) => pain.eligible && pain.allowedUses.includes(use)) ?? null;
}

export function validateAudiencePainRegistry(
  pains: any,
  expected: { accountId: string; audienceSnapshotId: string },
): PainRegistryValidation {
  const issues: string[] = [];
  if (!Array.isArray(pains) || pains.length === 0) return { valid: false, issues: ["PAIN_REGISTRY_MISSING"] };
  const ids = new Set<string>();
  for (const pain of pains as AuthoritativeAudiencePain[]) {
    if (!pain?.painId || !pain?.canonical) issues.push("PAIN_ID_OR_TEXT_MISSING");
    if (ids.has(pain?.painId)) issues.push(`PAIN_ID_DUPLICATE:${pain.painId}`);
    ids.add(pain?.painId);
    if (pain?.lineage?.accountId !== expected.accountId || pain?.lineage?.audienceSnapshotId !== expected.audienceSnapshotId) {
      issues.push(`PAIN_LINEAGE_MISMATCH:${pain?.painId ?? "unknown"}`);
    }
    if (!Array.isArray(pain?.allowedUses) || pain.allowedUses.length === 0) issues.push(`PAIN_ALLOWED_USES_MISSING:${pain.painId}`);
    if (pain?.classification === "POST_PURCHASE_FRICTION" && pain.allowedUses.includes("offer_core")) {
      issues.push(`POST_PURCHASE_CORE_FORBIDDEN:${pain.painId}`);
    }
    if (pain?.eligible && pain.productFit !== "ELIGIBLE") issues.push(`PRODUCT_FIT_MISMATCH:${pain.painId}`);
  }
  return { valid: issues.length === 0, issues };
}