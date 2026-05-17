/**
 * Task #89 / Phase 4-A — content-addressing helpers.
 *
 * Stable SHA-256 over a canonical JSON encoding (keys sorted recursively).
 * Used to:
 *   - Compute `cassetteHash` (content address of the cassette body).
 *   - Key the strict LLM-mock lookup by prompt content.
 *   - Compute `finalPlanHash` / `finalVerdictHash` for divergence comparison.
 */
import { createHash } from "node:crypto";

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortDeep(obj[k]);
  return out;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashValue(value: unknown): string {
  return sha256Hex(canonicalJsonStringify(value));
}
