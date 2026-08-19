require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const campaignId = 'campaign_1786718877499_3jk4zv';
  const out = {};

  // STEP 1: Get the active plan
  const planRes = await pool.query(
    "SELECT id, version, status, plan_json, created_at, updated_at FROM strategic_plans WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1",
    [campaignId]
  );
  out.plan = planRes.rows[0];
  console.log("Plan ID:", out.plan.id, "Version:", out.plan.version, "Status:", out.plan.status);

  // Find the strategy root linked to this plan
  const rootRes = await pool.query(
    "SELECT * FROM strategy_roots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1",
    [campaignId]
  );
  out.root = rootRes.rows[0];
  console.log("Root ID:", out.root?.id);
  console.log("Root columns:", out.root ? Object.keys(out.root) : 'NONE');

  // STEP 2: Print raw strategy root fields
  if (out.root) {
    // Print every column and its type/length
    for (const [k, v] of Object.entries(out.root)) {
      if (v === null) {
        console.log(`  root.${k} = NULL`);
      } else if (typeof v === 'string' && v.length > 200) {
        console.log(`  root.${k} = [string, ${v.length} chars]`);
      } else if (typeof v === 'object') {
        const s = JSON.stringify(v);
        if (s.length > 200) {
          console.log(`  root.${k} = [object, ${s.length} chars]`);
        } else {
          console.log(`  root.${k} = ${s}`);
        }
      } else {
        console.log(`  root.${k} = ${v}`);
      }
    }
  }

  // STEP 3: Get audience snapshot linked to this root
  // First check if root has an audience_snapshot_id
  const audSnapId = out.root?.audience_snapshot_id;
  let audSnap;
  if (audSnapId) {
    const audRes = await pool.query("SELECT * FROM audience_snapshots WHERE id = $1", [audSnapId]);
    audSnap = audRes.rows[0];
  } else {
    // Fallback: get latest audience snapshot for campaign
    const audRes = await pool.query(
      "SELECT * FROM audience_snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1",
      [campaignId]
    );
    audSnap = audRes.rows[0];
  }
  out.audience = audSnap;

  if (audSnap) {
    console.log("\n--- AUDIENCE SNAPSHOT ---");
    console.log("Audience ID:", audSnap.id);
    for (const [k, v] of Object.entries(audSnap)) {
      if (v === null) {
        console.log(`  aud.${k} = NULL`);
      } else if (typeof v === 'string' && v.length > 300) {
        console.log(`  aud.${k} = [string, ${v.length} chars]`);
      } else if (typeof v === 'object') {
        const s = JSON.stringify(v);
        if (s.length > 300) {
          console.log(`  aud.${k} = [object/array, ${s.length} chars, type: ${Array.isArray(v) ? 'array('+v.length+')' : 'object('+Object.keys(v).length+' keys)'}]`);
        } else {
          console.log(`  aud.${k} = ${s}`);
        }
      } else {
        console.log(`  aud.${k} = ${v}`);
      }
    }
  }

  // STEP 4: Print ONE complete raw pain object
  if (audSnap && audSnap.audience_pains) {
    let pains = audSnap.audience_pains;
    if (typeof pains === 'string') pains = JSON.parse(pains);
    console.log("\n--- FIRST RAW PAIN OBJECT (COMPLETE) ---");
    console.log(JSON.stringify(pains[0], null, 2));
    console.log("\n--- ALL PAIN OBJECT KEYS ---");
    if (pains.length > 0) {
      console.log(Object.keys(pains[0]));
    }
    console.log("\nTotal pains:", pains.length);
    
    // Print each pain - try multiple possible text fields
    console.log("\n--- ALL PAINS ---");
    pains.forEach((p, i) => {
      const text = p.canonical || p.canonicalStatement || p.normalized_statement || p.normalizedStatement || p.originalStatement || p.original_statement || p.statement || p.pain || p.description || p.name || p.label || p.text || 'FIELD_NOT_FOUND';
      console.log(`  ${i+1}. ${text}`);
    });
  } else {
    console.log("\naudience_pains = NULL or MISSING");
  }

  // STEP 5: Print audience segments
  if (audSnap && audSnap.audience_segments) {
    let segs = audSnap.audience_segments;
    if (typeof segs === 'string') segs = JSON.parse(segs);
    console.log("\n--- AUDIENCE SEGMENTS ---");
    console.log("Total segments:", Array.isArray(segs) ? segs.length : typeof segs);
    if (Array.isArray(segs) && segs.length > 0) {
      console.log("First segment keys:", Object.keys(segs[0]));
      segs.forEach((s, i) => {
        console.log(`  ${i+1}. ${s.name || s.segment || s.label || JSON.stringify(s).substring(0,100)}`);
      });
    }
  }

  // STEP 6: Check strategy root for lanes
  if (out.root) {
    const laneFields = ['approved_lanes', 'approvedLanes', 'lanes', 'strategic_lanes', 'strategicLanes'];
    for (const f of laneFields) {
      if (out.root[f] !== undefined) {
        let val = out.root[f];
        if (typeof val === 'string') try { val = JSON.parse(val); } catch(e) {}
        console.log(`\n--- root.${f} ---`);
        if (Array.isArray(val)) {
          console.log(`Count: ${val.length}`);
          val.forEach((l, i) => {
            console.log(`  Lane ${i+1}:`, JSON.stringify(l).substring(0, 500));
          });
        } else if (val && typeof val === 'object') {
          console.log(JSON.stringify(val).substring(0, 2000));
        } else {
          console.log(val);
        }
      }
    }
    
    // Also check brand_spine / brandSpine
    const spineFields = ['brand_spine', 'brandSpine', 'spine'];
    for (const f of spineFields) {
      if (out.root[f] !== undefined && out.root[f] !== null) {
        console.log(`\n--- root.${f} ---`);
        const val = typeof out.root[f] === 'string' ? out.root[f].substring(0, 2000) : JSON.stringify(out.root[f]).substring(0, 2000);
        console.log(val);
      }
    }
  }

  // STEP 7: Get positioning snapshot
  const posSnapId = out.root?.positioning_snapshot_id;
  let posSnap;
  if (posSnapId) {
    const r = await pool.query("SELECT * FROM positioning_snapshots WHERE id = $1", [posSnapId]);
    posSnap = r.rows[0];
  } else {
    const r = await pool.query("SELECT * FROM positioning_snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1", [campaignId]);
    posSnap = r.rows[0];
  }
  out.positioning = posSnap;
  if (posSnap) {
    console.log("\n--- POSITIONING ---");
    console.log("territory:", typeof posSnap.territory === 'string' ? posSnap.territory.substring(0, 1000) : JSON.stringify(posSnap.territory)?.substring(0, 1000));
    console.log("enemy:", typeof posSnap.enemy_definition === 'string' ? posSnap.enemy_definition.substring(0, 500) : JSON.stringify(posSnap.enemy_definition)?.substring(0, 500));
    console.log("contrast_axis:", typeof posSnap.contrast_axis === 'string' ? posSnap.contrast_axis.substring(0, 500) : JSON.stringify(posSnap.contrast_axis)?.substring(0, 500));
    console.log("narrative_direction:", typeof posSnap.narrative_direction === 'string' ? posSnap.narrative_direction.substring(0, 500) : JSON.stringify(posSnap.narrative_direction)?.substring(0, 500));
    console.log("territories:", typeof posSnap.territories === 'string' ? posSnap.territories.substring(0, 1000) : JSON.stringify(posSnap.territories)?.substring(0, 1000));
  }

  // STEP 8: Get differentiation snapshot
  const diffSnapId = out.root?.differentiation_snapshot_id;
  let diffSnap;
  if (diffSnapId) {
    const r = await pool.query("SELECT * FROM differentiation_snapshots WHERE id = $1", [diffSnapId]);
    diffSnap = r.rows[0];
  } else {
    const r = await pool.query("SELECT * FROM differentiation_snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1", [campaignId]);
    diffSnap = r.rows[0];
  }
  out.differentiation = diffSnap;
  if (diffSnap) {
    console.log("\n--- DIFFERENTIATION ---");
    console.log("pillars:", typeof diffSnap.differentiation_pillars === 'string' ? diffSnap.differentiation_pillars.substring(0, 2000) : JSON.stringify(diffSnap.differentiation_pillars)?.substring(0, 2000));
    console.log("authority_mode:", diffSnap.authority_mode);
    console.log("mechanism_core:", typeof diffSnap.mechanism_core === 'string' ? diffSnap.mechanism_core.substring(0, 500) : JSON.stringify(diffSnap.mechanism_core)?.substring(0, 500));
  }

  // STEP 9: Get mechanism snapshot
  const mechSnapId = out.root?.mechanism_snapshot_id;
  let mechSnap;
  if (mechSnapId) {
    const r = await pool.query("SELECT * FROM mechanism_snapshots WHERE id = $1", [mechSnapId]);
    mechSnap = r.rows[0];
  } else {
    const r = await pool.query("SELECT * FROM mechanism_snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1", [campaignId]);
    mechSnap = r.rows[0];
  }
  out.mechanism = mechSnap;
  if (mechSnap) {
    console.log("\n--- MECHANISM ---");
    console.log("primary_mechanism:", typeof mechSnap.primary_mechanism === 'string' ? mechSnap.primary_mechanism.substring(0, 2000) : JSON.stringify(mechSnap.primary_mechanism)?.substring(0, 2000));
  }

  // STEP 10: Get offer snapshot
  const offSnapId = out.root?.offer_snapshot_id;
  let offSnap;
  if (offSnapId) {
    const r = await pool.query("SELECT * FROM offer_snapshots WHERE id = $1", [offSnapId]);
    offSnap = r.rows[0];
  } else {
    const r = await pool.query("SELECT * FROM offer_snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1", [campaignId]);
    offSnap = r.rows[0];
  }
  out.offer = offSnap;
  if (offSnap) {
    console.log("\n--- OFFER ---");
    console.log("primary_offer:", typeof offSnap.primary_offer === 'string' ? offSnap.primary_offer.substring(0, 3000) : JSON.stringify(offSnap.primary_offer)?.substring(0, 3000));
  }

  // STEP 11: Read Plan v8 plan_json
  if (out.plan && out.plan.plan_json) {
    let pj = out.plan.plan_json;
    if (typeof pj === 'string') pj = JSON.parse(pj);
    console.log("\n--- PLAN V8 plan_json ---");
    console.log("Top-level keys:", Object.keys(pj));
    for (const k of Object.keys(pj)) {
      const v = pj[k];
      if (typeof v === 'string') {
        console.log(`  ${k}: [string ${v.length} chars] "${v.substring(0, 200)}"`);
      } else if (Array.isArray(v)) {
        console.log(`  ${k}: [array ${v.length} items]`);
      } else if (v && typeof v === 'object') {
        console.log(`  ${k}: [object ${Object.keys(v).length} keys: ${Object.keys(v).join(', ')}]`);
      } else {
        console.log(`  ${k}: ${v}`);
      }
    }
  } else {
    console.log("\nPlan v8 plan_json = NULL");
  }

  // Write full raw dump
  fs.writeFileSync(
    'C:/Users/mahmo/.gemini/antigravity/brain/f336cf20-23bb-4ecf-ad9a-7bee22987109/scratch/raw_canonical_dump.json',
    JSON.stringify(out, null, 2)
  );
  console.log("\nRaw dump written.");

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
