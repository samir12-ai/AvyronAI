/**
 * Canonical UTC-first timestamp normalization and window comparison utilities.
 *
 * Ensures that naive PostgreSQL `timestamp without time zone` strings
 * (e.g. "2026-04-12 08:23:16.592"), ISO-8601 strings with or without offsets,
 * Unix epoch seconds/milliseconds, and Date instances always resolve to the
 * exact same UTC instant across UTC and Asia/Dubai (UTC+04:00) without double
 * conversion.
 */

const EXPLICIT_TZ_SUFFIX_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_EPOCH_RE = /^-?\d+(?:\.\d+)?$/;

export function normalizeTimestampToUtcDate(
  input: Date | string | number | null | undefined
): Date | null {
  if (input === null || input === undefined || input === "") {
    return null;
  }

  if (input instanceof Date) {
    const ms = input.getTime();
    return Number.isNaN(ms) ? null : new Date(ms);
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // Distinguish Unix epoch seconds (1e9..1e11) from milliseconds
    const ms = Math.abs(input) >= 1e9 && Math.abs(input) < 1e11 ? Math.round(input * 1000) : input;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (NUMERIC_EPOCH_RE.test(trimmed)) {
      const num = Number(trimmed);
      return normalizeTimestampToUtcDate(num);
    }

    if (DATE_ONLY_RE.test(trimmed)) {
      const d = new Date(`${trimmed}T00:00:00.000Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // Normalize space separator between date and time ("YYYY-MM-DD HH:mm:ss..." -> "YYYY-MM-DDTHH:mm:ss...")
    let normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, "$1T$2");
    // Normalize short offset "+00" or "+04" to "+00:00" / "+04:00"
    normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");

    if (!EXPLICIT_TZ_SUFFIX_RE.test(normalized) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) {
      normalized = `${normalized}Z`;
    }

    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export function normalizeTimestampToIsoUtc(
  input: Date | string | number | null | undefined
): string | null {
  const d = normalizeTimestampToUtcDate(input);
  return d ? d.toISOString() : null;
}

export function isTimestampWithinWindow(
  timestamp: Date | string | number | null | undefined,
  windowStart?: Date | string | number | null,
  windowEnd?: Date | string | number | null
): boolean {
  const ts = normalizeTimestampToUtcDate(timestamp);
  if (!ts) return false;
  const tsMs = ts.getTime();

  if (windowStart !== undefined && windowStart !== null) {
    const start = normalizeTimestampToUtcDate(windowStart);
    if (start && tsMs < start.getTime()) {
      return false;
    }
  }

  if (windowEnd !== undefined && windowEnd !== null) {
    const end = normalizeTimestampToUtcDate(windowEnd);
    if (end && tsMs > end.getTime()) {
      return false;
    }
  }

  return true;
}

export function formatTimestampInTimezone(
  input: Date | string | number | null | undefined,
  timeZone: string = "UTC"
): string | null {
  const d = normalizeTimestampToUtcDate(input);
  if (!d) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const rawOffset = get("timeZoneName").replace(/^GMT/, "") || "+00:00";
  const offset =
    rawOffset === "" || rawOffset === "+0" || rawOffset === "+00:00"
      ? "Z"
      : /^[+-]\d{1,2}$/.test(rawOffset)
      ? `${rawOffset[0]}${rawOffset.slice(1).padStart(2, "0")}:00`
      : rawOffset;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}${offset}`;
}
