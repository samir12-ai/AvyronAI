import * as fs from 'fs';

function findTitles() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/components/CompetitiveIntelligence.tsx', 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('AVYRON') || line.includes('Market Intelligence') || line.includes('Intelligence') || line.includes('fontFamily:')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  });
}
findTitles();
process.exit(0);
