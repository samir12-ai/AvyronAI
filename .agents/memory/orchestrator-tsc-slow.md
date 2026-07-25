---
name: Orchestrator repo tsc is slow + has a non-zero baseline
description: How to typecheck this repo without fighting the 2-minute tool timeout, and what "clean" means here.
---

## Facts
- A full `npx tsc --noEmit` on this repo takes ~90s+ and frequently exceeds the 120s bash-tool timeout. Running it in the foreground will get killed with no output.
- The repo has a **non-zero baseline of ~713 tsc errors** that are pre-existing and unrelated to most changes (many in `server/orchestrator/index.ts`: `.config`, `celDepthCompliance`, `snapshotId`, `integrityVerdict`, a known `"INTELLIGENT"` ChannelMode TS2345, etc.). "Clean" = the total error count is unchanged and NONE of the new errors are in your touched files.

**How to apply:** launch tsc fully detached so it survives the tool call, then poll a marker file across turns:
```
setsid bash -c 'npx tsc --noEmit > /tmp/tsc.txt 2>&1; echo "EXIT_$?" > /tmp/tsc.done' >/dev/null 2>&1 < /dev/null & disown
```
Plain `nohup ... &` did NOT survive the tool call returning; `setsid ... & disown` does. Then `grep -c "error TS" /tmp/tsc.txt` and compare to the baseline, and `grep <your-files> /tmp/tsc.txt` to confirm zero in touched files. `npm run lint` is known-broken, so D1 (no `??`/`||` producing a decision/verdict/outcome value; `??` for optional-input defaults is fine) and D3 (strict `z.enum`) must be enforced by manual grep.
