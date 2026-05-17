// Bootstrap MUST be the first import — it runs validateEnv() → initOTel() →
// initSentry() at module-top-level. ESM evaluates imports in declaration
// order, so any module imported below will see a validated environment and
// initialized observability. Do not reorder.
import "./bootstrap";
import { captureException, flushSentry, isSentryEnabled } from "./observability/sentry";

import { runStartupArtifactGuard } from "./startup-artifact-guard";
runStartupArtifactGuard();

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { startAutonomousWorker, stopAutonomousWorker } from "./autonomous-worker";
import {
  startContinuityScheduler,
  stopContinuityScheduler,
  getContinuityHealth,
  renderContinuityMetrics,
  startContinuitySupervisor,
  stopContinuitySupervisor,
  getSupervisorHealth,
  getReplicaId,
} from "./continuity";
import { startPublishWorker, stopPublishWorker } from "./publish-worker";
import { startSnapshotCleanupWorker, stopSnapshotCleanupWorker } from "./snapshot-cleanup-worker";
import { stopQueueProcessor as stopMiQueueProcessor } from "./market-intelligence-v3/fetch-orchestrator";
import { runAllHealthChecks } from "./meta-token-manager";
// changes are applied out-of-band via `npm run db:migrate`. Boot refuses
// to start if the running code requires a version newer than what the DB
// reports, so a forgotten migration step fails loudly instead of running
// against an inconsistent schema.
import { verifySchemaFloor, runMigrations } from "./migrations/runner";
import { runTombstoneReaper } from "./account-lifecycle";
import { logger, loggerMiddleware, stripSecrets } from "./logger";
import { renderMetrics, recordHttpRequest } from "./observability/otel";
import { invalidateStaleSnapshots } from "./market-intelligence-v3/engine-state";
import { authMiddleware, optionalAuth, verifyAdminToken } from "./auth";
import * as fs from "fs";
import * as path from "path";
import { timingSafeEqual } from "node:crypto";
import pipelineRouter from "./pipeline/routes";
import { db } from "./db";
import { continuityTicks, planAnchorResets, continuityWindowClaims, systemNotices, bossRuns } from "@shared/schema";
import { desc, sql as drizzleSql, and, eq, isNull } from "drizzle-orm";
import { _bossInFlightStats } from "./boss/concurrency";
import { _continuityTickInflightStats } from "./continuity/scheduler";
import { _activeJobsStats } from "./market-intelligence-v3/fetch-orchestrator";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    // Allow localhost origins for Expo web development (any port)
    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "50mb" }));
}

function setupRequestLogging(app: express.Application) {
  // Mounts loggerMiddleware FIRST so req.traceId + req.logger are available
  // to every downstream handler (including the /api auth gate).
  app.use(loggerMiddleware());

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    const requestId = req.traceId;
    req.requestId = requestId;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      if (bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson) && path.startsWith('/api')) {
        bodyJson.requestId = requestId;
      }
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const durationMs = Date.now() - start;
      // /metrics has signal even for non-/api routes (landing, healthz).
      try {
        recordHttpRequest(req.method, path, res.statusCode, durationMs / 1000);
      } catch { /* never let telemetry break a request */ }

      if (!path.startsWith("/api")) return;

      // Previously the captured JSON (which routinely contained `token`,
      // `refreshToken`, `password`) was JSON.stringified and truncated to 80
      // chars, leaking secrets to console + log shippers.
      const sanitized = capturedJsonResponse
        ? stripSecrets(capturedJsonResponse)
        : undefined;
      logger.info(
        {
          component: "http",
          method: req.method,
          path,
          status: res.statusCode,
          durationMs,
          ...(sanitized ? { response: sanitized } : {}),
        },
        `${req.method} ${path} ${res.statusCode}`,
      );
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

// P1-9 (W5 launch-closure, post-architect-#3 fix): module-scoped helper so
// the SAME security header set is applied to every public static HTML
// response — landing (`/`), pricing (`/pricing`), data-deletion
// (`/data-deletion`). The previous version of the helper was defined
// inside the request-middleware closure and was therefore unreachable
// from `serveLandingPage`, leaving the most-trafficked static page
// (the landing page itself) without CSP/X-Frame-Options/etc.
function setStaticSecurityHeaders(res: Response) {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  // Previously: trusted attacker-controlled `Host` and `X-Forwarded-Host`
  // headers and injected them into the landing page HTML, enabling
  // arbitrary base-URL substitution (cookie-poisoning + phishing-link
  // crafting). Now: PUBLIC_BASE_URL is the canonical source; env-validator
  // refuses to boot if it's unset or malformed.
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  const expsUrl = (() => {
    try { return new URL(baseUrl).host; } catch { return baseUrl; }
  })();

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  setStaticSecurityHeaders(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    // P1-9 security headers — uses the module-scoped
    // `setStaticSecurityHeaders` helper defined above so landing,
    // pricing, and data-deletion all share the same policy.
    if (req.path === "/data-deletion") {
      const deletionPath = path.resolve(process.cwd(), "server", "templates", "data-deletion.html");
      const deletionHtml = fs.readFileSync(deletionPath, "utf-8");
      setStaticSecurityHeaders(res);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(deletionHtml);
    }

    if (req.path === "/pricing") {
      const pricingPath = path.resolve(process.cwd(), "server", "templates", "pricing.html");
      const pricingHtml = fs.readFileSync(pricingPath, "utf-8");
      const baseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
      const finalHtml = pricingHtml
        .replace(/BASE_URL_PLACEHOLDER/g, baseUrl);
      setStaticSecurityHeaders(res);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(finalHtml);
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  if (process.env.NODE_ENV === "production") {
    const webBuildDir = path.resolve(process.cwd(), "static-build", "web");
    if (fs.existsSync(webBuildDir)) {
      app.use(express.static(webBuildDir));
      log("Serving Expo web build from static-build/web");
    }

    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/assets")) {
        return next();
      }
      const webIndex = path.resolve(process.cwd(), "static-build", "web", "index.html");
      if (fs.existsSync(webIndex)) {
        return res.sendFile(webIndex);
      }
      next();
    });
  } else {
    import("http-proxy-middleware").then(({ createProxyMiddleware }) => {
      const expoProxy = createProxyMiddleware({
        target: "http://localhost:8081",
        changeOrigin: true,
        ws: true,
        logger: undefined,
      });

      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith("/api") || req.path === "/" || req.path === "/pricing" || req.path === "/data-deletion") {
          return next();
        }
        return expoProxy(req, res, next);
      });
      log("Dev proxy: non-API routes → Expo dev server on port 8081");
    }).catch((err) => {
      log("Dev proxy not available:", err.message);
    });
  }

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
      name?: string;
    };

    const status = error.status || error.statusCode || 500;
    const isProd = process.env.NODE_ENV === "production";
    if (status >= 500) {
      try {
        captureException(err, {
          traceId: req.traceId,
          method: req.method,
          path: req.path,
        });
      } catch { /* never let telemetry crash the handler */ }
    }
    // but still logs the full error structurally for ops.
    const clientMessage =
      isProd && status >= 500
        ? "Internal Server Error"
        : error.message || "Internal Server Error";

    if (status >= 500) {
      logger.error(
        { component: "errorHandler", status, name: error.name, err: String(err), stack: err instanceof Error ? err.stack : undefined },
        `${req.method} ${req.path} → ${status}`,
      );
    } else {
      logger.warn(
        { component: "errorHandler", status, name: error.name, err: String(err) },
        `${req.method} ${req.path} → ${status}`,
      );
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message: clientMessage });
  });
}

