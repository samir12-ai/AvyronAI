# Threat Model

## Project Overview

Avyron AI is a publicly deployed marketing automation platform with an Expo/React Native client and a TypeScript/Express backend backed by PostgreSQL. Users authenticate with email/password JWTs, manage campaign-scoped data, trigger AI-powered content and strategy workflows, connect social platform accounts, and upload media for processing.

For production scoping, assume `NODE_ENV=production`, Replit terminates TLS for deployed traffic, and only production-reachable code matters. Dev sandboxes, test harnesses, archived docs, and one-off scripts are out of scope unless production reachability is demonstrated.

## Assets

- **User accounts and sessions** — email addresses, password hashes, access tokens, refresh tokens, account lockout state, and account deletion workflows. Compromise enables impersonation and takeover.
- **Tenant business data** — campaign selections, strategy outputs, memory state, analytics, dashboard summaries, conversations, and generated plans. Cross-tenant exposure would leak proprietary business information.
- **Connected third-party credentials** — Stripe webhook trust material, Meta/Facebook/Instagram tokens, proxy credentials, OpenAI and Gemini secrets. Compromise can lead to account abuse, billing abuse, or further data access.
- **Uploaded and generated media** — photography/video uploads and generated assets. These can expose private business materials or enable stored content attacks if access control fails.
- **Operational/admin data** — metrics, continuity panels, replay cassettes, operator notices, and diagnostic views. These may contain sensitive internal state or tenant identifiers.
- **Audit and lifecycle records** — account deletion tombstones, auth lockouts, usage logs, and system-control/recovery traces. These can contain sensitive events or user-derived content.

## Trust Boundaries

- **Client to API boundary** — all mobile/web requests into `/api` are untrusted and must be authenticated, authorized, validated, and rate limited server-side.
- **Public to authenticated boundary** — public endpoints such as health/status/auth/webhook surfaces must remain separate from protected product APIs.
- **Authenticated to admin/operator boundary** — JWT-authenticated user routes and `X-Admin-Token`/admin-account routes must not leak into one another.
- **API to PostgreSQL boundary** — the server has broad database access, so injection or missing ownership checks can become full tenant-data compromise.
- **API to external service boundary** — the backend calls OpenAI, Gemini, Meta APIs, Bright Data, Apify, and Stripe. User-controlled inputs crossing this boundary must not enable SSRF, token leakage, or excessive spend.
- **API to filesystem/static boundary** — uploaded/generated assets and static `/uploads/*` publishing cross from private processing into public HTTP access.
- **Internal/dev to production boundary** — `scripts/`, tests, `.local/`, Expo dev helpers, and generated `server_dist/` should usually be ignored unless they are executed or served in production paths.

Current scan emphasis: plan-scoped endpoints must prove ownership on every `planId` lookup, public same-origin upload hosting must never serve active content like SVG as executable web documents, and infrastructure-only secrets such as `METRICS_ADMIN_TOKEN` must not double as broad product-data read credentials.

## Scan Anchors

- **Production entry point:** `server/index.ts` bootstraps middleware, public/admin routes, and the `/api` auth gate.
- **Route aggregation:** `server/routes.ts` registers most user-facing API surfaces; `server/auth.ts` owns JWT/session/auth logic.
- **Tenant isolation:** `server/campaign-routes.ts` `requireCampaign` and `server/auth-helpers.ts` ownership assertions are central trust checks.
- **Plan-scoped hot spots:** `server/execution-activation/routes.ts`, `server/execution-activation/engine.ts`, and `server/root-bundle.ts` accept `planId` inputs and need explicit account/campaign ownership checks.
- **High-risk integrations:** `server/competitive-intelligence/**`, `server/meta-token-manager.ts`, `server/video-routes.ts`, `server/photography-routes.ts`, and AI generation routes.
- **Admin/operator surfaces:** `/metrics`, `/healthz/continuity`, `/healthz/orchestrator-parity`, `/api/admin/**`, `/api/pipeline/**`, and `/admin/pipeline-overlay`.
- **Usually dev-only unless proven reachable:** `scripts/**`, `server/tests/**`, `.local/**`, archived audit docs, and generated `server_dist/**`.

## Threat Categories

### Spoofing

The application must prevent attackers from impersonating users, admins, or trusted services. All protected API endpoints must require a valid JWT with enforced signature, audience, issuer, and expiry checks. Refresh-token rotation, webhook signature verification, and operator/admin token validation must fail closed in production.

### Tampering

Attackers can influence request bodies, query parameters, campaign IDs, uploaded files, AI prompts, and third-party connection settings. The system must enforce ownership and authorization server-side for every tenant-scoped identifier, calculate security-sensitive decisions on trusted data, and reject malformed or out-of-scope inputs before they reach downstream engines, database writes, or external integrations.

### Information Disclosure

This project stores and generates sensitive business intelligence and may process user-supplied free text, social account data, and uploaded media. API responses, logs, admin panels, status pages, replay/debug artifacts, and public static asset routes must not expose secrets, raw tokens, private tenant data, or other users’ content. Public observability endpoints must remain aggregate-only unless correctly admin-gated.

### Denial of Service

The backend exposes costly AI, scraping, analytics, and media-processing operations. Public and authenticated routes must resist brute force, quota exhaustion, oversized uploads, pathological prompts, and repeated expensive requests. External calls must enforce timeouts and fail-safe degradation so one upstream outage or attacker-driven burst does not exhaust shared resources.

### Elevation of Privilege

The highest-impact failures in this codebase are broken access control and cross-tenant data access. A regular authenticated user must never gain admin/operator visibility, interact with another tenant’s campaigns/jobs/assets, or turn public endpoints into protected-data or spend-amplification oracles. File handling, ID-based lookups, and any raw database or dynamic object access must not permit privilege escalation.