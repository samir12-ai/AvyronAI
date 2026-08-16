import * as fs from 'fs';
import * as path from 'path';

function searchDir(dir: string) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        searchDir(fullPath);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('writeProductAnchorAudited')) {
        console.log(`Matching file: ${fullPath}`);
      }
    }
  });
}

searchDir('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI');
process.exit(0);
