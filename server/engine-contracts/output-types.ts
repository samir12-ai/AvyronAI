export const OUTPUT_TYPES = [
  'CAPTION',
  'SCRIPT',
  'SCENE_BREAKDOWN',
  'VISUAL_CONCEPT',
  'POSTER_DESIGN',
  'METADATA',
  'STRATEGY_SECTION',
  'PERFORMANCE_SIGNAL',
  'CREATIVE_ANALYSIS',
  'DISTRIBUTION_PLAN',
] as const;

export type OutputType = (typeof OUTPUT_TYPES)[number];

export const SECTIONS = [
  'AI_WRITER',
  'AI_VIDEO',
  'AI_DESIGNER',
  'STUDIO',
  'AUTOPILOT',
  'DASHBOARD',
  'BUILD_A_PLAN',
] as const;

export type Section = (typeof SECTIONS)[number];

const SECTION_CONSUMPTION_MATRIX: Record<Section, readonly OutputType[]> = {
  AI_WRITER: ['CAPTION', 'METADATA'],
  AI_VIDEO: ['SCRIPT', 'SCENE_BREAKDOWN'],
  AI_DESIGNER: ['VISUAL_CONCEPT', 'POSTER_DESIGN'],
  STUDIO: ['METADATA', 'CREATIVE_ANALYSIS'],
  AUTOPILOT: ['PERFORMANCE_SIGNAL', 'STRATEGY_SECTION'],
  DASHBOARD: ['PERFORMANCE_SIGNAL', 'METADATA'],
  BUILD_A_PLAN: ['STRATEGY_SECTION', 'DISTRIBUTION_PLAN', 'CREATIVE_ANALYSIS', 'PERFORMANCE_SIGNAL'],
};

const SECTION_PRODUCTION_MATRIX: Record<Section, readonly OutputType[]> = {
  AI_WRITER: ['CAPTION', 'METADATA'],
  AI_VIDEO: ['SCRIPT', 'SCENE_BREAKDOWN'],
  AI_DESIGNER: ['VISUAL_CONCEPT', 'POSTER_DESIGN'],
  STUDIO: ['METADATA', 'CREATIVE_ANALYSIS'],
  AUTOPILOT: ['PERFORMANCE_SIGNAL', 'STRATEGY_SECTION'],
  DASHBOARD: ['PERFORMANCE_SIGNAL'],
  BUILD_A_PLAN: ['STRATEGY_SECTION', 'DISTRIBUTION_PLAN'],
};

export function canSectionConsume(section: Section, outputType: OutputType): boolean {
  const allowed = SECTION_CONSUMPTION_MATRIX[section];
  if (!allowed) return false;
  return allowed.includes(outputType);
}

export function validateSectionConsumption(section: Section, outputType: OutputType): void {
  if (!SECTIONS.includes(section)) {
    throw new OutputTypeError(`Unknown section: ${section}`);
  }
  if (!OUTPUT_TYPES.includes(outputType)) {
    throw new OutputTypeError(`Unknown output type: ${outputType}`);
  }
  if (!canSectionConsume(section, outputType)) {
    throw new OutputTypeError(
      `Section "${section}" cannot consume output type "${outputType}". ` +
      `Allowed types: [${SECTION_CONSUMPTION_MATRIX[section].join(', ')}]`
    );
  }
}

export function getConsumableOutputs(section: Section): readonly OutputType[] {
  if (!SECTIONS.includes(section)) {
    throw new OutputTypeError(`Unknown section: ${section}`);
  }
  return SECTION_CONSUMPTION_MATRIX[section];
}

export function getProducibleOutputs(section: Section): readonly OutputType[] {
  if (!SECTIONS.includes(section)) {
    throw new OutputTypeError(`Unknown section: ${section}`);
  }
  return SECTION_PRODUCTION_MATRIX[section];
}

export class OutputTypeError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = 'OutputTypeError';
    this.code = 'OUTPUT_TYPE_VIOLATION';
  }
}
