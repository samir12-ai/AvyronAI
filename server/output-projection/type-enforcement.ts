import { type Section, type OutputType, canSectionConsume, OutputTypeError, OUTPUT_TYPES } from './output-types';
import type { EngineOutput } from './engine-contract';

const HARD_REJECT_RULES: Array<{
  section: Section;
  rejectedTypes: OutputType[];
  reason: string;
}> = [
  {
    section: 'AI_WRITER',
    rejectedTypes: ['SCRIPT', 'SCENE_BREAKDOWN', 'VISUAL_CONCEPT', 'POSTER_DESIGN'],
    reason: 'AI Writer cannot process video or design outputs',
  },
  {
    section: 'AI_VIDEO',
    rejectedTypes: ['CAPTION', 'POSTER_DESIGN', 'VISUAL_CONCEPT'],
    reason: 'AI Video cannot process caption-only or design outputs',
  },
  {
    section: 'AI_DESIGNER',
    rejectedTypes: ['SCRIPT', 'SCENE_BREAKDOWN', 'CAPTION'],
    reason: 'AI Designer cannot process script/scene or caption outputs',
  },
  {
    section: 'STUDIO',
    rejectedTypes: ['SCRIPT', 'SCENE_BREAKDOWN', 'CAPTION', 'STRATEGY_SECTION', 'DISTRIBUTION_PLAN'],
    reason: 'Studio cannot process raw creation or strategy outputs',
  },
  {
    section: 'AUTOPILOT',
    rejectedTypes: ['CAPTION', 'SCRIPT', 'SCENE_BREAKDOWN', 'VISUAL_CONCEPT', 'POSTER_DESIGN'],
    reason: 'Autopilot cannot process raw creation outputs',
  },
  {
    section: 'DASHBOARD',
    rejectedTypes: ['CAPTION', 'SCRIPT', 'SCENE_BREAKDOWN', 'VISUAL_CONCEPT', 'POSTER_DESIGN', 'STRATEGY_SECTION', 'DISTRIBUTION_PLAN'],
    reason: 'Dashboard cannot process creation or strategy outputs directly',
  },
];

export function enforceOutputType(section: Section, data: EngineOutput): void {
  const outputType = data.outputType;

  if (!OUTPUT_TYPES.includes(outputType)) {
    throw new OutputTypeError(`Invalid output type "${outputType}" — not in canonical list`);
  }

  const rule = HARD_REJECT_RULES.find(r => r.section === section);
  if (rule && rule.rejectedTypes.includes(outputType)) {
    throw new OutputTypeError(
      `HARD REJECT: ${section} received "${outputType}" output. ${rule.reason}. ` +
      `This is a cross-branch contamination violation.`
    );
  }

  if (!canSectionConsume(section, outputType)) {
    throw new OutputTypeError(
      `Section "${section}" is not authorized to consume output type "${outputType}". ` +
      `No silent conversion allowed.`
    );
  }
}

export function enforceOutputBatch(section: Section, outputs: EngineOutput[]): void {
  for (const output of outputs) {
    enforceOutputType(section, output);
  }
}
