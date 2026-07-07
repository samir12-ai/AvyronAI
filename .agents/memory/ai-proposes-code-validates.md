---
name: AI Proposes / Code Validates
description: Gate-authority invariants for Avyron's candidate-gate-battery system across engines (audience/positioning/offer) and narrative grounding.
---

# AI Proposes / Code Validates — gate authority invariants

Engines let the AI PROPOSE candidate outputs; deterministic code (the candidate gate battery: breadth / interchangeability / contradiction) is the SOLE judge of accept/reject. When touching any engine's retry/acceptance loop, hold these rules:

## Gate authority is SYMMETRIC
An accept must never REGRESS another active gate. If a retry candidate improves gate A but flips gate B from passed→failed, REFUSE it and keep the prior candidate.
**Why:** without symmetry, one gate's improvement silently defeats another gate's authority (e.g. the offer engine used to adopt an alignment-improved retry that regressed the doctrine battery passed→failed). Guard both directions: `alignmentAccept = improved && !batteryRegressed`, `batteryOnlyImproved = ... && !alignmentRegressed`.
**Edge:** if the current gate already fails, adopting another failing candidate is NOT a regression — allow the improvement through.

## NOT_RUN / bypassed gates must be RECORDED, never swallowed
If a gate never executes on an output (e.g. positioning's full battery only runs after specificity clears, so specificity-exhaustion ships un-batteried territories), push an explicit marker (`[BATTERY_NOT_RUN] ...` in stabilityNotes + a log) rather than shipping a silently un-judged output.
**Why:** operational silence is a failure category (Beta axiom B2 visibility-over-silence); an un-recorded gate bypass makes the surface lie about how validated the output is.

## Attempt budget + degradation
Max 3 attempts per engine PER GATE (1 initial + 2 retries). On exhaustion DEGRADE (record warnings + clamp confidence/strength score) — never hard-fail, never fake success (Beta axiom B3).

## Narrative grounding allowlist (T14)
Only CODE-VALIDATED strategic outputs (Zod-validated product anchor identity terms + gate-passed prior-decision summary tokens) may widen the narrative hallucination allowlist. Q2/User overlays stay interpretation-only and MUST NOT widen the hard allowlist. Anchor-load failure must degrade toward a STRICTER allowlist (fail-closed).
