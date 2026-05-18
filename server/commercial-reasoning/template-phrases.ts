/**
 * Phase 4-A — Anti-template registry (AT3).
 *
 * Seeded from Phase 3 judge `filler_phrases[]` callouts captured in
 * `.local/validation/judge-scores.json`. These are the templated
 * commercial-reasoning shapes that appeared verbatim across multiple
 * industries (b2b_saas / dtc_ecom / local_services) — the very pattern
 * a grounded LLM reasoner MUST NOT reproduce.
 *
 * Registry policy:
 *   - Grow-only. New filler phrases added per judge run, NEVER removed.
 *   - Matched as case-insensitive substring (NOT regex) against:
 *       reasoning, commercial_pressures[].pressure (label form),
 *       uncertainty.knownUnknowns[].
 *   - Match count >= 2 → REJECT (see contract §3a AT3).
 *
 * Each entry carries a `source` field for traceability — when a phrase is
 * appended, record which judge artefact surfaced it so the registry's
 * provenance is auditable.
 */

export interface TemplatePhrase {
  phrase: string;
  source: string;
}

export const TEMPLATE_PHRASE_REGISTRY: TemplatePhrase[] = [
  // From Phase 3 judge — appeared identically across all 3 industries.
  { phrase: "transparency proof", source: "phase3-judge-2026-05" },
  { phrase: "outcome proof", source: "phase3-judge-2026-05" },
  { phrase: "comparative proof", source: "phase3-judge-2026-05" },
  { phrase: "objection_0", source: "phase3-judge-2026-05" },
  { phrase: "objection_1", source: "phase3-judge-2026-05" },
  { phrase: "objection_2", source: "phase3-judge-2026-05" },
  { phrase: "internal conflict", source: "phase3-judge-2026-05" },
  { phrase: "Trust-Building Content", source: "phase3-judge-2026-05" },
  { phrase: "trust building content", source: "phase3-judge-2026-05" },
  // From Phase 3 mechanism unparseable fallback — appeared in b2b_saas+dtc_ecom.
  { phrase: "axis=simplicity", source: "phase3-mechanism-fallback" },
  { phrase: "primary mechanism axis is simplicity", source: "phase3-mechanism-fallback" },
  // Generic-commercial-LLM-tells we want flagged from day 1.
  { phrase: "strategic alignment", source: "phase4a-pre-seed" },
  { phrase: "best-in-class", source: "phase4a-pre-seed" },
  { phrase: "world-class", source: "phase4a-pre-seed" },
  { phrase: "industry-leading", source: "phase4a-pre-seed" },
  { phrase: "synergize", source: "phase4a-pre-seed" },
  { phrase: "leverage synergies", source: "phase4a-pre-seed" },
  { phrase: "holistic approach", source: "phase4a-pre-seed" },
  { phrase: "move the needle", source: "phase4a-pre-seed" },
];

export interface TemplatePhraseMatch {
  phrase: string;
  source: string;
  occurrences: number;
  fieldsHit: string[];
}

/**
 * Scan a set of named text fields for template-phrase hits.
 *
 * Returns one entry per matched phrase with a count and the field names
 * where it appeared. The caller (§4 integrity gate) increments
 * cv11_hallucination_exposure_total{kind="template_phrase_leak"} per
 * occurrence and REJECTS if total occurrences >= 2.
 */
export function scanForTemplatePhrases(
  fields: Record<string, string | string[]>,
): TemplatePhraseMatch[] {
  const matches: TemplatePhraseMatch[] = [];

  for (const tp of TEMPLATE_PHRASE_REGISTRY) {
    const needle = tp.phrase.toLowerCase();
    let occurrences = 0;
    const fieldsHit: string[] = [];

    for (const [fieldName, value] of Object.entries(fields)) {
      const haystacks = Array.isArray(value) ? value : [value];
      for (const haystack of haystacks) {
        if (typeof haystack !== "string" || haystack.length === 0) continue;
        const lowered = haystack.toLowerCase();
        // Count occurrences with a manual scan so one field with N
        // occurrences contributes N, not 1.
        let idx = lowered.indexOf(needle);
        let hitInField = 0;
        while (idx !== -1) {
          hitInField += 1;
          idx = lowered.indexOf(needle, idx + needle.length);
        }
        if (hitInField > 0) {
          occurrences += hitInField;
          if (!fieldsHit.includes(fieldName)) fieldsHit.push(fieldName);
        }
      }
    }

    if (occurrences > 0) {
      matches.push({
        phrase: tp.phrase,
        source: tp.source,
        occurrences,
        fieldsHit,
      });
    }
  }

  return matches;
}
