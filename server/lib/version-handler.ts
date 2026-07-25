/**
 * F9.10 — `/api/version` handler factory.
 *
 * Extracted into its own module so behavior-level tests can mount the
 * EXACT same handler in an Express app and assert on the real response
 * (not on a hand-rolled exemplar object). Drift in this file fails the
 * regression test.
 */
import type { Request, Response } from "express";

export interface VersionPayload {
  version: string;
  buildSha: string;
  builtAt: string | null;
  env: string;
}

export async function resolveBuildSha(): Promise<string> {
  let buildSha = process.env.GIT_COMMIT_SHA || "unknown";
  if (buildSha === "unknown") {
    try {
      const fs = await import("fs/promises");
      const head = (await fs.readFile(".git/HEAD", "utf8")).trim();
      if (head.startsWith("ref: ")) {
        const refPath = head.slice(5);
        buildSha = (await fs.readFile(`.git/${refPath}`, "utf8")).trim().slice(0, 12);
      } else {
        buildSha = head.slice(0, 12);
      }
    } catch {
      buildSha = "unknown";
    }
  }
  return buildSha;
}

export async function buildVersionPayload(): Promise<VersionPayload> {
  return {
    version: process.env.npm_package_version || "0.0.0",
    buildSha: await resolveBuildSha(),
    builtAt: process.env.BUILD_TIMESTAMP || null,
    env: process.env.NODE_ENV || "development",
  };
}

export async function versionHandler(_req: Request, res: Response): Promise<void> {
  const payload = await buildVersionPayload();
  res.json(payload);
}
