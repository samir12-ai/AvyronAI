import { describe, it, expect, beforeEach } from "vitest";
import { __pgCalls, _resetPgCalls, FakeClock } from "./_harness";
import {
  parseRecorderGate,
  withReplayRecorder,
  _liveRecorderForTests,
  _resetRecorderCounterForTests,
} from "../../orchestrator/replay/recorder";
import { _resetCv13MetricsForTests } from "../../orchestrator/replay/cv13-metrics";

describe("Task #89 / recorder — parseRecorderGate", () => {
  it("treats undefined / 0 / false / empty as disabled", () => {
    expect(parseRecorderGate(undefined).enabled).toBe(false);
    expect(parseRecorderGate("").enabled).toBe(false);
    expect(parseRecorderGate("0").enabled).toBe(false);
    expect(parseRecorderGate("false").enabled).toBe(false);
  });
  it("treats 1 / true as every-invocation", () => {
    expect(parseRecorderGate("1")).toEqual({ enabled: true, sampleEvery: 1 });
    expect(parseRecorderGate("true")).toEqual({ enabled: true, sampleEvery: 1 });
  });
  it("parses sample:N", () => {
    expect(parseRecorderGate("sample:50")).toEqual({ enabled: true, sampleEvery: 50 });
    expect(parseRecorderGate("sample:1")).toEqual({ enabled: true, sampleEvery: 1 });
  });
  it("rejects sample:0 / sample:bad", () => {
    expect(parseRecorderGate("sample:0").enabled).toBe(false);
    expect(parseRecorderGate("sample:foo").enabled).toBe(false);
  });
});

describe("Task #89 / recorder — gate behavior", () => {
  beforeEach(() => {
    _resetPgCalls();
    _resetCv13MetricsForTests();
    _resetRecorderCounterForTests();
    delete process.env.ORCH_REPLAY_RECORD;
  });

  it("returns a no-op recorder when flag is unset (default-off in production)", async () => {
    const r = withReplayRecorder("job-1");
    expect(r.jobId).toBe("");
    r.recordInput({ campaignId: "c", accountId: "a", forceRefresh: false });
    expect(await r.finalize()).toBeNull();
    expect(__pgCalls.length).toBe(0);
  });

  it("at sample:N, only every Nth invocation gets a live recorder", () => {
    process.env.ORCH_REPLAY_RECORD = "sample:3";
    const hits: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const r = withReplayRecorder(`job-${i}`);
      if (r.jobId !== "") hits.push(i);
    }
    // invocations 3, 6, 9 → sampled in.
    expect(hits).toEqual([3, 6, 9]);
  });
});

describe("Task #89 / recorder — finalize persists cassette + redacts PII", () => {
  beforeEach(() => {
    _resetPgCalls();
    _resetCv13MetricsForTests();
  });

  it("captures all 8 boundary kinds + emits a content-addressed insert", async () => {
    const clock = new FakeClock();
    const r = _liveRecorderForTests("job-x", { now: clock.now, source: "synthetic" });
    r.recordInput({ campaignId: "camp-1", accountId: "acct-1", forceRefresh: false });
    clock.advance(5);
    r.recordContextResolved({ sscPresent: true, contextKeys: ["mi", "audience"], inputHashes: { mi: "h1" } });
    clock.advance(10);
    r.recordEngineOutput({
      order: 0,
      engineId: "mi",
      engineName: "MI",
      tier: "T0",
      status: "COMPLETED",
      durationMs: 100,
      output: { contact: "founder@acme.com" },
    });
    r.recordSynthesisInput({ engineCount: 1, controlVerdictPresent: true, ledgerEntryCount: 0, fingerprint: "abc" });
    r.recordPlanPersist({ planId: "plan-1", source: "primary", degraded: false });
    r.recordSystemControlVerdict({ integrityVerdict: "PASS", executionMode: "FULL", blockReasons: [] });
    r.recordInFlightEvent({ jobId: "job-x", event: "register", at: clock.now() });
    r.recordLlmCall({ callOrder: 1, provider: "openai", model: "gpt-x", promptHash: "p", response: { ok: true } });
    r.recordFinalResult({
      jobId: "job-x",
      status: "COMPLETED",
      completedEngines: ["mi"],
      durationMs: 100,
      ledgerEntryCount: 0,
    });
    r.setPathShape("clean");
    clock.advance(50);
    const cassette = await r.finalize();
    expect(cassette).not.toBeNull();
    expect(cassette!.cassetteHash).toMatch(/^[a-f0-9]{64}$/);
    expect(cassette!.body.engineOutputs[0].output).not.toMatchObject({ contact: "founder@acme.com" });
    // The PII was redacted to a token before persistence.
    const insert = __pgCalls.find((c) => c.sql.includes("INSERT INTO orchestrator_replay_cassettes"));
    expect(insert).toBeDefined();
    expect(JSON.stringify(insert!.params)).not.toContain("founder@acme.com");
  });

  it("skips finalize when required boundaries are missing (no silent partial cassette)", async () => {
    const clock = new FakeClock();
    const r = _liveRecorderForTests("job-y", { now: clock.now });
    // Only record input, no final result.
    r.recordInput({ campaignId: "c", accountId: "a", forceRefresh: false });
    const result = await r.finalize();
    expect(result).toBeNull();
    const insert = __pgCalls.find((c) => c.sql.includes("INSERT INTO orchestrator_replay_cassettes"));
    expect(insert).toBeUndefined();
  });
});
