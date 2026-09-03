import { Pool } from "pg";
import "dotenv/config";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '\''public'\''
      ORDER BY table_name ASC
    `);
    console.log("All Postgres tables in DB:", res.rows.map(r => r.table_name));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
