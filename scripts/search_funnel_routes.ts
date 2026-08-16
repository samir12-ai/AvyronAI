import * as fs from 'fs';

const path = 'C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/server/funnel-engine/routes.ts';
if (fs.existsSync(path)) {
  const content = fs.readFileSync(path, 'utf8');
  console.log("=== server/funnel-engine/routes.ts matches ===");
  content.split('\n').forEach((line, idx) => {
    if (line.toLowerCase().includes('objection')) {
      console.log(`  Line ${idx + 1}: ${line.trim()}`);
    }
  });
} else {
  console.log("routes.ts doesn't exist in funnel-engine");
}
process.exit(0);
