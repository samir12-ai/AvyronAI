import * as fs from 'fs';

function findMissing() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/market-intelligence-v3/signal-engine.ts', 'utf8');
  const lines = content.split('\n');
  console.log("=== missingFields IN SIGNAL ENGINE ===");
  lines.forEach((line, idx) => {
    if (line.includes('missingFields')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  });
}
findMissing();
process.exit(0);
