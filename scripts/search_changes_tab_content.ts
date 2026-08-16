import * as fs from 'fs';

function findChangesContent() {
  const content = fs.readFileSync('C:/Users/SFITELECOM FZCO/.gemini/antigravity/scratch/AvyronAI/components/CompetitiveIntelligence.tsx', 'utf8');
  const lines = content.split('\n');
  let startLine = -1;
  lines.forEach((line, idx) => {
    if (line.includes("activeView === 'changes'") || line.includes("renderChangesTab")) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
      if (startLine === -1) startLine = idx - 10;
    }
  });

  if (startLine !== -1) {
    console.log('\n--- Code Segment ---');
    for (let i = 0; i < 150; i++) {
      if (startLine + i < lines.length) {
        console.log(`${startLine + i + 1}: ${lines[startLine + i]}`);
      }
    }
  }
}
findChangesContent();
process.exit(0);
