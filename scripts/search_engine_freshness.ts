import * as fs from 'fs';

function findFreshness() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/market-intelligence-v3/engine.ts', 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('freshnessState')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  });
}
findFreshness();
process.exit(0);
