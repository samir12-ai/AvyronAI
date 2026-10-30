/**
 * Launches the Avyron backend server in Isolated Demo Recording Mode.
 * Enforces AVYRON_DEMO_MODE=1, DISABLE_BACKGROUND_WORKERS=1, and loads .env.demo.local.
 */
import "../server/demo/enable-demo-env";
import "../server/index";
