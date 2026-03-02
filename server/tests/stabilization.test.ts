import { describe, it, expect } from "vitest";

const BASE = "http://localhost:5000";

describe("Stabilization Suite", () => {
  it("health endpoint returns OK", async () => {
    const res = await fetch(`${BASE}/api/health`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("AI budget tracking works", async () => {
    const { getWeeklyTokenUsage, WEEKLY_TOKEN_BUDGET } = await import("../ai-client");
    const usage = await getWeeklyTokenUsage("test_stabilization");
    expect(typeof usage).toBe("number");
    expect(usage).toBeGreaterThanOrEqual(0);
    expect(WEEKLY_TOKEN_BUDGET).toBe(500000);
  });

  it("database accessible via health endpoint", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
  });

  it("CI analyze-profile returns 410 deprecated", async () => {
    const res = await fetch(`${BASE}/api/ci/competitors/analyze-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(410);
  });

  it("autopilot status endpoint works", async () => {
    const res = await fetch(`${BASE}/api/autopilot/status?accountId=default`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(
      data.hasOwnProperty("autopilotOn") || data.hasOwnProperty("mode") || data.hasOwnProperty("state")
    ).toBe(true);
  });

  it("no direct AI instantiation (ai-scan enforcement)", async () => {
    const { execSync } = await import("child_process");
    const result = execSync("npx vitest run server/tests/ai-scan.test.ts 2>&1", {
      cwd: "/home/runner/workspace",
      encoding: "utf-8",
    });
    expect(result).toContain("passed");
  });
});
