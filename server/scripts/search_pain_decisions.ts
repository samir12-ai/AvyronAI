import fs from 'fs';

async function main() {
  const logPath = 'C:\\Users\\mahmo\\.gemini\\antigravity\\brain\\30f73e45-fa5f-494f-a081-d3bd1645b3b1\\.system_generated\\tasks\\task-6826.log';
  const logContent = fs.readFileSync(logPath, 'utf8');
  const lines = logContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes("strategic_pain_pipeline_v3") || l.includes("PAIN_DECISION") || l.includes("classification") || l.includes("seg_3_pain_1")) {
      console.log(`[L${i+1}] ${l.slice(0, 200)}`);
    }
  }
}

main();
