/**
 * Task #92 / Phase 4-D — result-assembly SCAFFOLD.
 *
 * Final-results assembly extraction is deferred to Phase 4-E. The
 * module exists so OD-1 (single-persist) has a future call site to
 * anchor against. See README.md.
 */

export interface ResultAssemblyInput {
  jobId: string;
}

export interface ResultAssemblyOutput {
  jobId: string;
  planId: string | null;
}

export const RESULT_ASSEMBLY_MODULE_ID = "result-assembly";

export function runResultAssembly(_input: ResultAssemblyInput): Promise<ResultAssemblyOutput> {
  throw new Error(
    `[${RESULT_ASSEMBLY_MODULE_ID}] SCAFFOLD_NOT_WIRED — deferred to Phase 4-E. ` +
      `OD-1 single-persist will land here; this module is a placeholder only.`,
  );
}
