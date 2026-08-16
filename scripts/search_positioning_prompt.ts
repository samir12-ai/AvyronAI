import * as fs from 'fs';

const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/positioning-engine/engine.ts', 'utf8');
const lines = content.split('\n');

console.log("Searching positioning prompt in engine.ts:");
lines.forEach((l, idx) => {
  if (l.includes('const prompt =') || l.includes('`You are a') || l.includes('Positioning prompt') || l.includes('const userPrompt =')) {
    if (idx > 2400) {
      console.log(`${idx + 1}: ${l.trim().substring(0, 120)}`);
    }
  }
});
process.exit(0);
