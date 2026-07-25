/**
 * F10.9 — Regression-suite expansion (BEHAVIOR-LEVEL).
 *
 * Architect round-3 review: tests must call REAL production code paths,
 * not duplicated helpers or hand-rolled exemplar objects.
 *
 *  - F9.3 calls the actual `verifyStripeWebhookSignature` exported from
 *    server/lib/stripe-signature.ts (the same function imported by
 *    server/auth.ts at L13 and invoked at L869).
 *  - F9.10 mounts the actual `versionHandler` exported from
 *    server/lib/version-handler.ts (the same handler registered at
 *    server/routes.ts L78) on a real Express app and HTTP-fetches it.
 *  - F7.9 EXECUTES the pre-push guard script as a subprocess inside a
 *    throwaway git repo, asserting it FAILS when a watched file changes
 *    without ENGINE_VERSION bump and PASSES when both change together.
 *  - F5.7 imports lib/insets and asserts on the real exported constants.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import { type AddressInfo } from "net";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { verifyStripeWebhookSignature } from "../lib/stripe-signature";
import { versionHandler } from "../lib/version-handler";

describe("F10.9 / Regression suite expansion (Seal #12 — behavior level)", () => {
  describe("F9.3 — Stripe webhook constant-time compare (real production fn)", () => {
    it("matches identical secrets", () => {
      expect(verifyStripeWebhookSignature("abc-very-long-secret-1234", "abc-very-long-secret-1234")).toBe(true);
    });
    it("rejects content mismatch with same length", () => {
      expect(verifyStripeWebhookSignature("abc-very-long-secret-1234", "xyz-very-long-secret-1234")).toBe(false);
    });
    it("rejects length mismatch (short)", () => {
      expect(verifyStripeWebhookSignature("short", "abc-very-long-secret-1234")).toBe(false);
    });
    it("rejects length mismatch (long)", () => {
      expect(verifyStripeWebhookSignature("abc-very-long-secret-1234-and-extra", "abc-very-long-secret-1234")).toBe(false);
    });
    it("rejects empty signature", () => {
      expect(verifyStripeWebhookSignature("", "abc-very-long-secret-1234")).toBe(false);
    });
    it("rejects null signature", () => {
      expect(verifyStripeWebhookSignature(null, "abc-very-long-secret-1234")).toBe(false);
    });
  });

  describe("F9.10 — /api/version (real Express handler over HTTP)", () => {
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
      const app = express();
      app.get("/api/version", versionHandler);
      await new Promise<void>((r) => {
        server = app.listen(0, () => {
          port = (server.address() as AddressInfo).port;
          r();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    function get(path: string): Promise<{ status: number; body: any }> {
      return new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path }, (res) => {
          let buf = "";
          res.on("data", (d) => (buf += d));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode!, body: JSON.parse(buf) });
            } catch (e) {
              reject(e);
            }
          });
        }).on("error", reject);
      });
    }

    it("returns 200 with all four required keys", async () => {
      const { status, body } = await get("/api/version");
      expect(status).toBe(200);
      expect(body).toHaveProperty("version");
      expect(body).toHaveProperty("buildSha");
      expect(body).toHaveProperty("builtAt");
      expect(body).toHaveProperty("env");
    });

    it("buildSha resolves from GIT_COMMIT_SHA env when set", async () => {
      const prev = process.env.GIT_COMMIT_SHA;
      process.env.GIT_COMMIT_SHA = "test-sha-abc123";
      try {
        const { body } = await get("/api/version");
        expect(body.buildSha).toBe("test-sha-abc123");
      } finally {
        if (prev === undefined) delete process.env.GIT_COMMIT_SHA;
        else process.env.GIT_COMMIT_SHA = prev;
      }
    });
  });

  describe("F7.9 — ENGINE_VERSION pre-push guard (script behavior)", () => {
    const scriptAbs = resolve("scripts/check-engine-version-bump.sh");
    let workDir: string;

    beforeAll(() => {
      workDir = mkdtempSync(join(tmpdir(), "f7-9-guard-"));
      // Initialize a throwaway git repo with the watched-file shape.
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workDir });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: workDir });
      execFileSync("git", ["config", "user.name", "t"], { cwd: workDir });
      mkdirSync(join(workDir, "server/market-intelligence-v3"), { recursive: true });
      writeFileSync(join(workDir, "server/market-intelligence-v3/fetch-orchestrator.ts"), "export const x = 1;\n");
      writeFileSync(join(workDir, "server/market-intelligence-v3/constants.ts"), "export const ENGINE_VERSION = 19;\n");
      execFileSync("git", ["add", "."], { cwd: workDir });
      execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: workDir });
      // Copy the script into the repo so its relative paths resolve.
      mkdirSync(join(workDir, "scripts"), { recursive: true });
      const scriptText = execFileSync("cat", [scriptAbs]).toString();
      const localScript = join(workDir, "scripts/check-engine-version-bump.sh");
      writeFileSync(localScript, scriptText);
      chmodSync(localScript, 0o755);
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    function runGuard(baseRef: string): { code: number; output: string } {
      try {
        const out = execFileSync("bash", ["scripts/check-engine-version-bump.sh"], {
          cwd: workDir,
          env: { ...process.env, BASE_REF: baseRef },
          encoding: "utf8",
        });
        return { code: 0, output: out };
      } catch (e: any) {
        return { code: e.status ?? 1, output: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
      }
    }

    it("FAILS when watched file changes WITHOUT constants.ts touched", () => {
      writeFileSync(join(workDir, "server/market-intelligence-v3/fetch-orchestrator.ts"), "export const x = 2;\n");
      execFileSync("git", ["add", "-A"], { cwd: workDir });
      execFileSync("git", ["commit", "-q", "-m", "drift"], { cwd: workDir });
      const result = runGuard("HEAD~1");
      expect(result.code).not.toBe(0);
    });

    it("PASSES when watched file changes AND constants.ts ENGINE_VERSION bumped", () => {
      writeFileSync(join(workDir, "server/market-intelligence-v3/fetch-orchestrator.ts"), "export const x = 3;\n");
      writeFileSync(join(workDir, "server/market-intelligence-v3/constants.ts"), "export const ENGINE_VERSION = 20;\n");
      execFileSync("git", ["add", "-A"], { cwd: workDir });
      execFileSync("git", ["commit", "-q", "-m", "bumped"], { cwd: workDir });
      const result = runGuard("HEAD~1");
      expect(result.code).toBe(0);
    });
  });

  describe("F5.7 — Web inset constants centralized (real module export)", () => {
    it("lib/insets exports both WEB_TOP_INSET and WEB_BOTTOM_INSET", async () => {
      const insets = await import("../../lib/insets");
      expect(insets.WEB_TOP_INSET).toBe(67);
      expect(insets.WEB_BOTTOM_INSET).toBe(34);
    });
  });
});
