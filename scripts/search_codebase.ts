import * as fs from 'fs';
import * as path from 'path';

const searchDir = 'C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server';
const term = process.argv[2] || 'generateWithRepair';

function search(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules') {
        search(fullPath);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(term)) {
        console.log(`Found in: ${fullPath}`);
        // print matching lines
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes(term)) {
            console.log(`  Line ${idx + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

console.log(`Searching for "${term}" in ${searchDir}...`);
search(searchDir);
process.exit(0);
