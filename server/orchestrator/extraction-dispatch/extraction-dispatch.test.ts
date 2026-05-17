import { describe, it, expect, beforeEach } from "vitest";
import {
  dispatchExtraction,
  resolveDispatchMode,
  defaultJsonDiff,
} from "./index";
import { _resetCv14MetricsForTests, _readCv14Counters } from "./cv14-metrics";

describe("extraction-dispatch", () => {
  beforeEach(() => {
    delete process.env.ORCH_USE_FOO;
    _resetCv14MetricsForTests();
  });

  describe("resolveDispatchMode", () => {
    it("defaults to current when env is unset", () => {
      delete process.env.ORCH_USE_FOO;
      expect(resolveDispatchMode("FOO")).toBe("current");
    });
    it("resolves candidate when env=candidate", () => {
      process.env.ORCH_USE_FOO = "candidate";
      expect(resolveDispatchMode("FOO")).toBe("candidate");
    });
    it("resolves shadow when env=shadow", () => {
      process.env.ORCH_USE_FOO = "shadow";
      expect(resolveDispatchMode("FOO")).toBe("shadow");
    });
    it("collapses unknown values to current (safe default)", () => {
      process.env.ORCH_USE_FOO = "garbage";
      expect(resolveDispatchMode("FOO")).toBe("current");
    });
  });

  describe("dispatch", () => {
    it("current mode invokes only current() and records current_only", async () => {
      const out = await dispatchExtraction({
        moduleId: "foo",
        moduleFlag: "FOO",
        input: { x: 1 },
        current: (i) => Promise.resolve({ y: i.x * 2 }),
        candidate: () => {
          throw new Error("candidate must not run");
        },
      });
      expect(out).toEqual({ y: 2 });
      const counters = _readCv14Counters();
      expect(counters.dispatch.find((c) => c.labels.outcome === "current_only")?.value).toBe(1);
    });

    it("candidate mode invokes only candidate() and records candidate_only", async () => {
      process.env.ORCH_USE_FOO = "candidate";
      const out = await dispatchExtraction({
        moduleId: "foo",
        moduleFlag: "FOO",
        input: { x: 3 },
        current: () => {
          throw new Error("current must not run");
        },
        candidate: (i) => Promise.resolve({ y: i.x + 10 }),
      });
      expect(out).toEqual({ y: 13 });
      const counters = _readCv14Counters();
      expect(counters.dispatch.find((c) => c.labels.outcome === "candidate_only")?.value).toBe(1);
    });

    it("shadow mode runs both, returns current, records match when equal", async () => {
      process.env.ORCH_USE_FOO = "shadow";
      let curCalls = 0;
      let candCalls = 0;
      const out = await dispatchExtraction({
        moduleId: "foo",
        moduleFlag: "FOO",
        input: { x: 5 },
        current: (i) => {
          curCalls++;
          return { y: i.x };
        },
        candidate: (i) => {
          candCalls++;
          return { y: i.x };
        },
      });
      expect(out).toEqual({ y: 5 });
      expect(curCalls).toBe(1);
      expect(candCalls).toBe(1);
      const counters = _readCv14Counters();
      expect(counters.dispatch.find((c) => c.labels.outcome === "shadow_match")?.value).toBe(1);
      expect(counters.divergences.length).toBe(0);
    });

    it("shadow mode records major divergence when outputs differ", async () => {
      process.env.ORCH_USE_FOO = "shadow";
      const out = await dispatchExtraction({
        moduleId: "foo",
        moduleFlag: "FOO",
        input: { x: 5 },
        current: () => ({ y: 1 }),
        candidate: () => ({ y: 2 }),
      });
      expect(out).toEqual({ y: 1 });
      const counters = _readCv14Counters();
      expect(counters.divergences.find((c) => c.labels.severity === "major")?.value).toBe(1);
      expect(
        counters.dispatch.find((c) => c.labels.outcome === "shadow_diverge_major")?.value,
      ).toBe(1);
    });

    it("shadow mode records fatal divergence when candidate throws (current still returns)", async () => {
      process.env.ORCH_USE_FOO = "shadow";
      const out = await dispatchExtraction({
        moduleId: "foo",
        moduleFlag: "FOO",
        input: { x: 5 },
        current: () => ({ y: 99 }),
        candidate: () => {
          throw new Error("boom");
        },
      });
      expect(out).toEqual({ y: 99 });
      const counters = _readCv14Counters();
      expect(counters.divergences.find((c) => c.labels.severity === "fatal")?.value).toBe(1);
      expect(counters.candidateError.find((c) => c.labels.module === "foo")?.value).toBe(1);
    });

    it("candidate mode rethrows candidate errors (no silent fallback)", async () => {
      process.env.ORCH_USE_FOO = "candidate";
      await expect(
        dispatchExtraction({
          moduleId: "foo",
          moduleFlag: "FOO",
          input: { x: 1 },
          current: () => ({ y: 1 }),
          candidate: () => {
            throw new Error("explicit");
          },
        }),
      ).rejects.toThrow("explicit");
    });
  });

  describe("defaultJsonDiff", () => {
    it("returns null on structural match (key order independent)", () => {
      expect(defaultJsonDiff({ a: 1, b: 2 }, { b: 2, a: 1 })).toBeNull();
    });
    it("returns major on value mismatch", () => {
      const r = defaultJsonDiff({ a: 1 }, { a: 2 });
      expect(r?.severity).toBe("major");
    });
  });
});
