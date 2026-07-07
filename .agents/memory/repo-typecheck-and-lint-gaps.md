---
name: Typecheck & lint gaps in this repo/env
description: How to actually type-check and why lint is currently broken here.
---

# Typecheck & lint gaps

**Full-project `tsc --noEmit` is not viable here.** `tsconfig.json` has no `skipLibCheck`,
so a full run exceeds the 120s bash-call ceiling, and any background/detached process
(even via `setsid`) gets reaped between tool calls — so it never finishes.
**How to apply:** validate edited files with `getLatestLspDiagnostics({ filePath })`
(diagnostics skill) per file instead of running whole-project tsc. Backend boot via `tsx`
only strips types (no type-check), so a clean boot does NOT prove type-correctness.

**Custom ESLint rules are partly missing.** `eslint.config.js` `require()`s ~8 custom
rules from `.local/eslint-rules/`, but that dir is **gitignored + untracked** and only
2 files exist on disk (`no-semantic-fallback.js`, `no-bare-llm-call-in-replay.js`). The
other ~6 (incl. `orchestrator-no-new-large-file.js`, `orchestrator-module-boundary.js`)
are absent, so the config load throws and `npm run lint` fails. Doctrine ceilings
(index.ts 5000 lines, sibling modules 200 lines) are therefore **unenforced by CI** —
enforce them manually. Rules can't be faithfully reconstructed without their source.
(State as of 2026-07; verify with `ls .local/eslint-rules/` before relying on this.)
