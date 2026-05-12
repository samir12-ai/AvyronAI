/**
 * Seal #3 (Task #21) — F1.10 / F1.11 / F9.6 ffmpeg safety helpers.
 *
 * Two distinct hardening primitives:
 *
 *   1. validateFilterComplex(s)
 *      Whitelist-only validator for any string that will be passed as a
 *      ffmpeg `-filter_complex` argument. Defends against the case where
 *      an upstream component (LLM, external API, future caller) hands us
 *      a raw filter string. The whitelist is intentionally restrictive
 *      (alphanumerics + a small set of ffmpeg-syntax chars). Anything
 *      outside the whitelist — and especially shell metacharacters like
 *      `;`, `&`, `|`, `$`, backtick, newline — is REJECTED.
 *
 *      NOTE: ffmpeg filter syntax legitimately uses `;` to separate filter
 *      chains and `(`, `)`, `/` for arithmetic. These ARE included in the
 *      whitelist because ffmpeg parses them itself once invoked via
 *      arg-array spawn (shell: false), so they cannot reach a shell.
 *
 *   2. runFfmpeg(args, opts) / runFfprobe(args, opts)
 *      Replace `execAsync(\`ffmpeg ...\`)` (which spawned `/bin/sh -c`)
 *      with `spawn("ffmpeg", [...args], { shell: false })`. With
 *      `shell: false`, every element of `args` is passed verbatim to
 *      execvp — no shell metacharacter expansion, no command injection.
 *      A single AbortController-driven timeout enforces an upper bound
 *      on runtime (default 60s; override per-call for known-long edits).
 */
import { spawn } from "node:child_process";

// Whitelist: alphanumerics + ffmpeg-syntax chars actually used by our edit
// pipeline. SHELL METACHARS ARE EXCLUDED EVEN THOUGH spawn(shell:false)
// strips their power — defense-in-depth so a future regression to
// shell-mode won't reopen the injection vector.
const FILTER_COMPLEX_WHITELIST = /^[A-Za-z0-9:=,;\[\]*.\-+()/\s_@%']+$/;
const FORBIDDEN_SHELL_META = /[&|$`\n\r\\<>"]/;
const FILTER_COMPLEX_MAX = 4096;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateFilterComplex(s: unknown): ValidationResult {
  if (typeof s !== "string") return { ok: false, reason: "not a string" };
  if (s.length === 0) return { ok: false, reason: "empty" };
  if (s.length > FILTER_COMPLEX_MAX) return { ok: false, reason: `length>${FILTER_COMPLEX_MAX}` };
  if (FORBIDDEN_SHELL_META.test(s)) return { ok: false, reason: "shell metacharacter" };
  if (!FILTER_COMPLEX_WHITELIST.test(s)) return { ok: false, reason: "char outside whitelist" };
  return { ok: true };
}

export interface FfmpegRunOptions {
  /** Hard timeout in ms (default 60_000). Long edits should pass an explicit value. */
  timeoutMs?: number;
  /** Optional cwd. */
  cwd?: string;
}

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
}

function runBinary(bin: "ffmpeg" | "ffprobe", args: string[], opts: FfmpegRunOptions = {}): Promise<FfmpegRunResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let timedOut = false;
    ac.signal.addEventListener("abort", () => { timedOut = true; }, { once: true });

    let child;
    try {
      child = spawn(bin, args, { shell: false, signal: ac.signal, cwd: opts.cwd });
    } catch (err) {
      clearTimeout(timer);
      return reject(err);
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${bin} exited ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

export function runFfmpeg(args: string[], opts?: FfmpegRunOptions) {
  return runBinary("ffmpeg", args, opts);
}

export function runFfprobe(args: string[], opts?: FfmpegRunOptions) {
  return runBinary("ffprobe", args, opts);
}
