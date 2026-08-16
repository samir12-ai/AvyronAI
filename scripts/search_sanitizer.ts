import * as fs from 'fs';
import * as path from 'path';

function findFile(dir: string, name: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules') {
        findFile(fullPath, name);
      }
    } else if (file.toLowerCase().includes(name.toLowerCase())) {
      console.log(`Found: ${fullPath}`);
    }
  }
}

findFile('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI', 'text-sanitizer');
process.exit(0);
