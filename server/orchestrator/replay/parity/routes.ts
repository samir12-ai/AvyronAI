/**
 * Task #91 / Phase 4-C — Routing-table loader.
 *
 * The `divergence_class_routes` table is the canonical source of truth
 * for how a given `DivergenceClass` is routed. The table is seeded by
 * migration 028 with the default NOISE/INFO/WARN/BLOCK mapping. The
 * operator may `UPDATE divergence_class_routes` to retune without
 * redeploy — the parity job re-reads the table on every tick.
 *
 * D5: missing row → `RoutingTableIncompleteError` propagated through the
 * classifier. NEVER silently substitute a default.
 */
import { pool } from "../../../db";
import type { DivergenceClass } from "../types";
import type { DivergenceRoutingTable, RoutedAction } from "./types";

const ALL_CLASSES: DivergenceClass[] = [
  "STRUCTURAL",
  "CANONICAL_FIELD",
  "DEGRADATION_SURFACE",
  "BUDGET_LEDGER",
  "PROVENANCE",
  "ORDER",
  "TIMING_ONLY",
];

export async function loadRoutingTable(): Promise<DivergenceRoutingTable> {
  const res = await pool.query<{ divergence_class: string; action: string }>(
    `SELECT divergence_class, action FROM divergence_class_routes`,
  );
  const table: Partial<Record<DivergenceClass, RoutedAction>> = {};
  for (const row of res.rows) {
    if (!(ALL_CLASSES as string[]).includes(row.divergence_class)) continue;
    table[row.divergence_class as DivergenceClass] = row.action as RoutedAction;
  }
  // Validate completeness: missing entries collapse to CONTRACT_INCOMPLETE
  // at classifier time. We DO NOT silently fall back to a hard-coded
  // default here — the table IS the contract.
  return table as DivergenceRoutingTable;
}

/** Hard-coded fallback ONLY for the cold-boot path before migration 028
 *  has been applied. Used by tests; production paths must read the table. */
export const DEFAULT_ROUTING_TABLE: DivergenceRoutingTable = {
  STRUCTURAL: "BLOCK",
  CANONICAL_FIELD: "BLOCK",
  DEGRADATION_SURFACE: "WARN",
  BUDGET_LEDGER: "WARN",
  PROVENANCE: "INFO",
  ORDER: "INFO",
  TIMING_ONLY: "NOISE",
};
