import * as fs from 'fs';
import * as path from 'path';

const dir = 'C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/lead-engine';
fs.readdirSync(dir).forEach(file => {
  const fullPath = path.join(dir, file);
  if (fs.statSync(fullPath).isFile() && file.endsWith('.ts')) {
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.toLowerCase().includes('objection')) {
      console.log(`Found in ${file}`);
      content.split('\n').forEach((line, idx) => {
        if (line.toLowerCase().includes('objection')) {
          console.log(`  Line ${idx + 1}: ${line.trim()}`);
        }
      });
    }
  }
});
process.exit(0);
