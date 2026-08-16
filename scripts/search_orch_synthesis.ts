import * as fs from 'fs';

const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/orchestrator/index.ts', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('synthesizePlan')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
    for (let i = idx - 5; i <= idx + 15; i++) {
      console.log(`  ${i + 1}: ${lines[i]}`);
    }
  }
});
process.exit(0);
