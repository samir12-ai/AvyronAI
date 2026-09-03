import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";
import fs from 'fs';

async function main() {
  const jobId = "orch_1787420716056_rbf142";

  // 1. Query positioning snapshot
  const posRes = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE job_id = ${jobId}`);
  const pos = posRes.rows[0] as any;
  console.log("=== POSITIONING SNAPSHOT ===");
  console.log("ID:", pos.id);
  console.log("Umbrella Position Name:", pos.umbrella_position_name);
  console.log("Contrast Axis:", pos.contrast_axis);
  console.log("Narrative Direction:", pos.narrative_direction);
  console.log("Enemy Definition:", pos.enemy_definition);
  console.log("Target Audience Text:", pos.target_audience);
  console.log("Strategic Gap:", pos.strategic_gap);
  console.log("Territories:", pos.territories);
  console.log("Differentiation Vector:", pos.differentiation_vector);

  // 2. Query mechanism snapshot
  const mechRes = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE job_id = ${jobId}`);
  const mech = mechRes.rows[0] as any;
  console.log("\n=== MECHANISM SNAPSHOT ===");
  console.log("ID:", mech.id);
  console.log("Primary Mechanism:", JSON.stringify(typeof mech.primary_mechanism === 'string' ? JSON.parse(mech.primary_mechanism) : mech.primary_mechanism, null, 2));

  // 3. Search task-6972.log for PositioningEngine prompt and judge
  const logPath = 'C:\\Users\\mahmo\\.gemini\\antigravity\\brain\\30f73e45-fa5f-494f-a081-d3bd1645b3b1\\.system_generated\\tasks\\task-6972.log';
  const logContent = fs.readFileSync(logPath, 'utf8');
  const lines = logContent.split('\n');

  console.log("\n=== LOG LINES AROUND POSITIONING & MECHANISM ===");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes("PositioningEngine") || l.includes("MechanismEngine") || l.includes("CategoryGame") || l.includes("StrategicCard") || l.includes("TERRITORY")) {
      console.log(`[L${i+1}] ${l}`);
    }
  }

  process.exit(0);
}

main();
