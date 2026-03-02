import { type OutputType } from './output-types';
import { type EngineOutput, validateEngineOutput } from './engine-contract';
import { type StrategicContext } from './context-kernel';

export interface EngineDeclaration {
  id: string;
  name: string;
  eligibility: (ctx: StrategicContext) => boolean;
  supportedScopes: string[];
  supportedOutputTypes: OutputType[];
  execute?: (ctx: StrategicContext, input: any) => Promise<EngineOutput[]>;
}

export class EngineRegistryError extends Error {
  code: string;
  constructor(message: string, code: string = 'ENGINE_REGISTRY_ERROR') {
    super(message);
    this.name = 'EngineRegistryError';
    this.code = code;
  }
}

const AUTHORIZED_CALLERS = ['BUILD_A_PLAN_ORCHESTRATOR'] as const;
type AuthorizedCaller = (typeof AUTHORIZED_CALLERS)[number];

export class EngineRegistry {
  private engines: Map<string, EngineDeclaration> = new Map();
  private invocationLog: Array<{ engineId: string; timestamp: number; eligible: boolean; caller: string }> = [];

  register(engine: EngineDeclaration): void {
    if (this.engines.has(engine.id)) {
      throw new EngineRegistryError(`Engine "${engine.id}" is already registered`, 'DUPLICATE_ENGINE');
    }
    if (!engine.id || !engine.name) {
      throw new EngineRegistryError('Engine must have id and name', 'INVALID_ENGINE');
    }
    if (!engine.supportedOutputTypes || engine.supportedOutputTypes.length === 0) {
      throw new EngineRegistryError(`Engine "${engine.id}" must declare supportedOutputTypes`, 'MISSING_OUTPUT_TYPES');
    }
    if (!engine.supportedScopes || engine.supportedScopes.length === 0) {
      throw new EngineRegistryError(`Engine "${engine.id}" must declare supportedScopes`, 'MISSING_SCOPES');
    }
    this.engines.set(engine.id, engine);
  }

  getRegistered(): EngineDeclaration[] {
    return Array.from(this.engines.values());
  }

  getById(engineId: string): EngineDeclaration | undefined {
    return this.engines.get(engineId);
  }

  getEligible(context: StrategicContext): EngineDeclaration[] {
    const eligible: EngineDeclaration[] = [];
    for (const engine of this.engines.values()) {
      const isEligible = engine.eligibility(context);
      this.invocationLog.push({
        engineId: engine.id,
        timestamp: Date.now(),
        eligible: isEligible,
        caller: 'eligibility_check',
      });
      if (isEligible) {
        eligible.push(engine);
      }
    }
    return eligible;
  }

  async invoke(
    engineId: string,
    context: StrategicContext,
    input: any,
    caller: AuthorizedCaller
  ): Promise<EngineOutput[]> {
    if (!AUTHORIZED_CALLERS.includes(caller)) {
      throw new EngineRegistryError(
        `Unauthorized caller "${caller}". Only the Build a Plan orchestrator may invoke engines.`,
        'UNAUTHORIZED_CALLER'
      );
    }

    const engine = this.engines.get(engineId);
    if (!engine) {
      throw new EngineRegistryError(`Engine "${engineId}" not found in registry`, 'ENGINE_NOT_FOUND');
    }

    const isEligible = engine.eligibility(context);
    this.invocationLog.push({
      engineId,
      timestamp: Date.now(),
      eligible: isEligible,
      caller,
    });

    if (!isEligible) {
      console.log(`[EngineRegistry] Engine "${engineId}" skipped — eligibility check failed for campaign ${context.campaignId}`);
      return [];
    }

    if (!engine.execute) {
      throw new EngineRegistryError(
        `Engine "${engineId}" has no execute function registered`,
        'NO_EXECUTE_FUNCTION'
      );
    }

    const outputs = await engine.execute(context, input);

    for (const output of outputs) {
      validateEngineOutput(output);
      if (!engine.supportedOutputTypes.includes(output.outputType)) {
        throw new EngineRegistryError(
          `Engine "${engineId}" produced output type "${output.outputType}" which is not in its declared supportedOutputTypes: [${engine.supportedOutputTypes.join(', ')}]`,
          'OUTPUT_TYPE_MISMATCH'
        );
      }
    }

    return outputs;
  }

  getInvocationLog() {
    return [...this.invocationLog];
  }

  clearInvocationLog() {
    this.invocationLog = [];
  }
}

export const globalRegistry = new EngineRegistry();

export const ENGINE_DECLARATIONS: EngineDeclaration[] = [
  {
    id: 'caption-engine',
    name: 'Caption Engine',
    eligibility: (_ctx) => true,
    supportedScopes: ['campaign', 'post'],
    supportedOutputTypes: ['CAPTION', 'METADATA'],
  },
  {
    id: 'video-analysis-engine',
    name: 'Video Analysis Engine',
    eligibility: (_ctx) => true,
    supportedScopes: ['campaign', 'studio_item'],
    supportedOutputTypes: ['SCRIPT', 'SCENE_BREAKDOWN', 'CREATIVE_ANALYSIS'],
  },
  {
    id: 'studio-analysis-engine',
    name: 'Studio Analysis Engine',
    eligibility: (_ctx) => true,
    supportedScopes: ['campaign', 'studio_item'],
    supportedOutputTypes: ['METADATA', 'CREATIVE_ANALYSIS'],
  },
  {
    id: 'strategic-orchestrator',
    name: 'Strategic Orchestrator',
    eligibility: (_ctx) => true,
    supportedScopes: ['campaign'],
    supportedOutputTypes: ['STRATEGY_SECTION', 'DISTRIBUTION_PLAN'],
  },
  {
    id: 'autonomous-worker',
    name: 'Autonomous Worker',
    eligibility: (ctx) => ctx.dataConfidence >= 20,
    supportedScopes: ['campaign'],
    supportedOutputTypes: ['PERFORMANCE_SIGNAL', 'STRATEGY_SECTION'],
  },
];

for (const decl of ENGINE_DECLARATIONS) {
  globalRegistry.register(decl);
}
