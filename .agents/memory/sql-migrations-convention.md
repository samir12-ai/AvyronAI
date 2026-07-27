---
name: SQL migrations, not drizzle push
description: Why db:push fails here and the numbered-SQL + version-bump convention that works
---

# Schema changes: numbered SQL migrations, never `db:push`

**Rule:** to add/change tables, write `server/migrations/sql/NNN_name.sql` (CREATE TABLE IF NOT EXISTS + indexes, snake_case, `varchar id DEFAULT gen_random_uuid()`, text JSON columns with defaults — mirror shared/schema.ts exactly), bump `REQUIRED_SCHEMA_VERSION` in `server/migrations/runner.ts` to NNN, then `npm run db:migrate`.

**Why:** `npm run db:push` (drizzle-kit) hits an interactive rename prompt with no TTY in this environment and hangs/fails — and the codebase's boot contract is the migration runner anyway: dev boot applies pending SQL, prod boot is verify-only and refuses to start below REQUIRED_SCHEMA_VERSION.

**How to apply:** after migrating dev, restart the backend workflow and look for `schema floor verified lastVersion=NNN` in boot logs. Remember prod DB must be migrated independently before deploying a version bump (see avyron-deploy-boot).
