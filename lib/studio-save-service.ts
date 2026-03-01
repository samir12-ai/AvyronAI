import { apiRequest } from "@/lib/query-client";
import { generateId } from "@/lib/storage";

export interface SaveToStudioParams {
  campaignId: string;
  accountId?: string;
  contentType: string;
  title: string;
  caption?: string;
  mediaUrl?: string;
  calendarEntryId?: string;
  engineName: string;
  generationId?: string;
}

export interface SaveToStudioResult {
  success: boolean;
  studioItemId: string | null;
  analysisStatus: string;
  idempotent: boolean;
  flagEnabled?: boolean;
  error?: string;
}

export async function saveToStudio(
  params: SaveToStudioParams
): Promise<SaveToStudioResult> {
  const generationId = params.generationId || generateId();

  const res = await apiRequest("POST", "/api/studio/items/save-and-analyze", {
    campaignId: params.campaignId,
    accountId: params.accountId || "default",
    contentType: params.contentType,
    title: params.title,
    caption: params.caption || null,
    mediaUrl: params.mediaUrl || null,
    calendarEntryId: params.calendarEntryId || null,
    generationId,
    origin: "AI_CREATION",
    engineName: params.engineName,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Unknown server error" }));
    throw new Error(errorData.error || errorData.message || `Save failed (HTTP ${res.status})`);
  }

  const data = await res.json();

  if (!data.success || !data.studioItemId) {
    throw new Error(data.error || data.message || "Server did not confirm save.");
  }

  return {
    success: true,
    studioItemId: data.studioItemId,
    analysisStatus: data.analysisStatus ?? "NONE",
    idempotent: data.idempotent ?? false,
    flagEnabled: data.flagEnabled,
    error: undefined,
  };
}
