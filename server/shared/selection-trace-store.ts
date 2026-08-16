import fs from "fs/promises";
import path from "path";

export interface SelectionTrace {
  engineId: string;
  jobId: string;
  runId: string;
  selectionPoint: string;
  
  candidatePool: any[];
  eligibleCandidates: any[];
  rejectedCandidates: any[];
  
  winnerCandidateId: string | null;
  selectionStatus: "WINNER" | "CLOSE_ALTERNATIVES" | "NO_ELIGIBLE";
  decisionMargin: number;
  
  winnerReason: string;
  whyAlternativesLost: { candidateId: string; reason: string }[];
  
  semanticEntailmentResults?: { candidateId: string; result: string; reason?: string }[];
  productCapabilityChecks?: { candidateId: string; supported: boolean; reason?: string }[];
  comparativeJudgeVerdict?: string;
  
  frequencyContribution?: Record<string, number>;
  rankContribution?: Record<string, number>;
  timestamp: string;
}

const TRACE_DIR = path.join(__dirname, "../../uploads/selection_traces");

export async function persistSelectionTrace(trace: SelectionTrace): Promise<void> {
  try {
    await fs.mkdir(TRACE_DIR, { recursive: true });
    const filename = `${trace.runId}_${trace.engineId}_${trace.selectionPoint}.json`;
    const filepath = path.join(TRACE_DIR, filename);
    await fs.writeFile(filepath, JSON.stringify(trace, null, 2), "utf-8");
    console.log(`[SelectionTraceStore] Persisted trace for run=${trace.runId} engine=${trace.engineId} point=${trace.selectionPoint}`);
  } catch (err: any) {
    console.error(`[SelectionTraceStore] Failed to persist trace:`, err.message);
  }
}

export async function getSelectionTraces(runId: string): Promise<SelectionTrace[]> {
  try {
    await fs.mkdir(TRACE_DIR, { recursive: true });
    const files = await fs.readdir(TRACE_DIR);
    const runFiles = files.filter(f => f.startsWith(runId) && f.endsWith(".json"));
    const out: SelectionTrace[] = [];
    for (const f of runFiles) {
      const data = await fs.readFile(path.join(TRACE_DIR, f), "utf-8");
      out.push(JSON.parse(data));
    }
    return out;
  } catch (err: any) {
    console.error(`[SelectionTraceStore] Failed to load traces for run=${runId}:`, err.message);
    return [];
  }
}

export async function getSelectionTrace(runId: string, engineId: string): Promise<SelectionTrace | null> {
  try {
    await fs.mkdir(TRACE_DIR, { recursive: true });
    const files = await fs.readdir(TRACE_DIR);
    const file = files.find(f => f.startsWith(`${runId}_${engineId}_`) && f.endsWith(".json"));
    if (!file) return null;
    const data = await fs.readFile(path.join(TRACE_DIR, file), "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}
