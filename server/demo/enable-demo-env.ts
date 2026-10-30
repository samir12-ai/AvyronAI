import dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertDemoEnvironmentSafe } from "./config";

process.env.AVYRON_DEMO_MODE = "1";
process.env.DISABLE_BACKGROUND_WORKERS = "1";
process.env.INSPECTION_MODE = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "development";

const demoEnvPath = path.resolve(process.cwd(), ".env.demo.local");
if (fs.existsSync(demoEnvPath)) {
  dotenv.config({ path: demoEnvPath, override: true });
} else {
  throw new Error(
    "DEMO_GUARD_FATAL: .env.demo.local is missing. Refusing to start demo mode without isolated database configuration.",
  );
}

if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "demo-mode-no-live-calls";
}
if (!process.env.PUBLIC_BASE_URL) {
  process.env.PUBLIC_BASE_URL = "http://localhost:5000";
}

const verified = assertDemoEnvironmentSafe();
console.log(
  `[DemoEnv] Isolated Demo Mode initialized — DB host verified (${verified.dbHost}/${verified.dbName}), account=${verified.accountId}`,
);
