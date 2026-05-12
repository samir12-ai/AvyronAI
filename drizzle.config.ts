import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Seal #7 (Task #25 / F10.10) — emit migrations under server/migrations/sql
  // so the server-side runner (server/migrations/runner.ts) can pick them up.
  out: "./server/migrations/sql",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
