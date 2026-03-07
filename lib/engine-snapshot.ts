export type EngineName = "mi" | "audience" | "positioning";

export interface NormalizedSnapshot {
  snapshot: any;
  output: any;
  metadata: {
    id: string | null;
    campaignId: string | null;
    createdAt: string | null;
    engineVersion: number | null;
    status: string | null;
    engine: EngineName;
  };
}

export function normalizeEngineSnapshot(
  response: any,
  engine: EngineName
): NormalizedSnapshot | null {
  if (!response) return null;

  if (engine === "mi") {
    const snap = response.snapshot || response;
    const output = response.output || response.analysisOutput || null;
    if (!snap?.id) return null;
    return {
      snapshot: snap,
      output,
      metadata: {
        id: snap.id,
        campaignId: snap.campaignId || null,
        createdAt: snap.createdAt || null,
        engineVersion: snap.analysisVersion ?? snap.version ?? null,
        status: snap.status || response.snapshotStatus || null,
        engine: "mi",
      },
    };
  }

  if (engine === "audience") {
    if (!response.id) return null;
    return {
      snapshot: response,
      output: response,
      metadata: {
        id: response.id,
        campaignId: response.campaignId || null,
        createdAt: response.createdAt || null,
        engineVersion: response.engineVersion || null,
        status: response.status || null,
        engine: "audience",
      },
    };
  }

  if (engine === "positioning") {
    if (!response) return null;
    const snap = response.snapshot || response;
    if (!snap?.id) return null;
    return {
      snapshot: snap,
      output: snap,
      metadata: {
        id: snap.id,
        campaignId: snap.campaignId || null,
        createdAt: snap.createdAt || null,
        engineVersion: snap.engineVersion || null,
        status: snap.status || null,
        engine: "positioning",
      },
    };
  }

  return null;
}

export function isEngineReady(
  normalized: NormalizedSnapshot | null,
  campaignId: string | null,
  engineState?: string | null
): boolean {
  if (!normalized || !normalized.metadata.id) return false;
  if (campaignId && normalized.metadata.campaignId !== campaignId) return false;
  if (engineState && engineState !== "READY") return false;
  return true;
}

export function getEngineStatusColor(ready: boolean): { color: string; icon: "checkmark-circle" | "close-circle" | "ellipse-outline" } {
  return ready
    ? { color: "#10B981", icon: "checkmark-circle" }
    : { color: "#EF4444", icon: "close-circle" };
}