(async () => {
  // P1-2 (launch-closure W4): trust the first proxy hop so req.ip resolves
  // to the real client IP (not the load-balancer's address) behind Replit's
  // edge. Required for the login rate-limit (server/auth.ts) to identify
  // distinct callers — without this, every request appears to come from the
  // proxy and the limit would lock the entire app on first contact.
  app.set("trust proxy", 1);

  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  // ─── Seal #7 (Task #25 / F10.4, F10.7) — health + metrics ──────────────────
  // Mounted BEFORE the /api auth gate so external probes (load balancers,
  // Prometheus scrapers, uptime checks) can reach them without a JWT.
  // /metrics is admin-token-gated to keep cardinality + business signal
  // private even though the endpoint is unauthenticated to the auth layer.
  app.get("/healthz", (_req: Request, res: Response) => {
    // Liveness only — does NOT touch the DB. Readiness probe wraps the
    // migration runner result during boot (see runMigrations() below).
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
  });

  // Seal #13 / Track #1 — continuity scheduler heartbeat probe.
  // Public surface returns AGGREGATE COUNTERS ONLY — no per-tenant
  // identifiers (accountId/campaignId/planId/per-campaign decisions).
  // This satisfies external uptime probes / load balancers without
  // leaking tenant operational data. The full TickReport (including
  // per-campaign decisions) is served only when the request carries the
  // METRICS_ADMIN_TOKEN, mirroring the /metrics gating model.
  app.get("/healthz/continuity", (req: Request, res: Response) => {
    const health = getContinuityHealth();
    const supervisor = getSupervisorHealth();
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    let isAdmin = false;
    if (expected && provided.length === expected.length) {
      try {
        isAdmin = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        isAdmin = false;
      }
    }
    if (isAdmin) {
      // Seal #14 — admin gets the full report including per-chain
      // observations. Replica id is included for forensic correlation
      // when investigating which replica owned a window.
      return res.status(200).json({
        ...health,
        replicaId: getReplicaId(),
        supervisor,
      });
    }
    // Strip per-tenant fields. Keep timestamps + counters + scheduler
    // up/down state so unauthenticated probes can still alarm on
    // staleness. Seal #14 — supervisor + chain summary IS exposed
    // publicly because it carries no tenant identifiers (only chainId,
    // state enum, and lag in ms — operational counters only).
    const { lastTickReport, ...rest } = health;
    const safeReport = lastTickReport
      ? {
          tickAt: lastTickReport.tickAt,
          durationMs: lastTickReport.durationMs,
          campaignsScanned: lastTickReport.campaignsScanned,
          runsInvoked: lastTickReport.runsInvoked,
          runsSkippedIdempotent: lastTickReport.runsSkippedIdempotent,
          runsFailed: lastTickReport.runsFailed,
          reanchorsWritten: lastTickReport.reanchorsWritten,
          missedWindowsDetected: lastTickReport.missedWindowsDetected,
          deadCyclesDetected: lastTickReport.deadCyclesDetected,
        }
      : null;
    const safeSupervisor = supervisor.lastReport
      ? {
          supervisorUp: supervisor.supervisorUp,
          lastSupervisorTickAt: supervisor.lastSupervisorTickAt,
          intervalMs: supervisor.intervalMs,
          schedulerState: supervisor.lastReport.schedulerState,
          schedulerHeartbeatAgeMs: supervisor.lastReport.schedulerHeartbeatAgeMs,
          chainsChecked: supervisor.lastReport.chainsChecked,
          chainsHealthy: supervisor.lastReport.chainsHealthy,
          chainsDegraded: supervisor.lastReport.chainsDegraded,
          chainsDead: supervisor.lastReport.chainsDead,
          chainsUnknown: supervisor.lastReport.chainsUnknown,
          chains: supervisor.lastReport.chains.map((c) => ({
            chainId: c.chainId,
            state: c.state,
            lagMs: c.lagMs,
            introspectionAvailable: c.introspectionAvailable,
          })),
        }
      : {
          supervisorUp: supervisor.supervisorUp,
          lastSupervisorTickAt: supervisor.lastSupervisorTickAt,
          intervalMs: supervisor.intervalMs,
        };
    return res.status(200).json({ ...rest, lastTickReport: safeReport, supervisor: safeSupervisor });
  });

  // ─── Task #53 / U4 — Public /status page ───────────────────────────────
  //
  // GET /status
  //
  // A small, human-readable status page modeled after public status pages
  // (status.openai.com, status.stripe.com). NO tenant data — strictly the
  // same aggregate counters the public /healthz/continuity surface already
  // exposes, plus a 24h boss-run success rate and the timestamp of the
  // last incident (failed or partial run).
  //
  // Doctrine notes:
  //   * B1 (Beta Safety) — truthful confidence over confident-looking
  //     fabrication. When the DB query for boss_runs counters fails, we
  //     render an "unknown" state rather than green.
  //   * NO-TENANT-LEAK — campaignId / accountId / planId are never read.
  //   * D2/D5 — the scheduler heartbeat colour is derived from the strict
  //     `supervisor.schedulerState` enum (HEALTHY|DEGRADED|UNHEALTHY|
  //     UNKNOWN). Unknown values render as "unknown", not "healthy".
  //   * Content-negotiated: `Accept: application/json` returns the JSON
  //     shape that powers the page; the default response is HTML.
  //
  app.get("/status", async (req: Request, res: Response) => {
    const health = getContinuityHealth();
    const supervisor = getSupervisorHealth();

    // Compute 24h boss-run counters + last-incident timestamp.
    // Strictly aggregate — no per-tenant rows are read.
    type Bucket = { total: number; completed: number; partial: number; failed: number; lastIncidentAt: Date | null };
    let bucket: Bucket | null = null;
    let bossQueryFailed = false;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          status: bossRuns.status,
          count: drizzleSql<number>`count(*)::int`,
          maxFinished: drizzleSql<Date | null>`max(${bossRuns.finishedAt})`,
        })
        .from(bossRuns)
        .where(drizzleSql`${bossRuns.createdAt} >= ${since}`)
        .groupBy(bossRuns.status);
      const init: Bucket = { total: 0, completed: 0, partial: 0, failed: 0, lastIncidentAt: null };
      bucket = rows.reduce<Bucket>((acc, r) => {
        const c = Number(r.count) || 0;
        acc.total += c;
        if (r.status === "completed") acc.completed += c;
        else if (r.status === "partial") {
          acc.partial += c;
          if (r.maxFinished && (!acc.lastIncidentAt || r.maxFinished > acc.lastIncidentAt)) {
            acc.lastIncidentAt = r.maxFinished;
          }
        } else if (r.status === "failed") {
          acc.failed += c;
          if (r.maxFinished && (!acc.lastIncidentAt || r.maxFinished > acc.lastIncidentAt)) {
            acc.lastIncidentAt = r.maxFinished;
          }
        }
        return acc;
      }, init);
    } catch (err) {
      bossQueryFailed = true;
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Status] boss_runs query failed");
    }

    // Canonical scheduler state enum is HEALTHY|DEGRADED|DEAD|UNKNOWN
    // (server/continuity/health-classifier.ts ChainState). DEAD = scheduler
    // has stopped ticking and a campaign-wide outage is in progress, which
    // is the strongest public "down" signal we have. D2/D5 — no string
    // fallback: anything outside the strict union renders as "unknown".
    const schedulerStateRaw = supervisor.lastReport?.schedulerState;
    type StatusBand = "operational" | "degraded" | "down" | "unknown";
    let schedulerBand: StatusBand;
    if (schedulerStateRaw === "HEALTHY") schedulerBand = "operational";
    else if (schedulerStateRaw === "DEGRADED") schedulerBand = "degraded";
    else if (schedulerStateRaw === "DEAD") schedulerBand = "down";
    else schedulerBand = "unknown";

    // Architect fix — success-rate denominator is TERMINAL runs only
    // (completed|partial|failed). In-flight `running` rows must NOT count
    // against the rate, otherwise a healthy burst of new work depresses
    // the rate and falsely flags degradation.
    const terminalRuns = bucket
      ? bucket.completed + bucket.partial + bucket.failed
      : 0;
    let pipelineBand: StatusBand;
    if (bossQueryFailed || bucket === null) pipelineBand = "unknown";
    else if (terminalRuns === 0) pipelineBand = "unknown";
    else {
      const successRate = bucket.completed / terminalRuns;
      if (bucket.failed > 0 && successRate < 0.5) pipelineBand = "down";
      else if (successRate < 0.95 || bucket.partial > 0) pipelineBand = "degraded";
      else pipelineBand = "operational";
    }

    const overallBand: StatusBand =
      schedulerBand === "down" || pipelineBand === "down" ? "down" :
      schedulerBand === "degraded" || pipelineBand === "degraded" ? "degraded" :
      schedulerBand === "unknown" || pipelineBand === "unknown" ? "unknown" :
      "operational";

    const successRate24h = terminalRuns > 0 && bucket
      ? Math.round((bucket.completed / terminalRuns) * 1000) / 10
      : null;

    const payload = {
      overall: overallBand,
      generatedAt: new Date().toISOString(),
      components: {
        scheduler: {
          state: schedulerBand,
          lastTickAt: health.lastTickAt ?? null,
          intervalMs: supervisor.intervalMs,
        },
        pipeline: {
          state: pipelineBand,
          window: "24h",
          totalRuns: bucket?.total ?? null,
          terminalRuns,
          successRate: successRate24h,
          partialRuns: bucket?.partial ?? null,
          failedRuns: bucket?.failed ?? null,
          lastIncidentAt: bucket?.lastIncidentAt?.toISOString() ?? null,
          queryFailed: bossQueryFailed,
        },
      },
    };

    const wantsJson = (req.header("accept") ?? "").toLowerCase().includes("application/json");
    if (wantsJson) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(payload);
    }

    const bandColor: Record<StatusBand, string> = {
      operational: "#10B981",
      degraded: "#F59E0B",
      down: "#EF4444",
      unknown: "#8892A4",
    };
    const bandLabel: Record<StatusBand, string> = {
      operational: "All systems operational",
      degraded: "Partial degradation",
      down: "Major outage",
      unknown: "Status unknown",
    };
    const escapeHtml = (s: string): string =>
      s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

    const fmtTime = (iso: string | Date | null): string => {
      if (!iso) return "—";
      const d = iso instanceof Date ? iso : new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toUTCString();
    };

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Avyron AI — System Status</title>
  <meta name="robots" content="noindex" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #080C10; color: #E8EDF2; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px 0; }
    .muted { color: #8892A4; font-size: 13px; }
    .overall { display: flex; align-items: center; gap: 12px; padding: 20px; border-radius: 14px; background: #0F1419; border: 1px solid #1A2030; margin: 24px 0; }
    .dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
    .overall-label { font-size: 18px; font-weight: 600; }
    .card { padding: 16px; border-radius: 12px; background: #0F1419; border: 1px solid #1A2030; margin-bottom: 12px; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .card-title { font-size: 15px; font-weight: 600; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    .stat { background: #151B24; border-radius: 8px; padding: 10px 12px; }
    .stat-label { font-size: 11px; color: #8892A4; text-transform: uppercase; letter-spacing: 0.4px; }
    .stat-value { font-size: 16px; font-weight: 700; margin-top: 2px; }
    footer { color: #4A5568; font-size: 11px; text-align: center; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Avyron AI — System Status</h1>
    <div class="muted">Real-time operational status of the Avyron AI platform.</div>

    <div class="overall">
      <div class="dot" style="background:${bandColor[overallBand]}"></div>
      <div>
        <div class="overall-label">${escapeHtml(bandLabel[overallBand])}</div>
        <div class="muted">Last updated ${escapeHtml(fmtTime(payload.generatedAt))}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">Continuity scheduler</div>
        <span class="badge" style="background:${bandColor[schedulerBand]}22;color:${bandColor[schedulerBand]}">
          <span class="dot" style="width:8px;height:8px;background:${bandColor[schedulerBand]}"></span>
          ${escapeHtml(schedulerBand)}
        </span>
      </div>
      <div class="muted" style="margin-top:6px">
        Drives hourly plan re-evaluation. A healthy scheduler tick is required for new plans to generate.
      </div>
      <div class="grid">
        <div class="stat">
          <div class="stat-label">Last tick</div>
          <div class="stat-value">${escapeHtml(fmtTime(health.lastTickAt))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Tick interval</div>
          <div class="stat-value">${Math.round(supervisor.intervalMs / 1000)}s</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">Plan generation pipeline (24h)</div>
        <span class="badge" style="background:${bandColor[pipelineBand]}22;color:${bandColor[pipelineBand]}">
          <span class="dot" style="width:8px;height:8px;background:${bandColor[pipelineBand]}"></span>
          ${escapeHtml(pipelineBand)}
        </span>
      </div>
      <div class="muted" style="margin-top:6px">
        Aggregate success rate of all strategic plan runs over the last 24 hours. No per-customer data is shown.
      </div>
      <div class="grid">
        <div class="stat">
          <div class="stat-label">Total runs</div>
          <div class="stat-value">${bucket?.total ?? "—"}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Success rate</div>
          <div class="stat-value">${successRate24h !== null ? `${successRate24h}%` : "—"}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Partial runs</div>
          <div class="stat-value">${bucket?.partial ?? "—"}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Failed runs</div>
          <div class="stat-value">${bucket?.failed ?? "—"}</div>
        </div>
      </div>
      <div class="muted" style="margin-top:10px">
        Last incident: <strong>${escapeHtml(fmtTime(bucket?.lastIncidentAt ?? null))}</strong>
      </div>
    </div>

    <footer>
      No customer data is exposed on this page. For machine-readable status, request <code>Accept: application/json</code>.
    </footer>
  </div>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  });

  // ─── Seal #17 / Track #4 — Operator-visible continuity surface ─────────
  //
  // GET /api/admin/continuity/panel
  //
  // Powers the in-app "Continuity" panel (6th panel of Audit & Control)
  // and answers the operator question "why didn't my campaign run this
  // week" in ≤30s. Admin-token-gated (same X-Admin-Token / METRICS_ADMIN_TOKEN
  // pattern as /metrics + /healthz/continuity). When the token is unset
  // the endpoint is CLOSED (401 to all callers) — fail-safe by default.
  //
  // Returns:
  //   - lastTick           : { tickAt, durationMs } from the in-memory
  //                          getContinuityHealth().lastTickReport (no DB hit)
  //   - perCampaignWindowGaps : entries from the latest tick where the
  //                          observed window_index lags the expected one
  //                          (i.e. missed_windows > 0). Strict-typed
  //                          decision enum — no string fallback (D2/D3).
  //   - recentReanchors    : last 10 plan_anchor_resets rows
  //   - skipReasonHistogram24h : aggregated counts per PerCampaignDecision
  //                          .decision over continuity_ticks rows from the
  //                          last 24h. Computed via jsonb_array_elements
  //                          + GROUP BY in PG — no in-memory scan.
  //   - deadCycles         : count from the latest tick.
  //
  // Doctrine notes:
  //   * D2 — every meaning has its own canonical field. The histogram keys
  //     are the 8 strict union values from PerCampaignDecision.decision;
  //     unknown strings from corrupt notes rows are bucketed under the
  //     literal "unknown" key (NOT silently coerced to a real decision).
  //   * D5 — missing canonical → CONTRACT_INCOMPLETE. If lastTickReport
  //     is null we return lastTick=null, NOT a synthetic placeholder.
  //   * NO-TENANT-LEAK does NOT apply here — this surface is admin-gated
  //     by construction (401 when token missing or wrong).
  //
  app.get("/api/admin/continuity/panel", async (req: Request, res: Response) => {
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    if (!expected) {
      return res.status(401).json({ error: "continuity_panel_disabled_no_admin_token" });
    }
    let isAdmin = false;
    if (provided.length === expected.length) {
      try {
        isAdmin = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        isAdmin = false;
      }
    }
    if (!isAdmin) {
      return res.status(401).json({ error: "unauthorized" });
    }

    try {
      const health = getContinuityHealth();
      const lastReport = health.lastTickReport;

      // Strict union — keep this in sync with PerCampaignDecision.decision
      // in server/continuity/scheduler.ts. The histogram is initialized
      // with all 8 keys at 0 so callers always see a complete shape (D5).
      const DECISION_KEYS = [
        "invoked",
        "skipped_already_evaluated",
        "skipped_in_flight",
        "skipped_no_advance",
        "skipped_claimed_by_other_replica",
        "skipped_completed_claim_exists",
        "reanchored_then_invoked",
        "failed",
      ] as const;
      type DecisionKey = (typeof DECISION_KEYS)[number];
      const skipReasonHistogram24h: Record<DecisionKey | "unknown", number> = {
        invoked: 0,
        skipped_already_evaluated: 0,
        skipped_in_flight: 0,
        skipped_no_advance: 0,
        skipped_claimed_by_other_replica: 0,
        skipped_completed_claim_exists: 0,
        reanchored_then_invoked: 0,
        failed: 0,
        unknown: 0,
      };

      // 24h skip-reason histogram. jsonb_array_elements expands each tick's
      // notes array; GROUP BY decision in PG keeps the round-trip to one
      // query regardless of tick volume.
      const histRows = await db.execute(drizzleSql`
        SELECT (note->>'decision') AS decision, COUNT(*)::int AS count
        FROM ${continuityTicks},
             jsonb_array_elements(${continuityTicks.notes}) AS note
        WHERE ${continuityTicks.tickAt} >= NOW() - INTERVAL '24 hours'
        GROUP BY (note->>'decision')
      `);
      const histRowsArr = (histRows as unknown as { rows: Array<{ decision: string | null; count: number }> }).rows ?? [];
      for (const row of histRowsArr) {
        const d = row.decision;
        if (d && (DECISION_KEYS as readonly string[]).includes(d)) {
          skipReasonHistogram24h[d as DecisionKey] = Number(row.count) || 0;
        } else {
          skipReasonHistogram24h.unknown += Number(row.count) || 0;
        }
      }

      // Recent re-anchors (last 10).
      const recentReanchors = await db
        .select()
        .from(planAnchorResets)
        .orderBy(desc(planAnchorResets.reanchoredAt))
        .limit(10);

      // Per-campaign window gaps from the LATEST tick. We surface only
      // entries with an actual lag (missedWindows > 0 OR a non-`invoked`
      // decision) to keep the operator panel signal-dense.
      const perCampaignWindowGaps = (lastReport?.decisions ?? [])
        .filter((d) => {
          const isLagging = (d.missedWindows ?? 0) > 0;
          const isNonInvoked = d.decision !== "invoked" && d.decision !== "reanchored_then_invoked";
          return isLagging || isNonInvoked;
        })
        .map((d) => ({
          accountId: d.accountId,
          campaignId: d.campaignId,
          planId: d.planId,
          decision: d.decision,
          reason: d.reason ?? null,
          observedWindowIndex: d.observedWindowIndex ?? null,
          expectedWindowIndex: d.expectedWindowIndex ?? null,
          missedWindows: d.missedWindows ?? 0,
          claimedBy: d.claimedBy ?? null,
        }));

      return res.status(200).json({
        lastTick: lastReport
          ? {
              tickAt: lastReport.tickAt,
              durationMs: lastReport.durationMs,
              campaignsScanned: lastReport.campaignsScanned,
              runsInvoked: lastReport.runsInvoked,
              runsSkippedIdempotent: lastReport.runsSkippedIdempotent,
              runsFailed: lastReport.runsFailed,
              reanchorsWritten: lastReport.reanchorsWritten,
              missedWindowsDetected: lastReport.missedWindowsDetected,
              deadCyclesDetected: lastReport.deadCyclesDetected,
            }
          : null,
        perCampaignWindowGaps,
        recentReanchors: recentReanchors.map((r) => ({
          id: r.id,
          accountId: r.accountId,
          campaignId: r.campaignId,
          planId: r.planId,
          reanchoredAt: r.reanchoredAt,
          reason: r.reason,
          source: r.source,
        })),
        skipReasonHistogram24h,
        deadCycles: lastReport?.deadCyclesDetected ?? 0,
      });
    } catch (err) {
      console.error("[ContinuityPanel] PANEL_LOAD_FAILED", err);
      return res.status(500).json({ error: "continuity_panel_load_failed" });
    }
  });

  // GET /api/admin/continuity/campaign/:campaignId/last-decision
  //
  // Lightweight per-campaign lookup used by the campaign-card skip-reason
  // badge. Returns the latest PerCampaignDecision for the requested
  // campaign from the in-memory lastTickReport (no DB hit). Returns
  // `{ decision: null }` when the latest tick had no entry for this
  // campaign — callers MUST treat null as "no badge", never substitute
  // a default decision (D5).
  app.get("/api/admin/continuity/campaign/:campaignId/last-decision", (req: Request, res: Response) => {
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    if (!expected) {
      return res.status(401).json({ error: "continuity_panel_disabled_no_admin_token" });
    }
    let isAdmin = false;
    if (provided.length === expected.length) {
      try {
        isAdmin = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        isAdmin = false;
      }
    }
    if (!isAdmin) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const campaignId = req.params.campaignId;
    const health = getContinuityHealth();
    const decisions = health.lastTickReport?.decisions ?? [];
    const found = decisions.find((d) => d.campaignId === campaignId);
    if (!found) {
      return res.status(200).json({ decision: null });
    }
    return res.status(200).json({
      decision: {
        decision: found.decision,
        reason: found.reason ?? null,
        missedWindows: found.missedWindows ?? 0,
        observedWindowIndex: found.observedWindowIndex ?? null,
        expectedWindowIndex: found.expectedWindowIndex ?? null,
        tickAt: health.lastTickReport?.tickAt ?? null,
      },
    });
  });

  // ─── Task #89 / Phase 4-A — Replay corpus operator panel endpoints ──
  //
  // GET /api/admin/replay/cassettes  → corpus summary + last 50 cassettes
  // GET /api/admin/replay/cassette/:hash → one cassette body
  //
  // Same X-Admin-Token gate as /metrics + /healthz/continuity. Production
  // cassettes are NOT committed to repo — download only via this surface.
  app.get("/api/admin/replay/cassettes", async (req: Request, res: Response) => {
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    if (!expected) {
      return res.status(401).json({ error: "replay_panel_disabled_no_admin_token" });
    }
    let isAdmin = false;
    if (provided.length === expected.length) {
      try {
        isAdmin = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        isAdmin = false;
      }
    }
    if (!isAdmin) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const { pool } = require("./db") as typeof import("./db");
      const { setCassetteAgeMaxHours } = require("./orchestrator/replay/cv13-metrics") as typeof import("./orchestrator/replay/cv13-metrics");
      const summary = await pool.query<{ source: string; path_shape: string | null; cnt: string; oldest: Date | null }>(
        `SELECT source, path_shape, COUNT(*)::text AS cnt, MIN(captured_at) AS oldest
         FROM orchestrator_replay_cassettes GROUP BY source, path_shape`,
      );
      const recent = await pool.query<{ cassette_hash: string; source: string; path_shape: string | null; captured_at: Date; campaign_id: string | null }>(
        `SELECT cassette_hash, source, path_shape, captured_at, campaign_id
         FROM orchestrator_replay_cassettes ORDER BY captured_at DESC LIMIT 50`,
      );
      let oldestMs: number | null = null;
      for (const r of summary.rows) {
        if (r.oldest) {
          const t = new Date(r.oldest).getTime();
          if (oldestMs === null || t < oldestMs) oldestMs = t;
        }
      }
      const oldestHours = oldestMs === null ? 0 : Math.max(0, (Date.now() - oldestMs) / 3_600_000);
      setCassetteAgeMaxHours(oldestHours);
      return res.status(200).json({
        summary: summary.rows.map((r) => ({
          source: r.source,
          pathShape: r.path_shape,
          count: parseInt(r.cnt, 10),
          oldestCapturedAt: r.oldest ? new Date(r.oldest).toISOString() : null,
        })),
        oldestAgeHours: oldestHours,
        recent: recent.rows.map((r) => ({
          cassetteHash: r.cassette_hash,
          source: r.source,
          pathShape: r.path_shape,
          capturedAt: new Date(r.captured_at).toISOString(),
          campaignId: r.campaign_id,
        })),
      });
    } catch (err) {
      // Seal #15 — no silent catches.
      console.error("[ReplayPanel] CORPUS_QUERY_FAILED", err);
      return res.status(500).json({ error: "corpus_query_failed" });
    }
  });

  app.get("/api/admin/replay/cassette/:hash", async (req: Request, res: Response) => {
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    if (!expected) {
      return res.status(401).json({ error: "replay_panel_disabled_no_admin_token" });
    }
    let isAdmin = false;
    if (provided.length === expected.length) {
      try {
        isAdmin = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        isAdmin = false;
      }
    }
    if (!isAdmin) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const { pool } = require("./db") as typeof import("./db");
      const row = await pool.query<{ body: unknown; cassette_hash: string }>(
        `SELECT cassette_hash, body FROM orchestrator_replay_cassettes WHERE cassette_hash = $1 LIMIT 1`,
        [req.params.hash],
      );
      if (row.rows.length === 0) {
        return res.status(404).json({ error: "cassette_not_found" });
      }
      return res.status(200).json({ cassetteHash: row.rows[0].cassette_hash, body: row.rows[0].body });
    } catch (err) {
      console.error("[ReplayPanel] CASSETTE_FETCH_FAILED", err);
      return res.status(500).json({ error: "cassette_fetch_failed" });
    }
  });

  // ─── Operations Guardian — operator notices surface ──────────────────
  //
  // GET /api/admin/operator-notices
  //
  // Returns currently OPEN system_notices rows scoped to audience='operator'.
  // The Guardian Interpreter (server/operations-guardian/interpreter.ts)
  // runs inside the existing Continuity Supervisor tick (every ~5min) and
  // UPSERTs into system_notices using the partial unique index on
  // (correlation_key, audience) WHERE resolved_at IS NULL — so the same
  // raw signal observed across multiple ticks collapses into ONE row with
  // a bumped observation_count + last_seen_at.
  //
  // Doctrine notes:
  //   * D2/D3 — every field is a strict enum (category, severity,
  //     audience, recovery_outcome). No `?? "unknown"` fallback.
  //   * D5 — never substitute a default. If the table is empty the
  //     response is `notices: []`, not a synthetic placeholder.
  //   * Same X-Admin-Token gate + fail-closed-when-unset pattern as the
  //     existing continuity + operations panel endpoints.
  //   * Observe-only phase: audience='user' rows do not exist (USER_COPY
  //     firewall in operations-guardian/types.ts is intentionally empty).
  app.get("/api/admin/operator-notices", async (req: Request, res: Response) => {
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    if (!expected) {
      return res.status(401).json({ error: "operator_notices_disabled_no_admin_token" });
    }
    let isAdmin = false;
    if (provided.length === expected.length) {
      try {
        isAdmin = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch (err) {
        // Seal #15 — no silent catches. timingSafeEqual throws only on
        // length mismatch (already pre-checked) or non-Buffer input;
        // either way we fail closed, but log so the operator can spot
        // misconfiguration of the admin-token header.
        console.error("[OperatorNotices] TIMING_SAFE_COMPARE_FAILED", err);
        isAdmin = false;
      }
    }
    if (!isAdmin) {
      return res.status(401).json({ error: "unauthorized" });
    }

    try {
      const rows = await db
        .select({
          id: systemNotices.id,
          category: systemNotices.category,
          severity: systemNotices.severity,
          audience: systemNotices.audience,
          correlationKey: systemNotices.correlationKey,
          accountId: systemNotices.accountId,
          campaignId: systemNotices.campaignId,
          copyKey: systemNotices.copyKey,
          copyVars: systemNotices.copyVars,
          detail: systemNotices.detail,
          firstSeenAt: systemNotices.firstSeenAt,
          lastSeenAt: systemNotices.lastSeenAt,
          observationCount: systemNotices.observationCount,
          recoveryAttempted: systemNotices.recoveryAttempted,
          recoveryOutcome: systemNotices.recoveryOutcome,
        })
        .from(systemNotices)
        .where(
          and(
            eq(systemNotices.audience, "operator"),
            isNull(systemNotices.resolvedAt),
          ),
        )
        .orderBy(desc(systemNotices.lastSeenAt))
        .limit(100);

      // Severity rank for client-side sort: critical > degraded > warning > info.
      // Returned alongside each row so the UI doesn't reimplement the order.
      const severityRank: Record<string, number> = {
        critical: 0,
        degraded: 1,
        warning: 2,
        info: 3,
      };
      const sorted = [...rows].sort((a, b) => {
        const sa = severityRank[a.severity] ?? 99;
        const sb = severityRank[b.severity] ?? 99;
        if (sa !== sb) return sa - sb;
        const la = a.lastSeenAt instanceof Date ? a.lastSeenAt.getTime() : 0;
        const lb = b.lastSeenAt instanceof Date ? b.lastSeenAt.getTime() : 0;
        return lb - la;
      });

      return res.status(200).json({
        notices: sorted.map((r) => ({
          id: r.id,
          category: r.category,
          severity: r.severity,
          audience: r.audience,
          correlationKey: r.correlationKey,
          accountId: r.accountId,
          campaignId: r.campaignId,
          copyKey: r.copyKey,
          copyVars: r.copyVars,
          detail: r.detail,
          firstSeenAt:
            r.firstSeenAt instanceof Date ? r.firstSeenAt.toISOString() : r.firstSeenAt,
          lastSeenAt:
            r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : r.lastSeenAt,
          observationCount: r.observationCount,
          recoveryAttempted: r.recoveryAttempted,
          recoveryOutcome: r.recoveryOutcome,
        })),
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[OperatorNotices] LOAD_FAILED", err);
      return res.status(500).json({ error: "operator_notices_load_failed" });
    }
  });

  // ─── Task #52 / Priority #1 — Operator dashboards (operations panel) ──
  //
  // GET /api/admin/operations/panel
  //
  // Surfaces operational signals previously operator-grep-only:
  //   - bossLocks / continuityTick / miActiveJobs : Seal #16 zombie-watchdog
  //     Map stats (size, zombieEvictions, oldestAgeMs, maxAgeMs). A non-zero
  //     zombieEvictions OR an oldestAgeMs approaching maxAgeMs is the
  //     operator-visible signal of a leaked async path.
  //   - retryLoopCampaigns : campaigns with ≥3 `failed` decisions in 24h
  //     (G1 from observation-plan.md §B). Computed from continuity_ticks
  //     notes via jsonb_array_elements + GROUP BY in PG.
  //   - stuckClaims : continuity_window_claims rows with status='in_progress'
  //     AND claimed_at < NOW() - 2h. A multi-replica boss_run normally
  //     completes in seconds; a 2h stuck claim signals a leaked claim
  //     row (would block the next-tick re-claim).
  //
  // Doctrine notes:
  //   * D2/D3 — every counter has its own canonical field (no string status).
  //   * D5 — when the in-memory stat is null, return null (not 0) for the
  //     numeric `oldestAgeMs` field so callers can distinguish "no entry"
  //     from "fresh entry".
  //   * Same X-Admin-Token gate + fail-closed-when-unset pattern as the
  //     Continuity panel + /metrics. NO-TENANT-LEAK does not apply (admin-
  //     gated by construction).
  app.get("/api/admin/operations/panel", async (req: Request, res: Response) => {
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    if (!expected) {
      return res.status(401).json({ error: "operations_panel_disabled_no_admin_token" });
    }
    let isAdmin = false;
    if (provided.length === expected.length) {
      try {
        isAdmin = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      } catch {
        isAdmin = false;
      }
    }
    if (!isAdmin) {
      return res.status(401).json({ error: "unauthorized" });
    }

    try {
      const bossLocks = _bossInFlightStats();
      const continuityTick = _continuityTickInflightStats();
      const miActiveJobs = _activeJobsStats();

      // Retry-loop detection: campaigns with ≥3 `failed` decisions in 24h.
      // Uses the same jsonb_array_elements + GROUP BY pattern as the
      // continuity panel's skip-reason histogram. HAVING ≥3 keeps the
      // panel signal-dense (1–2 retries are normal).
      const retryRows = await db.execute(drizzleSql`
        SELECT (note->>'campaignId') AS campaign_id, COUNT(*)::int AS count
        FROM ${continuityTicks},
             jsonb_array_elements(${continuityTicks.notes}) AS note
        WHERE ${continuityTicks.tickAt} >= NOW() - INTERVAL '24 hours'
          AND (note->>'decision') = 'failed'
        GROUP BY (note->>'campaignId')
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC
        LIMIT 25
      `);
      const retryRowsArr =
        (retryRows as unknown as { rows: Array<{ campaign_id: string | null; count: number }> })
          .rows ?? [];
      const retryLoopCampaigns = retryRowsArr
        .filter((r) => r.campaign_id)
        .map((r) => ({
          campaignId: r.campaign_id as string,
          failedCount24h: Number(r.count) || 0,
        }));

      // Stuck claims: status='in_progress' AND claimed_at < NOW() - 2h.
      // A leaked claim row blocks the next-tick re-claim because the
      // ON CONFLICT DO NOTHING fails. Operators must DELETE the row
      // manually (covered in the operator handoff one-pager).
      const stuckRows = await db
        .select({
          campaignId: continuityWindowClaims.campaignId,
          planId: continuityWindowClaims.planId,
          windowIndex: continuityWindowClaims.windowIndex,
          claimedBy: continuityWindowClaims.claimedBy,
          claimedAt: continuityWindowClaims.claimedAt,
        })
        .from(continuityWindowClaims)
        .where(
          drizzleSql`${continuityWindowClaims.status} = 'in_progress' AND ${continuityWindowClaims.claimedAt} < NOW() - INTERVAL '2 hours'`,
        )
        .orderBy(continuityWindowClaims.claimedAt)
        .limit(25);
      const now = Date.now();
      const stuckClaims = stuckRows.map((r) => ({
        campaignId: r.campaignId,
        planId: r.planId,
        windowIndex: r.windowIndex,
        claimedBy: r.claimedBy,
        claimedAt:
          r.claimedAt instanceof Date ? r.claimedAt.toISOString() : String(r.claimedAt),
        ageMinutes: Math.round(
          (now - (r.claimedAt instanceof Date ? r.claimedAt.getTime() : new Date(String(r.claimedAt)).getTime())) /
            60000,
        ),
      }));

      return res.status(200).json({
        bossLocks,
        continuityTick,
        miActiveJobs,
        retryLoopCampaigns,
        stuckClaims,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[OperationsPanel] PANEL_LOAD_FAILED", err);
      return res.status(500).json({ error: "operations_panel_load_failed" });
    }
  });

  // secret, NOT by the JWT-based admin account check used elsewhere. Two
  // reasons: (1) Prometheus scrapers/uptime probes are stateless processes
  // that cannot mint JWTs; (2) the metrics surface is operational
  // infrastructure, separate from product admin. When METRICS_ADMIN_TOKEN
  // is unset the endpoint is closed (401 to all callers) — fail-safe by
  // default. Constant-time compare prevents timing oracles on the secret.
  app.get("/metrics", async (req: Request, res: Response) => {
    const expected = process.env.METRICS_ADMIN_TOKEN;
    const provided = req.header("x-admin-token") ?? "";
    if (!expected) {
      return res.status(401).type("text/plain").send("metrics endpoint disabled (METRICS_ADMIN_TOKEN unset)\n");
    }
    // Constant-time comparison — both sides padded to the same length first.
    const a = Buffer.from(expected);
    const b = Buffer.from(provided.padEnd(expected.length, "\0").slice(0, expected.length));
    let ok = a.length === provided.length;
    try {
      // node:crypto.timingSafeEqual throws if lengths differ; we already
      // forced equal length above so the throw path is purely defensive.
      ok = ok && timingSafeEqual(a, b);
    } catch {
      ok = false;
    }
    if (!ok) {
      return res.status(401).type("text/plain").send("unauthorized\n");
    }
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    // Seal #13 / Track #1 — continuity metrics are concatenated to the
    // primary registry's exposition. Same Prometheus 0.0.4 text format.
    // Task #64 / Phase 1 — CV-06 (Memory Provenance Verification) family
    // appended to the same exposition.
    const { renderCv06Metrics } = require("./memory-system/cv06-metrics") as typeof import("./memory-system/cv06-metrics");
    // Task #68 / Phase 5 Step 7 — CV-04 (Contract Completeness Verification)
    // family appended to the same exposition.
    const { renderCv04Metrics } = require("./orchestrator/contract-registry/cv04-metrics") as typeof import("./orchestrator/contract-registry/cv04-metrics");
    // Task #89 / Phase 4-A — CV-13 ReplayCorpusFreshness family.
    const { renderCv13Metrics, refreshCassetteAgeFromDb } = require("./orchestrator/replay/cv13-metrics") as typeof import("./orchestrator/replay/cv13-metrics");
    const { pool: metricsPool } = require("./db") as typeof import("./db");
    // Refresh cv13_replay_age_max_hours intrinsically at scrape time so the
    // gauge is accurate without depending on the admin panel being exercised.
    await refreshCassetteAgeFromDb((sql) => metricsPool.query(sql));
    return res.status(200).send(renderMetrics() + "\n" + renderContinuityMetrics() + "\n" + renderCv06Metrics() + "\n" + renderCv04Metrics() + "\n" + renderCv13Metrics());
  });

  const PUBLIC_PATH_PREFIXES = [
    "/auth/",
    "/stripe/webhook",
    "/onboarding/track",
    "/proxy/health",
    "/version",
  ];

  // ─── Phase 8.0 (Main migration) §2.7.1 ─────────────────────────────
  // Pipeline-overlay dashboard middleware. MUST mount above the /api auth
  // gate so the cookie-gated browser navigation (HttpOnly pipelineOverlayToken)
  // runs before any JWT-Authorization-header handler. Reconstructed from the
  // manifest spec (the bundle ships only the two HTML templates; the original
  // Remix server/index.ts L205-293 was not part of the 61-file copy set).
  // ───────────────────────────────────────────────────────────────────
  const PIPELINE_OVERLAY_COOKIE = "pipelineOverlayToken";
  const PIPELINE_OVERLAY_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h, per spec.

  function readPipelineOverlayCookie(req: Request): string | null {
    const raw = req.headers.cookie;
    if (!raw) return null;
    for (const part of raw.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      if (name !== PIPELINE_OVERLAY_COOKIE) continue;
      const value = part.slice(eq + 1).trim();
      try { return decodeURIComponent(value); } catch { return value; }
    }
    return null;
  }

  function pipelineOverlayCookieAttrs(maxAgeSeconds: number): string {
    const isProd = process.env.NODE_ENV === "production";
    const attrs = [
      `Path=/admin/pipeline-overlay`,
      `Max-Age=${maxAgeSeconds}`,
      "HttpOnly",
      "SameSite=Strict",
    ];
    if (isProd) attrs.push("Secure");
    return attrs.join("; ");
  }

  function getOverlayAdminToken(req: Request): string | null {
    // Header precedence over cookie (per §2.7.1) — supports both browser
    // navigation (cookie) and curl/scripted access (Authorization: Bearer X).
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
    return readPipelineOverlayCookie(req);
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/admin/pipeline-overlay/login") {
      if (req.method === "GET") {
        try {
          const html = fs.readFileSync(
            path.resolve(process.cwd(), "server", "templates", "pipeline-overlay-login.html"),
            "utf8",
          );
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).send(html);
        } catch (err) {
          console.error("[PipelineOverlay] failed to read login template:", err);
          return res.status(500).json({ error: "template_read_failed" });
        }
      }
      if (req.method === "POST") {
        const body = (req.body ?? {}) as { token?: unknown };
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!token) return res.status(400).json({ error: "token required" });
        const accountId = verifyAdminToken(token);
        if (!accountId) return res.status(401).json({ error: "invalid or non-admin token" });
        const cookieValue = encodeURIComponent(token);
        res.setHeader(
          "Set-Cookie",
          `${PIPELINE_OVERLAY_COOKIE}=${cookieValue}; ${pipelineOverlayCookieAttrs(PIPELINE_OVERLAY_COOKIE_MAX_AGE_SECONDS)}`,
        );
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: "method not allowed" });
    }

    if (req.path === "/admin/pipeline-overlay/logout") {
      if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
      // Clear cookie by setting Max-Age=0 with the same Path so the browser
      // evicts it. Other attrs must match the original to ensure eviction.
      res.setHeader(
        "Set-Cookie",
        `${PIPELINE_OVERLAY_COOKIE}=; ${pipelineOverlayCookieAttrs(0)}`,
      );
      return res.status(200).json({ ok: true });
    }

    if (req.path === "/admin/pipeline-overlay") {
      if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
      const token = getOverlayAdminToken(req);
      if (!token || !verifyAdminToken(token)) {
        // 302 to login per §2.7.1. No-store to defeat back-button cache.
        res.setHeader("Cache-Control", "no-store");
        return res.redirect(302, "/admin/pipeline-overlay/login");
      }
      try {
        const html = fs.readFileSync(
          path.resolve(process.cwd(), "server", "templates", "pipeline-overlay.html"),
          "utf8",
        );
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(html);
      } catch (err) {
        console.error("[PipelineOverlay] failed to read dashboard template:", err);
        return res.status(500).json({ error: "template_read_failed" });
      }
    }

    return next();
  });
  // ─── end §2.7.1 dashboard middleware ───────────────────────────────

  app.use("/api", (req, res, next) => {
    const subPath = req.path;
    const isPublic = PUBLIC_PATH_PREFIXES.some(p => subPath.startsWith(p) || subPath === p);
    if (isPublic) {
      return optionalAuth(req as any, res, next);
    }
    return authMiddleware(req as any, res, next);
  });

  // Phase 8.0 (Main migration) §2.7 — mount adaptive pipeline JSON router.
  // After the /api auth gate (which sets req.accountId from JWT), before
  // registerRoutes (so /api/pipeline/* takes precedence over any later
  // catch-all). Router self-protects with adminMiddleware internally.
  app.use("/api/pipeline", pipelineRouter);

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  // Phase 4 (2026-04-30) — scheduler timers (assigned inside listen callback,
  // cleared in gracefulShutdown).
  //
  // Track #3 / Seal #15 — silent-degradation hardening.
  // The previous implementation declared `userScrapeTimer` and
  // `competitorFetchTimer` only, while THREE additional inline schedulers
  // (tombstone reaper, meta-token health check, the reaper's outer
  // setTimeout-then-setInterval cascade) were created without a stored
  // handle, meaning SIGTERM could not stop them. We now declare a handle
  // for every inline scheduler so gracefulShutdown can clear them all.
  let userScrapeTimer: ReturnType<typeof setInterval> | null = null;
  let competitorFetchTimer: ReturnType<typeof setInterval> | null = null;
  let tombstoneReaperTimer: ReturnType<typeof setInterval> | null = null;
  let tombstoneReaperBootTimer: ReturnType<typeof setTimeout> | null = null;
  let metaHealthBootTimer: ReturnType<typeof setTimeout> | null = null;
  let metaHealthIntervalTimer: ReturnType<typeof setInterval> | null = null;

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);

  // owned by `npm run db:migrate`. Single-instance Replit operators may
  // opt-in to apply-at-boot with BOOT_AUTO_MIGRATE=true.
  const autoMigrate = process.env.BOOT_AUTO_MIGRATE === "true";
  try {
    if (autoMigrate) {
      const r = await runMigrations();
      logger.info(
        { component: "migrations", lastVersion: r.lastVersion, applied: r.applied.length, mode: "auto" },
        "migrations complete",
      );
    } else {
      const v = await verifySchemaFloor();
      logger.info(
        { component: "migrations", lastVersion: v.lastVersion, mode: "verify-only" },
        "schema floor verified",
      );
    }
  } catch (err) {
    logger.error(
      { component: "migrations", err: String(err), mode: autoMigrate ? "auto" : "verify-only" },
      "boot schema check FAILED — refusing to start",
    );
    captureException(err, { phase: "boot-migrations" });
    // Pass-11: explicit flush instead of arbitrary 500ms wait — guarantees
    // the boot-failure event reaches Sentry before the process dies.
    await flushSentry(2000);
    process.exit(1);
  }

  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
      startAutonomousWorker();
      startPublishWorker();
      startSnapshotCleanupWorker();
      // Seal #13 / Track #1 — operational continuity heartbeat. Hourly
      // tick + idempotent runBoss invocation per campaign. First tick
      // 60s post-listen so other workers are up first. Disabled by
      // CONTINUITY_SCHEDULER_DISABLED=true (used by tests).
      startContinuityScheduler();
      // Seal #14 / Track #2 — continuity supervisor (the watcher of the
      // watchers). Detects scheduler heartbeat-stale + per-chain lag
      // across the 10-chain operational registry.
      startContinuitySupervisor();
      log(`[Server] Continuity layer up — replicaId=${getReplicaId()}`);

      invalidateStaleSnapshots().catch(err => console.error("[MIv3] Startup snapshot invalidation error:", err));

      // boot is fast; subsequent ticks every 24h. cascadeDeleteAccount is
      // transactional, so a failed reap rolls back and retries next tick.
      // Track #3 / Seal #15 — store every timer handle so SIGTERM clears
      // them. The previous code created the inner setInterval inside an
      // anonymous setTimeout closure with no handle stored, so the reaper
      // and meta-token health interval kept ticking after gracefulShutdown
      // cleared the workers above (zombie schedulers).
      const REAPER_INTERVAL_MS = 24 * 60 * 60 * 1000;
      tombstoneReaperBootTimer = setTimeout(() => {
        runTombstoneReaper().catch(err => logger.error({ component: "reaper", err: String(err) }, "reaper tick failed"));
        tombstoneReaperTimer = setInterval(() => {
          runTombstoneReaper().catch(err => logger.error({ component: "reaper", err: String(err) }, "reaper tick failed"));
        }, REAPER_INTERVAL_MS);
      }, 60_000);

      metaHealthBootTimer = setTimeout(() => {
        runAllHealthChecks().catch(err => console.error("[MetaHealth] Initial health check error:", err));
      }, 30000);

      const HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
      metaHealthIntervalTimer = setInterval(() => {
        runAllHealthChecks().catch(err => console.error("[MetaHealth] Scheduled health check error:", err));
      }, HEALTH_CHECK_INTERVAL_MS);

      // ─── Phase 4 (2026-04-30) — User-channel 48h scheduler ──────────────
      // Hourly tick across ALL active campaigns (autopilot or not). Gates on
      // needsUserChannelScrape (24-48h hash-spread per profile) before calling
      // scrapeUserChannels. Strict invariant: scraper only writes to
      // user_channel_snapshots; never mutates DNA, never triggers strategy.
      const USER_SCRAPE_TICK_MS = 60 * 60 * 1000;
      userScrapeTimer = setInterval(() => {
        (async () => {
          try {
            const { needsUserChannelScrape, scrapeUserChannels } = await import("./user-channel-scraper");
            const { db: dbRef } = await import("./db");
            const { campaignSelections } = await import("@shared/schema");
            const sels = await dbRef.select().from(campaignSelections);
            for (const s of sels) {
              if (!s.selectedCampaignId) continue;
              try {
                if (await needsUserChannelScrape(s.accountId, s.selectedCampaignId)) {
                  console.log(`[Scheduler:user48h] scraping ${s.accountId}/${s.selectedCampaignId}`);
                  await scrapeUserChannels(s.accountId, s.selectedCampaignId);
                }
              } catch (e: any) {
                console.warn(`[Scheduler:user48h] ${s.accountId}/${s.selectedCampaignId} — ${e?.message || e}`);
              }
            }
          } catch (e) {
            console.error("[Scheduler:user48h] tick error:", e);
          }
        })();
      }, USER_SCRAPE_TICK_MS);

      // ─── Phase 4 (2026-04-30) — Competitor weekly scheduler ─────────────
      // Hourly tick across ALL active campaigns. Enqueues a fetch job (via
      // startFetchJob) when the most-recent ci_competitor_metrics_snapshot.last_fetch_at
      // is older than 7 days. The fetch-orchestrator already dedupes
      // RUNNING/QUEUED jobs and per-account creation locks. Strict invariant:
      // never mutates DNA, never triggers strategy.
      const COMPETITOR_FETCH_TICK_MS = 60 * 60 * 1000;
      const COMPETITOR_FETCH_STALE_MS = 7 * 24 * 60 * 60 * 1000;
      competitorFetchTimer = setInterval(() => {
        (async () => {
          try {
            const { db: dbRef } = await import("./db");
            const { campaignSelections, miFetchJobs } = await import("@shared/schema");
            const { startFetchJob } = await import("./market-intelligence-v3/fetch-orchestrator");
            const drizzle = await import("drizzle-orm");
            const sels = await dbRef.select().from(campaignSelections);
            const cutoff = new Date(Date.now() - COMPETITOR_FETCH_STALE_MS);
            for (const s of sels) {
              if (!s.selectedCampaignId) continue;
              try {
                // mi_fetch_jobs is the campaign-keyed source of truth for the
                // competitor lane. We use the most recent completedAt with
                // status=DONE as the staleness anchor.
                const [latest] = await dbRef
                  .select({ completedAt: miFetchJobs.completedAt })
                  .from(miFetchJobs)
                  .where(drizzle.and(
                    drizzle.eq(miFetchJobs.accountId, s.accountId),
                    drizzle.eq(miFetchJobs.campaignId, s.selectedCampaignId),
                    drizzle.eq(miFetchJobs.status, "DONE"),
                  ))
                  .orderBy(drizzle.desc(miFetchJobs.completedAt))
                  .limit(1);
                const last = latest?.completedAt;
                if (!last || last < cutoff) {
                  const jobId = await startFetchJob(s.accountId, s.selectedCampaignId);
                  console.log(`[Scheduler:competitorWeekly] enqueued ${jobId} for ${s.accountId}/${s.selectedCampaignId} (last=${last ? last.toISOString() : "never"})`);
                }
              } catch (e: any) {
                const msg = e?.message || String(e);
                // "No active competitors" / "already in progress" are normal — log quietly.
                if (!/No active competitors|already in progress|Reusing/i.test(msg)) {
                  console.warn(`[Scheduler:competitorWeekly] ${s.accountId}/${s.selectedCampaignId} — ${msg}`);
                }
              }
            }
          } catch (e) {
            console.error("[Scheduler:competitorWeekly] tick error:", e);
          }
        })();
      }, COMPETITOR_FETCH_TICK_MS);
    },
  );

  async function gracefulShutdown(signal: string) {
    log(`[Server] ${signal} received — shutting down gracefully...`);
    stopAutonomousWorker();
    await stopPublishWorker();
    stopSnapshotCleanupWorker();
    await stopContinuityScheduler();
    await stopContinuitySupervisor();
    // Track #3 / Seal #15 — the MI queue processor was started inline by
    // server/market-intelligence-v3/index.ts on boot but never wired into
    // shutdown. Without this stop, the 15s setInterval kept ticking
    // through SIGTERM and could attempt to claim work after the rest of
    // the process had begun tearing down.
    try { stopMiQueueProcessor(); } catch (e) { console.error("[Server] stopMiQueueProcessor failed:", e); }
    if (userScrapeTimer) { clearInterval(userScrapeTimer); userScrapeTimer = null; }
    if (competitorFetchTimer) { clearInterval(competitorFetchTimer); competitorFetchTimer = null; }
    // Track #3 / Seal #15 — clear every inline timer that previously had
    // no handle stored. Without these clears the tombstone reaper +
    // meta-token health check kept firing past SIGTERM.
    if (tombstoneReaperBootTimer) { clearTimeout(tombstoneReaperBootTimer); tombstoneReaperBootTimer = null; }
    if (tombstoneReaperTimer) { clearInterval(tombstoneReaperTimer); tombstoneReaperTimer = null; }
    if (metaHealthBootTimer) { clearTimeout(metaHealthBootTimer); metaHealthBootTimer = null; }
    if (metaHealthIntervalTimer) { clearInterval(metaHealthIntervalTimer); metaHealthIntervalTimer = null; }
    server.close(() => {
      log("[Server] HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      log("[Server] Force exit after timeout");
      process.exit(1);
    }, 15000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Pass-11: fatal-exit Sentry flush. Architect-review feedback —
  // `initSentry().catch(...)` in bootstrap.ts is non-blocking, so the SDK may
  // not have finished loading at the moment a very-early uncaughtException
  // fires. The flushSentry() helper is safe-no-op when the shim wasn't ready
  // (returns immediately). When the SDK IS ready we get up to 2s to drain
  // queued events to Sentry before the process exits 1.
  process.on("uncaughtException", async (err) => {
    try {
      logger.error({ component: "process", err: String(err), stack: err?.stack }, "uncaughtException — process exiting");
    } catch { /* never throw from telemetry */ }
    captureException(err, { phase: "uncaughtException" });
    await flushSentry(2000);
    process.exit(1);
  });
  process.on("unhandledRejection", async (reason) => {
    try {
      logger.error({ component: "process", reason: String(reason) }, "unhandledRejection — process exiting");
    } catch { /* never throw from telemetry */ }
    captureException(reason, { phase: "unhandledRejection" });
    await flushSentry(2000);
    process.exit(1);
  });
})();
