/**
 * Canonical Clock & Reporting Timezone Helper for Performance Loop.
 *
 * Allows isolated fixture tests and controlled-clock verification to advance time
 * deterministically without mutating real campaign reporting window dates.
 */

const campaignClockOverrides = new Map<string, Date>();

/**
 * Sets or clears a controlled clock override for an isolated test/fixture campaign.
 * Refuses to override the clock for the live Songai campaign (`camp_ac86e8b8-55b`).
 */
export function setCampaignClockOverride(campaignId: string, now: Date | string | null): Date | null {
  if (!campaignId) return null;
  if (campaignId === "camp_ac86e8b8-55b") {
    throw new Error("Controlled clock override is prohibited on live campaign camp_ac86e8b8-55b.");
  }
  if (now === null || now === undefined || now === "") {
    campaignClockOverrides.delete(campaignId);
    return null;
  }
  const parsed = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid clock override timestamp: ${String(now)}`);
  }
  campaignClockOverrides.set(campaignId, parsed);
  return new Date(parsed.getTime());
}

export function getCampaignClockOverride(campaignId?: string | null): Date | null {
  if (!campaignId) return null;
  const existing = campaignClockOverrides.get(campaignId);
  return existing ? new Date(existing.getTime()) : null;
}

export function clearAllCampaignClockOverrides(): void {
  campaignClockOverrides.clear();
}

/**
 * Resolves the effective timestamp (`now`) for a campaign operation:
 * 1. Explicit `nowOverride` argument if provided.
 * 2. Request-level override (`req.body.__nowOverride`, `req.query.nowOverride`, `x-avyron-now-override`), except on live Songai.
 * 3. Per-campaign controlled clock override if set for an isolated fixture campaign.
 * 4. System wall clock (`new Date()`).
 */
export function resolveEffectiveNow(
  campaignId?: string | null,
  explicitNow?: Date | string | null,
  req?: any
): Date {
  if (explicitNow instanceof Date && !Number.isNaN(explicitNow.getTime())) {
    return new Date(explicitNow.getTime());
  }
  if (typeof explicitNow === "string" && explicitNow.trim() !== "") {
    const parsed = new Date(explicitNow);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  if (req && campaignId !== "camp_ac86e8b8-55b") {
    const rawFromReq =
      req.body?.__nowOverride ||
      req.query?.nowOverride ||
      req.headers?.["x-avyron-now-override"] ||
      null;
    if (rawFromReq) {
      const parsed = new Date(String(rawFromReq));
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  if (campaignId && campaignId !== "camp_ac86e8b8-55b") {
    const mapped = campaignClockOverrides.get(campaignId);
    if (mapped) return new Date(mapped.getTime());
  }

  return new Date();
}

/**
 * Resolves a campaign's canonical IANA reporting timezone from its configured location string.
 */
export function resolveCampaignReportingTimezone(campaignLocation?: string | null): string {
  const loc = String(campaignLocation || "").trim();
  if (!loc) return "Asia/Dubai";
  const lower = loc.toLowerCase();
  if (lower.includes("emirates") || lower.includes("dubai") || lower.includes("abu dhabi") || lower.includes("uae")) {
    return "Asia/Dubai";
  }
  if (lower.includes("saudi") || lower.includes("riyadh") || lower.includes("jeddah") || lower.includes("ksa")) {
    return "Asia/Riyadh";
  }
  if (lower.includes("qatar") || lower.includes("doha")) {
    return "Asia/Qatar";
  }
  if (lower.includes("kuwait")) {
    return "Asia/Kuwait";
  }
  if (lower.includes("bahrain")) {
    return "Asia/Bahrain";
  }
  if (lower.includes("oman") || lower.includes("muscat")) {
    return "Asia/Muscat";
  }
  if (lower.includes("united kingdom") || lower.includes("london") || lower === "uk") {
    return "Europe/London";
  }
  if (lower.includes("new york") || lower.includes("united states") || lower === "usa" || lower === "us") {
    return "America/New_York";
  }
  // If already a valid IANA timezone identifier
  try {
    Intl.DateTimeFormat("en-US", { timeZone: loc });
    return loc;
  } catch {
    return "UTC";
  }
}

export function formatDateInReportingTimezone(
  dateInput: Date | string | null | undefined,
  timezone: string = "Asia/Dubai",
  includeTime: boolean = false
): string {
  if (!dateInput) return "—";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
