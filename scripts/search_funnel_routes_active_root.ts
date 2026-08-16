import * as fs from 'fs';

const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/funnel-engine/routes.ts', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('getActiveRoot')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
process.exit(0);
