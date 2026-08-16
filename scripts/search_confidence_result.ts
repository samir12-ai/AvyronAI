import * as fs from 'fs';

function findConfidence() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/market-intelligence-v3/types.ts', 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('interface ConfidenceResult') || line.includes('ConfidenceResult =')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
      for (let i = 1; i <= 20; i++) {
        console.log(`  Line ${idx + 1 + i}: ${lines[idx + i]}`);
      }
    }
  });
}
findConfidence();
process.exit(0);
