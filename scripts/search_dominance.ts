import * as fs from 'fs';
import * as path from 'path';

function searchDominance() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/market-intelligence-v3/dominance-engine.ts', 'utf8');
  const lines = content.split('\n');
  console.log("=== computeDominanceForCompetitor IN DOMINANCE ENGINE ===");
  lines.forEach((line, idx) => {
    if (line.includes('function computeDominanceForCompetitor') || line.includes('computeDominanceForCompetitor =')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
      for (let i = 1; i <= 40; i++) {
        console.log(`  Line ${idx + 1 + i}: ${lines[idx + i]}`);
      }
    }
  });
}
searchDominance();
process.exit(0);
