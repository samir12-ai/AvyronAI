import "dotenv/config";
import * as schema from "../shared/schema";
import * as fs from "fs";

function getTableNames() {
  const tables = [];
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === "object" && (value as any).__drizzle && (value as any).__drizzle.name) {
      tables.push({ key, tableName: (value as any).__drizzle.name });
    }
  }
  return tables;
}

console.log(JSON.stringify(getTableNames(), null, 2));
