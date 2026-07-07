---
name: DrizzleQueryError puts pg detail in .cause
description: Why idempotency/catch guards that inspect e.message silently break after a Drizzle bump.
---

# DrizzleQueryError wraps the pg error in .cause

When `db.execute(sql\`...\`)` fails, current Drizzle throws a `DrizzleQueryError` whose
`.message` is a generic `"Failed query: <SQL>"`. The real Postgres detail (e.g.
`constraint "..." already exists`, pg code 42710) lives in **`e.cause.message`**, not
`e.message`.

**Why it bites:** idempotency guards / catch blocks written as
`if (!e.message.includes("already exists")) throw e` silently stop matching after a
Drizzle version bump and re-throw on a benign re-run — which can abort a whole migration
run and leave the DB stuck below the required schema version.

**How to apply:** any catch that string-matches a DB error must inspect both, e.g.
`const msg = \`${e?.message ?? ""} ${e?.cause?.message ?? ""}\`` then match on `msg`.
This works for both raw pg errors (detail in `.message`) and Drizzle-wrapped errors
(detail in `.cause.message`). Suspect this pattern whenever a migration/guard breaks
right after a dependency bump.
