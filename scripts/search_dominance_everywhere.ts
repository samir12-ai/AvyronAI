import * as fs from 'fs';
import * as path from 'path';

function searchDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      searchDir(fullPath);
    } else if (file.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('computeDominanceForCompetitor') || content.includes('computeAllDominance')) {
        console.log(`Found in: ${fullPath}`);
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes('function computeDominanceForCompetitor') || line.includes('computeDominanceForCompetitor =') || line.includes('function computeAllDominance')) {
            console.log(`  Line ${idx + 1}: ${line.trim()}`);
            for (let i = 1; i <= 35; i++) {
              console.log(`    Line ${idx + 1 + i}: ${lines[idx + i]}`);
            }
          }
        });
      }
    }
  }
}

searchDir('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/market-intelligence-v3');
process.exit(0);
