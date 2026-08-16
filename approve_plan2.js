require('dotenv/config');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query("SELECT id, status FROM strategic_plans WHERE campaign_id = 'campaign_1773576062201_6t0oxi' ORDER BY created_at DESC LIMIT 1", [], (err, res) => {
  if (err) throw err;
  console.log(res.rows[0]);
  if (res.rows[0] && res.rows[0].status !== 'APPROVED') {
    pool.query("UPDATE strategic_plans SET status = 'APPROVED' WHERE id = $1", [res.rows[0].id], (err2) => {
       if (err2) throw err2;
       console.log('Plan approved!');
       process.exit(0);
    });
  } else {
    process.exit(0);
  }
});
