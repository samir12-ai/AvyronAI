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

## CLI entry-point detection MUST be filename-based in a bundled server
Any `if (isEntryPoint()) { …; process.exit() }` CLI block bundled into the single-file
server is a self-kill trap. `require.main === module` crashes in ESM output
(`module` undefined), and the "safe" ESM check
`fileURLToPath(import.meta.url) === process.argv[1]` ALSO misfires: inside an esbuild
bundle `import.meta.url` IS the bundle file, which equals argv[1] — so the prod server
ran the migration CLI at boot and `process.exit(0)`-ed seconds after `listen()`
(promote failure: "required port was never opened"). Insidious because the server logs
"serving on port N" first, then dies.
**Fix:** detect by entry FILENAME only: regex on `process.argv[1]` for the module's own
path suffix (e.g. `/[/\\]migrations[/\\]runner\.(ts|js|mjs|cjs)$/`).
**How to apply:** never use `import.meta.url === argv[1]` or `require.main === module`
for CLI detection in anything bundled into server_dist — match argv[1]'s filename.

## Blocking pg_advisory_lock + CREATE INDEX CONCURRENTLY = boot deadlock
Under concurrent autoscale replica boots, a waiter blocked in
`SELECT pg_advisory_lock(...)` holds a snapshot for its whole wait; the lock holder's
`CREATE INDEX CONCURRENTLY` (from `-- noTransaction` migrations) waits for ALL
snapshots → mutual wait → Postgres kills one ("deadlock detected") → boot exit 1.
**Fix:** poll `pg_try_advisory_lock` in a loop (2s interval, 5-min deadline) — same
deterministic wait-or-throw contract, but no snapshot held between polls.
**How to apply:** any new advisory-lock wait that can coexist with CONCURRENTLY DDL
must poll, never block.

## Autoscale probes the localPort mapped to externalPort 80
`.replit` has many `[[ports]]` (dev Expo 8081→80, backend 5000→5000, etc.). Autoscale
requires the app to open the localPort whose externalPort is 80 — here 8081 — but
`[env] PORT="5000"` forced the prod server onto 5000 → "required port was never
opened, expected port 8081".
**Fix:** deploy run command is `sh -c "PORT=8081 npm run server:prod"` (shell-level
PORT beats `.replit [env]`). Dev is untouched (Expo dev owns 8081; backend 5000).
**How to apply:** if the 8081→80 mapping ever changes, the hardcoded PORT=8081 in the
deploy run command must change with it.

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
**DEV is verify-only too** (BOOT_AUTO_MIGRATE is unset in dev). Adding a numbered SQL
migration file + bumping REQUIRED_SCHEMA_VERSION is NOT enough: restarting the backend
NEVER applies pending SQL — it only re-runs the floor check and refuses to boot
("boot schema check FAILED — refusing to start", `mode:"verify-only"`). You MUST run the
standalone `npm run db:migrate` in dev to apply the new table/index. Symptom if you
forget: the backend won't boot, and any fresh `tsx` script (run-real-campaign, harnesses
— they don't run migrations) hits `relation "…" does not exist` / an ON CONFLICT insert
failure against the missing table, while a stale-booted server keeps running old schema.

## Prod-only secret crashes
`server/auth.ts` throws at module load in production only when NEITHER JWT_SECRET nor
SESSION_SECRET is set (2026-07-08: SESSION_SECRET accepted as JWT signing alias; the
env-validator mirrors it into JWT_SECRET and logs the aliasing). STRIPE_WEBHOOK_SECRET
is no longer boot-fatal: the webhook route fails closed (503) until it is set.

## Publish schema-sync vs own migration runner = collision on non-idempotent DDL
Replit's publish flow copies the DEV SCHEMA into the prod DB (tables/columns/triggers,
no data, no `schema_migrations` ledger rows). The app's own boot migration replay then
re-runs history against a DB that already contains the END-STATE objects. Any
non-idempotent step — especially RENAME (`ALTER TABLE x RENAME TO y` when `y` was
already synced in) — crashes boot even though both dev and a fresh DB migrate cleanly.
**Why:** the synced prod DB is a third schema state (end-state objects + empty ledger)
that neither "fresh" nor "up-to-date" testing covers.
**Fix pattern:** make every migration state-aware via `to_regclass()` checks in a DO
block (rename if only old exists; drop the replayed copy if both exist; no-op
otherwise). Editing an already-recorded migration file is safe — ledgered DBs never
re-execute it.
**How to verify:** simulate with a throwaway local PG: `pg_dump --schema-only` of dev
restored into it (= the sync), ledger rows set to prod's, replay the recreating
migration, then run the real runner. Note: background daemons (pg_ctl) die between
bash tool calls — combine start+work in one command or re-start defensively.

## Promote-failure symptom = boot crash with no logs
A publish that fails ~2 min AFTER "Creating Autoscale service" (build phase green) is a
server boot crash. `fetch_deployment_logs` retains NOTHING from a failed promote — debug
by simulating a prod boot locally (NODE_ENV=production + prod-shaped env, import
env-validator/auth via a tsx harness) rather than hunting for runtime logs.
Use `listDeploymentBuilds` + `getDeploymentBuild` to get the actual build logs and
determine whether failure was in the build phase or promote phase.
