---
name: Avyron deploy/boot failure modes
description: Why Avyron autoscale publishes can fail at the build or promote/health-check step.
---

# Avyron deploy / boot failure modes

Deploy: autoscale, build = `npm run expo:static:build && node scripts/server-build.js` (esbuild),
run = `npm run server:prod` = `node server_dist/index.js`. Autoscale promote requires
`GET /` to return 200. A crash-on-boot fails promote → publish fails, even though the
build step passed.

## @shared/* path aliases must be explicitly bundled (esbuild --packages=external)
`--packages=external` externalises ALL bare imports including local path-alias modules
(`@shared/schema`, `@shared/contracts`, `@shared/perception-translator`). These are NOT
real npm packages — they live in `shared/`. The server compiles fine but crashes at
runtime with `ERR_MODULE_NOT_FOUND`.
**Fix:** `scripts/server-build.js` passes explicit `--alias:@shared/X=./shared/X` flags.
The deploy build command now uses this script instead of `npm run server:build`.
**How to apply:** any new `@shared/*` alias added to `tsconfig.json` paths MUST also
get a corresponding `--alias` line in `scripts/server-build.js`.

## ESM bundle + CommonJS `module` variable = boot crash
esbuild `--format=esm` output + `require.main === module` pattern = `ReferenceError:
module is not defined`. esbuild shims `require` as `__require` (making
`typeof require !== "undefined"` truthy) but leaves the bare `module` identifier
undefined in ESM scope — so the check short-circuits to the crash, not the false branch.
**Fix:** `server/migrations/runner.ts` isCliEntryPoint() now guards with
`typeof module !== "undefined"` before touching `module`.
**How to apply:** any new CJS-style `require.main === module` guard in server code needs
the same three-way check.

## Web export step can stall and kill the whole build
`scripts/build.js` kills its Metro process for iOS/Android before starting `expo export
--platform web`. If port 8081 isn't released quickly enough, the web export Metro stalls
(shows constant progress %) with no timeout — the build hangs until Replit's cloud kills
the container, marking the build failed.
**Fix:** 3-second pause after Metro kill + hard 90-second timeout on the web export
process (non-fatal: resolves and continues if exceeded).
**How to apply:** the web export is non-critical — mobile manifests are already built.
If the export times out the build continues and serves iOS/Android correctly.

## esbuild does not catch runtime ReferenceErrors
`server:build` (esbuild `--bundle`) will happily bundle a route that references an
identifier that was never imported (e.g. a middleware). It only blows up at runtime as
`ReferenceError: X is not defined` when `registerRoutes()` runs at boot. So a green
server build is NOT proof the server boots — always do a real boot (restart the
workflow, curl `/` and `/healthz`).

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
deploy will crash-loop at boot. Dev and prod DBs are separate; a green dev boot does not
prove prod schema is current.

## Prod-only secret crashes
`server/auth.ts` throws at module load in production only when NEITHER JWT_SECRET nor
SESSION_SECRET is set (2026-07-08: SESSION_SECRET accepted as JWT signing alias; the
env-validator mirrors it into JWT_SECRET and logs the aliasing). STRIPE_WEBHOOK_SECRET
is no longer boot-fatal: the webhook route fails closed (503) until it is set.

## Promote-failure symptom = boot crash with no logs
A publish that fails ~2 min AFTER "Creating Autoscale service" (build phase green) is a
server boot crash. `fetch_deployment_logs` retains NOTHING from a failed promote — debug
by simulating a prod boot locally (NODE_ENV=production + prod-shaped env, import
env-validator/auth via a tsx harness) rather than hunting for runtime logs.
Use `listDeploymentBuilds` + `getDeploymentBuild` to get the actual build logs and
determine whether failure was in the build phase or promote phase.
