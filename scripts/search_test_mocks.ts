import * as fs from 'fs';
import * as path from 'path';

const dir = 'C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/tests';
const files = fs.readdirSync(dir);

files.forEach(file => {
  if (file.endsWith('.test.ts')) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    if (content.includes('vi.mock')) {
      console.log(`File ${file} uses vi.mock`);
    }
  }
});
process.exit(0);
