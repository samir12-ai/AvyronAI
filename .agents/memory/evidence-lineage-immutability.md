---
name: Evidence lineage immutability
description: Rules for citation/lineage registries over mutable source rows — content-versioned UIDs, append-only rows; plus tenant-scoping lesson for shared stores.
---

# Citation registries must be append-only with content-versioned UIDs

**Rule:** When a registry indexes evidence whose source rows can MUTATE (business profile, competitor profiles, strategy memory, upserted AEL snapshots), the UID must embed a content hash of the cited text (`<rowId>@<hash12(detail)>`) and inserts must be `onConflictDoNothing`. Never `onConflictDoUpdate` label/detail on a stable UID.

**Why:** A stable-UID upsert-refresh silently rewrites what historical runs' citations resolve to — an old `reasoning_runs.ref_map` would point at evidence text that did not exist at run time, corrupting auditability. Architect review failed the first P-5 implementation on exactly this.

**How to apply:** Immutable rows hash stably → same UID → idempotent no-op. Mutable rows mint a new UID per content version → old citations stay frozen. Deterministic "no-lookup" UID resolvers (e.g. for AEL `[RC#]` aliases) must then take the item content as a parameter — callers always hold the package. Batch all entries into one insert.

# Shared-store functions must take accountId even when campaignId "is unique"

**Why:** Review treats campaignId-only WHERE clauses in store modules as a cross-tenant mutation risk regardless of id uniqueness in practice — route-level ownership checks don't protect store functions called from workers/orchestrators.

**How to apply:** Every store read/update signature carries accountId and filters on it; thread it from callers (orchestrator already has it in scope).
