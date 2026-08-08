---
name: Orchestrator watchdog clearTimeout required after Promise.race
description: Per-engine setTimeout handles must be cancelled after Promise.race resolves or they fire retroactively, cascade-blocking all downstream engines.
---

## Rule
Every `setTimeout` registered as a watchdog in the orchestrator (both `index.ts` and `gate-retry-loop/index.ts`) must have its handle captured and `clearTimeout(handle)` called immediately after the `Promise.race` that includes it resolves — whether the engine won or the timeout won.

## Why
`Promise.race` resolves to the first settler but does NOT cancel the other promises or their side-effects. If the engine wins the race but the timeout handle is not cleared, the timer fires 420s later (wall-clock), at which point it cascade-blocks every engine that is currently running or about to run — even engines that finished cleanly. The symptom is engines 5–15 showing `upstream_block` despite engine 4 (the trigger) having already completed successfully.

## How to apply
Pattern:
```ts
let timeoutHandle: ReturnType<typeof setTimeout>;
const timeoutPromise = new Promise((_, reject) => {
  timeoutHandle = setTimeout(() => reject(new Error('ENGINE_TIMEOUT')), ENGINE_TIMEOUT_MS);
});
const result = await Promise.race([enginePromise, timeoutPromise]);
clearTimeout(timeoutHandle!); // ← required; skipping this causes retroactive cascade blocks
```
Apply this to both the top-level orchestrator loop and the gate-retry inner loop.
