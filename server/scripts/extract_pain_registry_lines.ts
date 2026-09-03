import fs from 'fs';

async function main() {
  const logPath = 'C:\\Users\\mahmo\\.gemini\\antigravity\\brain\\30f73e45-fa5f-494f-a081-d3bd1645b3b1\\.system_generated\\tasks\\task-6537.log';
  const logContent = fs.readFileSync(logPath, 'utf8');
  const lines = logContent.split('\n');

  console.log("=== LINES 180 TO 215 ===");
  for (let i = 180; i < Math.min(215, lines.length); i++) {
    console.log(`[L${i+1}] ${lines[i]}`);
  }
}

main();
