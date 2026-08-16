import * as fs from 'fs';

const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/orchestrator/plan-synthesis.ts', 'utf8');
const lines = content.split('\n');

function show(start: number, end: number) {
  console.log(`=== Lines ${start}-${end} ===`);
  for (let i = start - 1; i < end; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
}

show(410, 440);
show(608, 620);
show(850, 870);
process.exit(0);
