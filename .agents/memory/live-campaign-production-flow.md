---
name: Driving a live campaign through the production plan flow
description: How to make a campaign scheduler-eligible via real routes, auth-layer JWT minting, and the gates/timeouts that bite along the way
---

## Rule
To validate the production pipeline on a live campaign, drive it exclusively through
the real HTTP routes (business-data PUT → strategic init → extract → confirm → analyze
→ validate → orchestrate → approve-plan). The only acceptable bypass is minting a JWT
with the server's own signing config (JWT_SECRET || SESSION_SECRET, aud `avyron-ai`,
iss `avyron-auth`) — auth layer only; every gate and ownership check still runs.

**Why:** direct DB inserts or script-level orchestrator calls skip status gates,
version checks, and audit rows, so they prove nothing about production readiness.

**How to apply:**
- Manual boss runs: `POST /api/pipeline/boss/run` is adminMiddleware-gated (admin
  account allowlist in server/auth.ts); `scope.forceFreshAcquisition=true` is a real
  operator capability and defeats acquisition cache hits.
- Continuity scheduler ticks hourly but fires 60s post-listen — restarting the backend
  is the fastest legitimate way to trigger a pickup after plan approval.
- CAUTION: restarts kill in-flight async work, and execution activation (APPROVED plan
  → ACTIVATING) has NO boot-time recovery sweep — an interrupted activation stays stuck
  at ACTIVATING until the manual retry route is called.

## Gates observed to be advisory, not blocking
- Blueprint validation can flag a **critical** contradiction and still set VALIDATED.
- The 15-engine run inside plan synthesis can end BLOCKED_BY_INTEGRITY (engines timed
  out at the production 180s budget → missing upstream snapshots) and plan sections
  are synthesized anyway; plan reaches APPROVED with fallback=false. Engine outputs
  are NOT a hard input to plan synthesis.
- Production per-engine timeout is 180s; validation harnesses historically used a 420s
  override — expect real campaigns to time out engines that pass in harness runs.

## Watchtower first-life behavior
- Run 1 per competitor: FIRST_OBSERVATION (snapshotCount=1), no diff — correct.
- Run 2+: structural diff runs; semantic diff needs ≥3 classified posts in each 30d
  window anchored at the two snapshot times — low-frequency markets (or shallow scrape
  depth) keep it in SEMANTIC_DIFF_THIN_DATA permanently. Verify thinness against
  ci_competitor_posts timestamps before suspecting a read-path bug.
- Q1 stays UNKNOWN (`q1_skipped:no_active_plan` via the rhythm hierarchy) until an
  approved rhythm/calendar + user truth exist — truthful, not a defect.
