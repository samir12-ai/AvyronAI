---
name: Interchangeability judge tuning
description: Why the segment judge prompt must differ from the other three interchangeability prompts
---

# Interchangeability judge — segment prompt is a special case

`server/shared/interchangeability-judge.ts` has 4 output-shape-specific hostile-judge prompts (segment / positioning_claim / offer / channel_rationale), each testing the doctrine RESOLUTION_RULE ("could this apply unchanged to a generic competitor?").

**Non-obvious lesson (took 2 iterations):** the literal interchangeability test is WRONG for SEGMENT definitions. It false-rejects genuinely specific niche segments, because a competitor serving the *same niche* legitimately shares the audience — that does not make the segment generic.

**The rule:** for `segment`, reframe the test as **broad/vague boilerplate (reject) vs a describable group with a shared, verifiable, situation-specific problem (accept)** — what matters is the *specificity of the situation*, NOT the *exclusivity of the audience*. The other three kinds DO use the literal "could a competitor say this unchanged?" test correctly (claims/offers/rationales that a rival could repeat verbatim really are interchangeable).

**Why it matters:** a gate that false-rejects specific segments makes the audience retry loop churn and drop to deterministic fallback even for good AI output — defeating the whole "AI proposes" inversion.

**How to apply:** if you retune these prompts, keep the segment prompt's broadness framing distinct; re-run `.local/scripts/validate-interchangeability-judge.ts` (expects 8/8 hard assertions: generic→REJECT, specific→ACCEPT; borderlines are informational and tend to REJECT since the judge is fail-closed).
