import * as fs from 'fs';

function findDate() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/components/CompetitiveIntelligence.tsx', 'utf8');
  const lines = content.split('\n');
  console.log("=== DATE FILTER REFERENCES IN UI ===");
  lines.forEach((line, idx) => {
    if (line.includes('day') || line.includes('window') || line.includes('Window') || line.includes('Days')) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  });
}
findDate();
process.exit(0);
