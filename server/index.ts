// Bootstrap MUST be the first import — it runs validateEnv() → initOTel() →
// initSentry() at module-top-level. ESM evaluates imports in declaration
// order, so any module imported below will see a validated environment and
// initialized observability. Do not reorder.
import "./bootstrap";
import { captureException, isSentryEnabled } from "./observability/sentry";

import { runStartupArtifactGuard } from "./startup-artifact-guard";
runStartupArtifactGuard();

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { startAutonomousWorker, stopAutonomousWorker } from "./autonomous-worker";
import { startPublishWorker, stopPublishWorker } from "./publish-worker";
import { startSnapshotCleanupWorker, stopSnapshotCleanupWorker } from "./snapshot-cleanup-worker";
import { runAllHealthChecks } from "./meta-token-manager";
// Seal #7 (F10.1) — single migration runner. Per session-plan T8 +
// architect-review pass-4: boot only VERIFIES the schema floor. Schema
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
  // Seal #7 (F10.6) — pino-shaped structured logger with traceId.
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
      // Seal #7 (F10.7) — every HTTP request observed in the histogram so
      // /metrics has signal even for non-/api routes (landing, healthz).
      try {
        recordHttpRequest(req.method, path, res.statusCode, durationMs / 1000);
      } catch { /* never let telemetry break a request */ }

      if (!path.startsWith("/api")) return;

      // Seal #7 (F9.5) — strip token-shaped fields BEFORE serialization.
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
  // Seal #7 (F9.1) — host-header XSS / open-redirect fix.
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
      // Seal #7 (F9.1) — same host-header fix as serveLandingPage.
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
    // Seal #7 (F10.8) — surface 5xx to Sentry (no-op when DSN unset).
    if (status >= 500) {
      try {
        captureException(err, {
          traceId: req.traceId,
          method: req.method,
          path: req.path,
        });
      } catch { /* never let telemetry crash the handler */ }
    }
    // Seal #7 — production hides upstream messages from clients (info leak)
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

  // Seal #7 (F10.7) — /metrics is gated by the static METRICS_ADMIN_TOKEN
  // secret, NOT by the JWT-based admin account check used elsewhere. Two
  // reasons: (1) Prometheus scrapers/uptime probes are stateless processes
  // that cannot mint JWTs; (2) the metrics surface is operational
  // infrastructure, separate from product admin. When METRICS_ADMIN_TOKEN
  // is unset the endpoint is closed (401 to all callers) — fail-safe by
  // default. Constant-time compare prevents timing oracles on the secret.
  app.get("/metrics", (req: Request, res: Response) => {
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
    return res.status(200).send(renderMetrics());
  });

  const PUBLIC_PATH_PREFIXES = [
    "/auth/",
    "/stripe/webhook",
    "/onboarding/track",
    "/proxy/health",
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
  let userScrapeTimer: ReturnType<typeof setInterval> | null = null;
  let competitorFetchTimer: ReturnType<typeof setInterval> | null = null;

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);

  // Seal #7 (F10.1) — boot verifies the schema floor; schema mutations are
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
    // Give Sentry a moment to flush before exit.
    await new Promise((resolve) => setTimeout(resolve, 500));
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

      invalidateStaleSnapshots().catch(err => console.error("[MIv3] Startup snapshot invalidation error:", err));

      // Seal #7 (F9.9) — daily tombstone reaper. First tick after 1min so
      // boot is fast; subsequent ticks every 24h. cascadeDeleteAccount is
      // transactional, so a failed reap rolls back and retries next tick.
      const REAPER_INTERVAL_MS = 24 * 60 * 60 * 1000;
      setTimeout(() => {
        runTombstoneReaper().catch(err => logger.error({ component: "reaper", err: String(err) }, "reaper tick failed"));
        setInterval(() => {
          runTombstoneReaper().catch(err => logger.error({ component: "reaper", err: String(err) }, "reaper tick failed"));
        }, REAPER_INTERVAL_MS);
      }, 60_000);

      setTimeout(() => {
        runAllHealthChecks().catch(err => console.error("[MetaHealth] Initial health check error:", err));
      }, 30000);

      const HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
      setInterval(() => {
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
    if (userScrapeTimer) { clearInterval(userScrapeTimer); userScrapeTimer = null; }
    if (competitorFetchTimer) { clearInterval(competitorFetchTimer); competitorFetchTimer = null; }
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
})();
