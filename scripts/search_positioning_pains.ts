import * as fs from 'fs';

const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/positioning-engine/engine.ts', 'utf8');
const lines = content.split('\n');

console.log("Searching entire positioning engine.ts:");
lines.forEach((l, idx) => {
  if (l.includes('painRegistry') || l.includes('selectPain') || l.includes('posSelectedPain') || l.includes('strategicLanes') || l.includes('lanes')) {
    console.log(`${idx + 1}: ${l.trim().substring(0, 120)}`);
  }
});
process.exit(0);
