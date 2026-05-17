import { type Section, type OutputType, canSectionConsume, OutputTypeError, SECTIONS, OUTPUT_TYPES } from './output-types';

const SECTION_OUTPUT_MAP: Record<Section, readonly OutputType[]> = {
  AI_WRITER: ['CAPTION', 'METADATA'],
  AI_VIDEO: ['SCRIPT', 'SCENE_BREAKDOWN'],
  AI_DESIGNER: ['VISUAL_CONCEPT', 'POSTER_DESIGN'],
  STUDIO: ['METADATA', 'CREATIVE_ANALYSIS'],
  AUTOPILOT: ['PERFORMANCE_SIGNAL', 'STRATEGY_SECTION'],
  DASHBOARD: ['PERFORMANCE_SIGNAL', 'METADATA'],
  BUILD_A_PLAN: ['STRATEGY_SECTION', 'DISTRIBUTION_PLAN', 'CREATIVE_ANALYSIS', 'PERFORMANCE_SIGNAL'],
};

export function resolveOutputDestination(outputType: OutputType): Section[] {
  if (!OUTPUT_TYPES.includes(outputType)) {
    throw new OutputTypeError(`Unknown output type: ${outputType}`);
  }
  const destinations: Section[] = [];
  for (const section of SECTIONS) {
    if (canSectionConsume(section, outputType)) {
      destinations.push(section);
    }
  }
  return destinations;
}

export function validateExecutionRoute(
  source: Section,
  destination: Section,
  outputType: OutputType
): void {
  if (!SECTIONS.includes(source)) {
    throw new OutputTypeError(`Unknown source section: ${source}`);
  }
  if (!SECTIONS.includes(destination)) {
    throw new OutputTypeError(`Unknown destination section: ${destination}`);
  }
  if (!OUTPUT_TYPES.includes(outputType)) {
    throw new OutputTypeError(`Unknown output type: ${outputType}`);
  }

  const sourceCanProduce = SECTION_OUTPUT_MAP[source];
  if (!sourceCanProduce.includes(outputType)) {
    throw new OutputTypeError(
      `Source "${source}" does not produce output type "${outputType}". ` +
      `It produces: [${sourceCanProduce.join(', ')}]`
    );
  }

  if (!canSectionConsume(destination, outputType)) {
    throw new OutputTypeError(
      `Destination "${destination}" cannot consume output type "${outputType}" from "${source}". ` +
      `Route blocked — no silent conversion allowed.`
    );
  }
}

export function getValidRoutesForOutput(outputType: OutputType): Array<{ source: Section; destination: Section }> {
  const routes: Array<{ source: Section; destination: Section }> = [];
  for (const source of SECTIONS) {
    if (!SECTION_OUTPUT_MAP[source].includes(outputType)) continue;
    for (const destination of SECTIONS) {
      if (canSectionConsume(destination, outputType)) {
        routes.push({ source, destination });
      }
    }
  }
  return routes;
}
