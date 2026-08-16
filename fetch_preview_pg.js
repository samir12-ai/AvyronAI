const { Client } = require('pg');
const fs = require('fs');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://neondb_owner:npg_m7cPxRkaqN2W@ep-twilight-night-asou49te.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require'
  });
  
  await client.connect();
  
  const planId = '03f2a319-1dcd-4d2d-b274-ce8f3e9cd296';
  
  const res = await client.query('SELECT plan_json, status FROM strategic_plans WHERE id = $1', [planId]);
  
  if (res.rows.length > 0) {
      const artifactPath = 'C:/Users/SFITELECOM FZCO/.gemini/antigravity/brain/51e86463-013f-45a2-b25a-8548e6d552a5/latest_plan_preview.json';
      
      const planParsed = JSON.parse(res.rows[0].plan_json);
      
      fs.writeFileSync(artifactPath, JSON.stringify({
          status: res.rows[0].status,
          plan: planParsed
      }, null, 2));
      console.log('Successfully wrote latest plan to artifact');
  } else {
      console.log('Plan not found!');
  }
  
  await client.end();
}

main().catch(console.error);
