import * as fs from 'fs';

try {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/scratch/orchestrator_loop.txt', 'utf16le');
  console.log(content.substring(0, 15000));
} catch (e: any) {
  console.error("Failed to read file as UTF-16LE:", e.message);
  try {
    const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/scratch/orchestrator_loop.txt', 'utf8');
    console.log(content.substring(0, 15000));
  } catch (e2: any) {
    console.error("Failed to read file as UTF-8:", e2.message);
  }
}
process.exit(0);
