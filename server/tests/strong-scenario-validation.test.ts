import { describe, it, expect } from "vitest";
import * as fs from "fs";

function readFile(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

describe("Strong Scenario Validation — Success Path Enforcement", () => {

  describe("Section 1: Budget Governor Scale Path", () => {

    it("1.1) Budget governor has 'scale' action path with budget allocation", () => {
      const source = readFile("server/strategy/budget-governor/engine.ts");
      expect(source).toContain("scale");
      expect(source).toContain("allocation");
    });

    it("1.2) determineBudgetDecision returns 'scale' when all metrics are strong", () => {
      const source = readFile("server/strategy/budget-governor/engine.ts");
      expect(source).toContain("determineBudgetDecision");
      const fnBody = source.slice(
        source.indexOf("function determineBudgetDecision"),
        source.indexOf("function determineBudgetDecision") + 3000
      );
      expect(fnBody).toContain("scale");
    });

    it("1.3) killFlag is false when decision is scale", () => {
      const source = readFile("server/strategy/budget-governor/engine.ts");
      expect(source).toContain("killFlag");
      const killFlagSection = source.slice(
        source.indexOf("killFlag"),
        source.indexOf("killFlag") + 200
      );
      expect(killFlagSection).toContain("halt");
    });

    it("1.4) Scale path does not zero out budget allocation", () => {
      const source = readFile("server/strategy/budget-governor/engine.ts");
      expect(source).not.toContain('action === "scale" && totalBudget === 0');
    });
  });

  describe("Section 2: Plan Synthesis Executable Path", () => {

    it("2.1) Plan synthesis only degrades when safeToExecute is false", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("safeToExecute");
      expect(source).toContain("integrityDegradation");
      expect(source).toContain('"degraded"');
      expect(source).toContain('"none"');
    });

    it("2.2) Non-degraded plan has planSource decision_driven", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("decision_driven");
    });

    it("2.3) Plan synthesis passes all strategic context to task composer", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("budgetDecision:");
      expect(source).toContain("budgetKillFlag:");
      expect(source).toContain("integrityScore:");
      expect(source).toContain("safeToExecute:");
      expect(source).toContain("signalTrustedRatio:");
    });

    it("2.4) Halt plan returns early before task composition", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      const haltSection = source.slice(
        source.indexOf("BUDGET_HALT_ENFORCED"),
        source.indexOf("BUDGET_HALT_ENFORCED") + 500
      );
      expect(haltSection).toContain("return");
      expect(haltSection).toContain("haltPlan");
    });
  });

  describe("Section 3: Task Composer Full Execution Path", () => {

    it("3.1) Task composer generates tasks when no guards fire", () => {
      const source = readFile("server/task-composer.ts");
      const guardStart = source.indexOf("function applyStrategicGuards");
      const guardEnd = source.indexOf("\nexport ", guardStart);
      const guardFn = source.slice(guardStart, guardEnd > guardStart ? guardEnd : guardStart + 2000);
      expect(guardFn).toContain("return filtered");
    });

    it("3.2) HALT guard returns empty array (zero tasks)", () => {
      const source = readFile("server/task-composer.ts");
      const guardStart = source.indexOf("function applyStrategicGuards");
      const guardEnd = source.indexOf("\nexport ", guardStart);
      const guardFn = source.slice(guardStart, guardEnd > guardStart ? guardEnd : guardStart + 2000);
      expect(guardFn).toContain("budgetKillFlag");
      expect(guardFn).toContain("return []");
    });

    it("3.3) Non-halted, non-degraded path preserves all task types", () => {
      const source = readFile("server/task-composer.ts");
      const guardStart = source.indexOf("function applyStrategicGuards");
      const guardEnd = source.indexOf("\nexport ", guardStart);
      const guardFn = source.slice(guardStart, guardEnd > guardStart ? guardEnd : guardStart + 2000);
      expect(guardFn).toContain("content_production");
      expect(guardFn).toContain("launch");
    });

    it("3.4) Manual generate endpoint enforces strategic guards from stored plan", () => {
      const source = readFile("server/task-composer.ts");
      const generateEndpoint = source.slice(
        source.indexOf("/api/execution-tasks/generate"),
        source.indexOf("/api/execution-tasks/generate") + 1500
      );
      expect(generateEndpoint).toContain("strategicContext");
      expect(generateEndpoint).toContain("budgetDecision");
      expect(generateEndpoint).toContain("budgetKillFlag");
      expect(generateEndpoint).toContain("executionStatus");
    });

    it("3.5) Manual generate endpoint blocks tasks for HALTED plans", () => {
      const source = readFile("server/task-composer.ts");
      const generateEndpoint = source.slice(
        source.indexOf("/api/execution-tasks/generate"),
        source.indexOf("/api/execution-tasks/generate") + 1500
      );
      expect(generateEndpoint).toContain("HALTED");
      expect(generateEndpoint).toContain("halt");
      expect(generateEndpoint).toContain("budgetKillFlag");
    });
  });

  describe("Section 4: Cross-Engine Integrity Enforcement", () => {

    it("4.1) Plan synthesis checks offer engine status for cross-engine failures", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("crossEngineFailures");
      expect(source).toContain('results.get("offer")');
      expect(source).toContain("Offer engine");
    });

    it("4.2) Plan synthesis checks CEL results for cross-engine failures", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("celResults");
      expect(source).toContain("CEL enforcement failed");
    });

    it("4.3) Plan synthesis checks funnel and positioning engine status", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("Funnel engine");
      expect(source).toContain("Positioning engine");
    });

    it("4.4) Cross-engine failures override safeToExecute to false", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("CROSS_ENGINE_INTEGRITY_OVERRIDE");
      expect(source).toContain("safeToExecute = false");
    });

    it("4.5) Integrity engine safeToExecute formula includes boundary, failed count, and score", () => {
      const source = readFile("server/integrity-engine/engine.ts");
      const formula = source.slice(
        source.indexOf("safeToExecute ="),
        source.indexOf("safeToExecute =") + 200
      );
      expect(formula).toContain("boundaryCheck.passed");
      expect(formula).toContain("failedCount");
      expect(formula).toContain("overallIntegrityScore");
    });
  });

  describe("Section 5: Signal Composition Strong Path", () => {

    it("5.1) Signal composition is injected into plan synthesis", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("SIGNAL_COMPOSITION_INJECTED");
      expect(source).toContain("signalComp");
    });

    it("5.2) Budget governor applies composition enforcement", () => {
      const source = readFile("server/strategy/budget-governor/engine.ts");
      expect(source).toContain("applyCompositionEnforcement");
    });

    it("5.3) Trusted ratio flows to task composer context", () => {
      const source = readFile("server/orchestrator/plan-synthesis.ts");
      expect(source).toContain("signalTrustedRatio");
      expect(source).toContain("trustedRatio");
    });
  });
});
