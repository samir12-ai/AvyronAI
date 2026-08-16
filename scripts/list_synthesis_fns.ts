import * as fs from 'fs';

function findFunctions() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/orchestrator/plan-synthesis.ts', 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('export async function') || line.includes('function ') && !line.includes('//')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  });
}
findFunctions();
process.exit(0);
