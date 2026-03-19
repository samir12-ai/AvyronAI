import { runOrchestrator } from "../orchestrator/index";
import type { OrchestratorConfig, AgentProgressEvent } from "../orchestrator/index";
import { summarizeEngine } from "./summarizers";
import type { EngineId } from "../orchestrator/priority-matrix";

export interface AgentStreamEvent {
  type: "started" | "engine_progress" | "done" | "error";
  campaignId?: string;
  totalEngines?: number;
  engineId?: EngineId;
  engineName?: string;
  tier?: string;
  status?: string;
  engineIndex?: number;
  durationMs?: number;
  summary?: string;
  blockReason?: string;
  planId?: string;
  completedEngines?: string[];
  failedEngine?: string;
  overallStatus?: string;
  error?: string;
}

export class AgentOperator {
  async runWithStream(
    config: Omit<OrchestratorConfig, "onProgress">,
    send: (event: AgentStreamEvent) => void
  ): Promise<void> {
    const result = await runOrchestrator({
      ...config,
      onProgress: (evt: AgentProgressEvent) => {
        const summary = summarizeEngine(evt.engineId, evt.output, evt.status, evt.blockReason);
        send({
          type: "engine_progress",
          engineId: evt.engineId,
          engineName: evt.engineName,
          tier: evt.tier,
          status: evt.status,
          engineIndex: evt.engineIndex,
          totalEngines: evt.totalEngines,
          durationMs: evt.durationMs,
          summary,
          blockReason: evt.blockReason,
        });
      },
    });

    send({
      type: "done",
      overallStatus: result.status,
      planId: result.planId,
      completedEngines: result.completedEngines,
      failedEngine: result.failedEngine,
      blockReason: result.blockReason,
      durationMs: result.durationMs,
    });
  }
}
