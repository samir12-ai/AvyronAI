/**
 * Canonical Provider Registry Compatibility Re-export
 *
 * Single authority resides at server/competitive-intelligence/provider-registry.ts.
 * This re-export ensures all consumers importing from server/acquisition/provider-registry
 * resolve to the exact same canonical implementation.
 */
export * from "../competitive-intelligence/provider-registry";
