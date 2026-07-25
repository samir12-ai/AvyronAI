// Load .env into process.env FIRST — before any module that reads process.env.
// tsx does not auto-load .env; without this the env-validator sees an empty environment.
import "dotenv/config";
import { validateEnv } from "./env-validator";
import { initOTel } from "./observability/otel";
import { initSentry } from "./observability/sentry";

validateEnv();
initOTel();
initSentry().catch((err) => console.error("[Sentry] init promise rejected:", err));

