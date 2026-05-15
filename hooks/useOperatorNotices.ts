import { useQuery } from "@tanstack/react-query";
import { fetch } from "expo/fetch";
import { getApiUrl } from "@/lib/query-client";

// Operations Guardian — operator notices hook. Mirrors the gate pattern
// used by useContinuityPanel + useOperationsPanel: self-disables when
// EXPO_PUBLIC_METRICS_ADMIN_TOKEN is unset (customer builds), so the
// section is invisible in non-operator builds.
//
// Strict-union types match the server-side enums in
// server/operations-guardian/types.ts. Anything outside the union is
// rejected at the prop boundary (D2/D3) — corrupt rows are dropped, not
// silently coerced.

export const NOTICE_SEVERITIES = [
  "info",
  "warning",
  "degraded",
  "critical",
] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

export const NOTICE_CATEGORIES = [
  "LEAKED_LOCK",
  "WORKER_STUCK",
  "RETRY_LOOP",
  "CHAIN_DEGRADED",
  "CHAIN_DEAD",
  "SCHEDULER_HEARTBEAT_DEAD",
  "MARKET_DATA_DEGRADED",
  "PLAN_DEGRADED",
  "SCRAPER_PROVIDER_DEGRADED",
  "AI_QUOTA_PRESSURE",
] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const NOTICE_AUDIENCES = ["internal", "operator", "user"] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

export interface OperatorNotice {
  id: string;
  category: NoticeCategory;
  severity: NoticeSeverity;
  audience: NoticeAudience;
  correlationKey: string;
  accountId: string | null;
  campaignId: string | null;
  copyKey: string;
  copyVars: Record<string, string | number> | null;
  detail: Record<string, unknown> | null;
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
  recoveryAttempted: boolean;
  recoveryOutcome: string | null;
}

export interface OperatorNoticesResponse {
  notices: OperatorNotice[];
  generatedAt: string;
}

function getAdminToken(): string | null {
  const t = process.env.EXPO_PUBLIC_METRICS_ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

export function operatorNoticesEnabled(): boolean {
  return getAdminToken() !== null;
}

// Severity color/label maps. Keep these aligned with the doctrine — these
// are the operator-facing colors only; user-facing surfaces (deferred)
// will use a different, softer palette.
export const SEVERITY_COLORS: Record<NoticeSeverity, string> = {
  critical: "#FF6B6B",
  degraded: "#FF9F43",
  warning: "#FFD166",
  info: "#06AED5",
};
export const SEVERITY_LABELS: Record<NoticeSeverity, string> = {
  critical: "CRITICAL",
  degraded: "DEGRADED",
  warning: "WARNING",
  info: "INFO",
};

// Category labels are operator-vocabulary on purpose (e.g. "Worker stuck",
// "Retry loop"). These MUST NEVER be reused for audience='user' surfaces.
// User copy, when it eventually ships, comes from USER_COPY in
// server/operations-guardian/types.ts via the copyKey field.
export const CATEGORY_LABELS: Record<NoticeCategory, string> = {
  LEAKED_LOCK: "Leaked lock",
  WORKER_STUCK: "Stuck worker",
  RETRY_LOOP: "Retry loop",
  CHAIN_DEGRADED: "Chain degraded",
  CHAIN_DEAD: "Chain dead",
  SCHEDULER_HEARTBEAT_DEAD: "Scheduler heartbeat dead",
  MARKET_DATA_DEGRADED: "Market data degraded",
  PLAN_DEGRADED: "Plan degraded",
  SCRAPER_PROVIDER_DEGRADED: "Scraper degraded",
  AI_QUOTA_PRESSURE: "AI quota pressure",
};

function isNoticeSeverity(v: unknown): v is NoticeSeverity {
  return (
    typeof v === "string" && (NOTICE_SEVERITIES as readonly string[]).includes(v)
  );
}
function isNoticeCategory(v: unknown): v is NoticeCategory {
  return (
    typeof v === "string" && (NOTICE_CATEGORIES as readonly string[]).includes(v)
  );
}
function isNoticeAudience(v: unknown): v is NoticeAudience {
  return (
    typeof v === "string" && (NOTICE_AUDIENCES as readonly string[]).includes(v)
  );
}

// Defensive validator. Corrupt rows from the wire are dropped (not
// coerced) so the UI never renders an unknown enum value.
function validateNotices(raw: unknown): OperatorNotice[] {
  if (!raw || typeof raw !== "object") return [];
  const arr = (raw as { notices?: unknown }).notices;
  if (!Array.isArray(arr)) return [];
  const out: OperatorNotice[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const n = r as Record<string, unknown>;
    if (
      typeof n.id !== "string" ||
      !isNoticeCategory(n.category) ||
      !isNoticeSeverity(n.severity) ||
      !isNoticeAudience(n.audience) ||
      typeof n.correlationKey !== "string" ||
      typeof n.copyKey !== "string"
    ) {
      continue;
    }
    out.push({
      id: n.id,
      category: n.category,
      severity: n.severity,
      audience: n.audience,
      correlationKey: n.correlationKey,
      accountId: typeof n.accountId === "string" ? n.accountId : null,
      campaignId: typeof n.campaignId === "string" ? n.campaignId : null,
      copyKey: n.copyKey,
      copyVars:
        n.copyVars && typeof n.copyVars === "object"
          ? (n.copyVars as Record<string, string | number>)
          : null,
      detail:
        n.detail && typeof n.detail === "object"
          ? (n.detail as Record<string, unknown>)
          : null,
      firstSeenAt: typeof n.firstSeenAt === "string" ? n.firstSeenAt : "",
      lastSeenAt: typeof n.lastSeenAt === "string" ? n.lastSeenAt : "",
      observationCount:
        typeof n.observationCount === "number" ? n.observationCount : 1,
      recoveryAttempted: n.recoveryAttempted === true,
      recoveryOutcome:
        typeof n.recoveryOutcome === "string" ? n.recoveryOutcome : null,
    });
  }
  return out;
}

export function useOperatorNotices() {
  const baseUrl = getApiUrl();
  const token = getAdminToken();
  return useQuery<OperatorNotice[]>({
    queryKey: ["operator-notices"],
    enabled: token !== null,
    refetchInterval: 60_000,
    queryFn: async () => {
      const url = new URL("/api/admin/operator-notices", baseUrl).toString();
      const res = await fetch(url, {
        headers: token ? { "X-Admin-Token": token } : {},
      });
      if (!res.ok) {
        throw new Error(`operator-notices ${res.status}`);
      }
      const json = (await res.json()) as unknown;
      return validateNotices(json);
    },
  });
}
