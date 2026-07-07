---
name: Avyron deploy/boot failure modes
description: Why Avyron autoscale publishes can fail at the promote/health-check step even when the build succeeds.
---

# Avyron deploy / boot failure modes

Deploy: autoscale, build = `npm run expo:static:build && npm run server:build` (esbuild),
run = `npm run server:prod` = `node server_dist/index.js`. Autoscale promote requires
`GET /` to return 200. A crash-on-boot fails promote → publish fails, even though the
build step passed.

## esbuild does not catch runtime ReferenceErrors
`server:build` (esbuild `--bundle`) will happily bundle a route that references an
identifier that was never imported (e.g. a middleware). It only blows up at runtime as
`ReferenceError: X is not defined` when `registerRoutes()` runs at boot. So a green
`server:build` is NOT proof the server boots — always do a real boot (restart the
workflow, curl `/` and `/healthz`).

**Why:** an unimported `authMiddleware` on one `/api` route crash-looped prod and made
dev "Start Backend" FAILED; the build step gave no signal.

## Global /api auth gate — do not add per-route authMiddleware
`server/index.ts` applies `app.use("/api", ... authMiddleware)` as a GLOBAL gate,
registered BEFORE `registerRoutes(app)`. Public exceptions live in
`PUBLIC_PATH_PREFIXES` (/auth/, /stripe/webhook, /onboarding/track, /proxy/health,
/version). New authenticated `/api` routes should rely on that gate and add only
`aiRateLimitPerAccount(), aiSpendCapPerAccount()` (matching the sibling AI routes).
Adding an inline `authMiddleware` is redundant (double-auth) and, if not imported into
`routes.ts`, is a boot-crash.

## Prod is verify-only unless BOOT_AUTO_MIGRATE=true
Boot migration path: `autoMigrate = process.env.BOOT_AUTO_MIGRATE === "true"` (default
false → `verifySchemaFloor()` only). `REQUIRED_SCHEMA_VERSION` is enforced at boot; if
the DB is below it the server logs "boot schema check FAILED" and `process.exit(1)`.
**How to apply:** any code bump that adds a migration (raising REQUIRED_SCHEMA_VERSION)
requires the PROD DB to be migrated independently — run `npm run db:migrate` against the
production DATABASE_URL, or set `BOOT_AUTO_MIGRATE=true` as a deploy env var — or the
deploy will crash-loop at boot exactly like an unimported identifier. Dev and prod DBs
are separate; a green dev boot does not prove prod schema is current.

## Prod-only secret crashes
`server/auth.ts` throws at module load when `NODE_ENV=production && !JWT_SECRET`.
Missing JWT_SECRET / STRIPE_WEBHOOK_SECRET (warn-only in dev) crash-loop the deploy the
same way. Confirm deploy secrets before publishing.
