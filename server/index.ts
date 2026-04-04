import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { startAutonomousWorker, stopAutonomousWorker } from "./autonomous-worker";
import { startPublishWorker, stopPublishWorker } from "./publish-worker";
import { startSnapshotCleanupWorker, stopSnapshotCleanupWorker } from "./snapshot-cleanup-worker";
import { runAllHealthChecks } from "./meta-token-manager";
import { migrateStrategyMemoryColumns } from "./migrations/002-strategy-memory-columns";
import { migrateUserChannelTables } from "./migrations/003-user-channel-tables";
import { migrateMemoryConfidenceDirection } from "./migrations/004-memory-confidence-direction";
import { invalidateStaleSnapshots } from "./market-intelligence-v3/engine-state";
import { authMiddleware, optionalAuth } from "./auth";
import * as fs from "fs";
import * as path from "path";

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
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    (req as any).requestId = requestId;
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
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
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
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

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

    if (req.path === "/data-deletion") {
      const deletionPath = path.resolve(process.cwd(), "server", "templates", "data-deletion.html");
      const deletionHtml = fs.readFileSync(deletionPath, "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(deletionHtml);
    }

    if (req.path === "/pricing") {
      const pricingPath = path.resolve(process.cwd(), "server", "templates", "pricing.html");
      const pricingHtml = fs.readFileSync(pricingPath, "utf-8");
      const forwardedProto = req.header("x-forwarded-proto");
      const protocol = forwardedProto || req.protocol || "https";
      const forwardedHost = req.header("x-forwarded-host");
      const host = forwardedHost || req.get("host");
      const baseUrl = `${protocol}://${host}`;
      const finalHtml = pricingHtml
        .replace(/BASE_URL_PLACEHOLDER/g, baseUrl);
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
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
      name?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    if (status >= 500) {
      console.error(`[ErrorHandler] ${status} — ${error.name || "Error"}:`, err);
    } else {
      console.warn(`[ErrorHandler] ${status} — ${error.name || "Error"}: ${message}`);
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  const PUBLIC_PATH_PREFIXES = [
    "/auth/",
    "/stripe/webhook",
    "/onboarding/track",
  ];

  app.use("/api", (req, res, next) => {
    const subPath = req.path;
    const isPublic = PUBLIC_PATH_PREFIXES.some(p => subPath.startsWith(p) || subPath === p);
    if (isPublic) {
      return optionalAuth(req as any, res, next);
    }
    return authMiddleware(req as any, res, next);
  });

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
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

      migrateStrategyMemoryColumns().catch(err => console.error("[Migration-002] strategy_memory column migration error:", err));
      migrateUserChannelTables().catch(err => console.error("[Migration-003] user channel tables migration error:", err));
      migrateMemoryConfidenceDirection().catch(err => console.error("[Migration-004] memory confidence direction migration error:", err));

      setTimeout(() => {
        runAllHealthChecks().catch(err => console.error("[MetaHealth] Initial health check error:", err));
      }, 30000);

      const HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
      setInterval(() => {
        runAllHealthChecks().catch(err => console.error("[MetaHealth] Scheduled health check error:", err));
      }, HEALTH_CHECK_INTERVAL_MS);
    },
  );

  async function gracefulShutdown(signal: string) {
    log(`[Server] ${signal} received — shutting down gracefully...`);
    stopAutonomousWorker();
    await stopPublishWorker();
    stopSnapshotCleanupWorker();
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
