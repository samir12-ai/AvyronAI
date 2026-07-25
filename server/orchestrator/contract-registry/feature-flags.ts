/**
 * Phase C2/C4 — Engine contract enforcement feature flag.
 *
 * Extracted to its own module so consumers (snapshot-reuse, audit, future
 * gates) can use a static import without pulling in the full registry +
 * helpers graph. Avoids the circular-import dance the previous dynamic
 * `await import("./contract-registry")` was working around.
 *
 * Read once at module load. Treat anything other than the literal string
 * "true" as false — including unset / "1" / "yes" — so accidental truthy
 * config doesn't enable enforcement before C4.
 */
export const ENFORCE_ENGINE_CONTRACTS: boolean =
  String(process.env.ENFORCE_ENGINE_CONTRACTS ?? "").toLowerCase() === "true";
