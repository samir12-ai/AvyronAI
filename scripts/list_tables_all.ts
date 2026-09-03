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
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name LIKE '\''%comp%'\'' OR table_name LIKE '\''%comment%'\''
    `);
    console.log("Matching tables:", res.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
