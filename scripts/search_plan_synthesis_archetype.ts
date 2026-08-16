import * as fs from 'fs';

const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/orchestrator/plan-synthesis.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('archetype') || line.includes('checkPlanReadiness') || line.includes('resolveArchetype')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
process.exit(0);
