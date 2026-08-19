const fs = require('fs');

const data = JSON.parse(fs.readFileSync('C:/Users/mahmo/.gemini/antigravity/brain/f336cf20-23bb-4ecf-ad9a-7bee22987109/scratch/full_trace_pg.json'));

let md = `# AVYRON FORENSIC TRACE REPORT: SFI Peptides
**Campaign ID:** \`${data.activePlan.campaign_id}\`
**Run ID:** \`${data.root?.run_id || 'run_1786957802542_6xu0bv'}\`
**Active Plan ID:** \`${data.activePlan.id}\` (Version ${data.activePlan.version})

> [!NOTE]
> This is a complete, read-only forensic trace starting from Market Intelligence (MI3) to the final persisted BLL Strategy Plan, validating the Decision Quality Hardening.

---

## 1. Evidence (Market Intelligence & Inputs)
`;

function getPayload(snap) {
  if (!snap) return null;
  if (typeof snap.payload === 'string') {
    try { return JSON.parse(snap.payload); } catch(e) { return null; }
  }
  return snap.payload;
}

const mi = getPayload(data.engineData.mi_snapshots);
if (mi) {
  md += `**Market State:** ${mi.market_state || 'N/A'}\n\n`;
  md += `**Competitors Found:**\n`;
  if (mi.competitors) {
    mi.competitors.forEach(c => {
      md += `- **${c.name}**: ${c.summary || (c.hooks && c.hooks[0]) || 'N/A'}\n`;
    });
  }
} else {
  md += `*MI Snapshot Data Not Available in Extracted Trace*\n`;
}

md += `\n## 2. Diagnosis (Audience Engine & Pain Discovery)\n`;
const aud = getPayload(data.engineData.audience_snapshots);
if (aud) {
  md += `**Primary Pain Profile:**\n`;
  if (aud.pain_profiles && aud.pain_profiles.length > 0) {
    const p = aud.pain_profiles[0];
    md += `- **Pain ID:** \`${p.id || 'N/A'}\`\n`;
    md += `- **Pain Description:** ${p.pain || p.description || 'N/A'}\n`;
    md += `- **Emotional Root:** ${p.emotional_root || 'N/A'}\n`;
  }
}

md += `\n## 3. Commercial Meaning (Commercial Reasoning Engine)\n`;
const cr = getPayload(data.engineData.commercial_reasoning_snapshots);
if (cr) {
  md += `**Strategic Angles:**\n`;
  if (cr.angles) {
    cr.angles.forEach(a => {
      md += `- **${a.angle || a.name || 'Angle'}**: ${a.reasoning || a.implication || 'N/A'}\n`;
    });
  } else {
    md += `*Raw payload keys: ${Object.keys(cr).join(', ')}*\n`;
  }
}

md += `\n## 4. Strategic Decision (Positioning & Differentiation)\n`;
const pos = getPayload(data.engineData.positioning_snapshots);
if (pos && pos.territories && pos.territories.length > 0) {
  md += `### Positioning Territory\n`;
  md += `- **Name:** ${pos.territories[0].name || pos.territories[0].territory || 'N/A'}\n`;
  md += `- **Angle:** ${pos.territories[0].angle || pos.territories[0].description || 'N/A'}\n`;
}
const diff = getPayload(data.engineData.differentiation_snapshots);
if (diff && diff.pillars && diff.pillars.length > 0) {
  md += `### Differentiation Pillars\n`;
  diff.pillars.forEach(p => {
    md += `- **${p.name || p.pillar || 'N/A'}**: ${p.description || p.angle || 'N/A'}\n`;
  });
}

md += `\n## 5. Strategic Response (Mechanism, Offer & Funnel)\n`;
const mech = getPayload(data.engineData.mechanism_snapshots);
if (mech) {
  md += `### Mechanism\n`;
  md += `- **Name:** ${mech.mechanism?.name || mech.name || 'N/A'}\n`;
  md += `- **Description:** ${mech.mechanism?.description || mech.description || 'N/A'}\n`;
}
const off = getPayload(data.engineData.offer_snapshots);
if (off) {
  md += `### Core Offer\n`;
  md += `- **Promise:** ${off.offer?.promise || off.promise || 'N/A'}\n`;
  md += `- **Outcome:** ${off.offer?.outcome || off.outcome || 'N/A'}\n`;
}
const fun = getPayload(data.engineData.funnel_snapshots);
if (fun) {
  md += `### Funnel Architecture\n`;
  md += `- **Type:** ${fun.funnel?.type || fun.type || 'N/A'}\n`;
  if (fun.funnel?.stages) {
    fun.funnel.stages.forEach(s => {
      md += `- **Stage:** ${s.name || s.stage} -> ${s.action || s.goal || 'N/A'}\n`;
    });
  }
}

md += `\n## 6. BLL Final Output & Synthesis (Business Language Layer)\n`;
if (data.activePlan && data.activePlan.plan_json) {
  const bll = typeof data.activePlan.plan_json === 'string' ? JSON.parse(data.activePlan.plan_json) : data.activePlan.plan_json;
  
  md += `> [!IMPORTANT]\n> **Final Synthesized Frontend Output**\n\n`;
  
  if (bll.positioning_statement) {
    md += `**Positioning Statement:**\n> ${bll.positioning_statement}\n\n`;
  }
  if (bll.mechanism) {
    md += `**Mechanism:**\n> ${bll.mechanism}\n\n`;
  }
  if (bll.offer) {
    md += `**Offer:**\n> ${bll.offer}\n\n`;
  }
  
  md += `### Strategic Lanes Maintained\n`;
  if (bll.strategic_lanes) {
    bll.strategic_lanes.forEach(lane => {
      md += `- **Lane:** ${lane.name || lane.title || 'N/A'}\n`;
      md += `  - **Target:** ${lane.target || 'N/A'}\n`;
      md += `  - **Focus:** ${lane.focus || lane.angle || 'N/A'}\n`;
    });
  } else {
    md += `*No strategic lanes found in synthesized JSON.*\n`;
  }
}

fs.writeFileSync('C:/Users/mahmo/.gemini/antigravity/brain/f336cf20-23bb-4ecf-ad9a-7bee22987109/SFI_Forensic_Report.md', md);
console.log('Artifact created.');
