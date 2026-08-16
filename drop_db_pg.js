const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(`ALTER TABLE mi_snapshots DROP COLUMN IF EXISTS executive_summary_data`);
    console.log('COLUMN DROPPED SUCCESSFULLY');
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
    process.exit(0);
  }
}

run();
