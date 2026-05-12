import { validateEnv } from "./env-validator";
import { initOTel } from "./observability/otel";
import { initSentry } from "./observability/sentry";

validateEnv();
initOTel();
initSentry().catch((err) => console.error("[Sentry] init promise rejected:", err));
