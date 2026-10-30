import { describe, it, expect, vi, beforeEach } from "vitest";
import { judgeMechanismSemanticRole } from "../../mechanism-engine/engine";
import * as aiClient from "../../ai-client";

describe("Contract: Mechanism Axis Independence (Semantic Judge vs Producer Metadata)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Test A: Semantically wrong-axis mechanism with metadata claiming alignment is REJECTED by semantic judge", async () => {
    vi.spyOn(aiClient, "aiChat").mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REPAIR",
              axisVerdict: "MISALIGNED",
              axisReason: "Candidate steps explain manual complex workflows, contradicting the simplicity contrast axis.",
              reasons: ["Operational steps contradict declared simplicity axis"],
              failureType: "AXIS_MISALIGNED",
              operationalClaims: [],
              feedback: "Remove multi-layered manual configuration steps.",
            }),
          },
        },
      ],
    } as any);

    const candidateWithSelfAttestedMetadata = {
      name: "Complex Configuration Engine",
      description: "Manual multi-stage rules builder",
      steps: ["Navigate 15 settings tabs", "Configure YAML schema manually"],
      logic: "Power through endless knobs",
      axisAlignment: { primaryAxis: "simplicity", aligned: true, confidence: 0.99 },
    };

    const verdict = await judgeMechanismSemanticRole({
      candidate: candidateWithSelfAttestedMetadata,
      positioning: {
        primaryAxis: "simplicity",
        contrastAxis: "effortless speed vs manual complexity",
      },
      productTruthCapabilities: [],
      accountId: "acc_1",
    });

    expect(verdict.axisVerdict).toBe("MISALIGNED");
    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.failureType).toBe("AXIS_MISALIGNED");
  });

  it("Test B: Semantically aligned mechanism without legacy axisAlignment self-certification PASSES", async () => {
    vi.spyOn(aiClient, "aiChat").mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              axisVerdict: "ALIGNED",
              axisReason: "Single-click automation operational steps directly deliver on simplicity contrast axis.",
              reasons: ["Clean HOW explanation delivering on simplicity axis"],
              failureType: "NONE",
              operationalClaims: [],
              feedback: "Well aligned.",
            }),
          },
        },
      ],
    } as any);

    const candidateWithoutMetadata = {
      name: "Zero-Click Sync Pipeline",
      description: "Automated event stream synchronizer",
      steps: ["Authenticate source", "Instant schema reflection without manual config"],
      logic: "Direct push streaming",
    };

    const verdict = await judgeMechanismSemanticRole({
      candidate: candidateWithoutMetadata,
      positioning: {
        primaryAxis: "simplicity",
        contrastAxis: "effortless speed vs manual complexity",
      },
      productTruthCapabilities: [],
      accountId: "acc_1",
    });

    expect(verdict.axisVerdict).toBe("ALIGNED");
    expect(verdict.verdict).toBe("APPROVE");
    expect(verdict.failureType).toBe("NONE");
  });
});
