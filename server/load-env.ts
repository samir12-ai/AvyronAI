import dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertDemoEnvironmentSafe } from "./demo/config";

if (process.env.AVYRON_DEMO_MODE === "1") {
  const demoEnvPath = path.resolve(process.cwd(), ".env.demo.local");
  if (fs.existsSync(demoEnvPath)) {
    dotenv.config({ path: demoEnvPath, override: true });
  }
  process.env.DISABLE_BACKGROUND_WORKERS = "1";
  process.env.INSPECTION_MODE = "1";
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "demo-mode-no-live-calls";
  }
  if (!process.env.PUBLIC_BASE_URL) {
    process.env.PUBLIC_BASE_URL = "http://localhost:5000";
  }
  assertDemoEnvironmentSafe();
} else {
  dotenv.config();
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
