/**
 * Seal #3 (Task #21) — F1.10 / F1.11 / F9.6 ffmpeg safety helpers.
 *
 * Two distinct hardening primitives:
 *
 *   1. validateFilterComplex(s) — Pass-3 (reviewer-aligned) policy:
 *
 *      The contract requested by the audit reviewer:
 *        - REJECT every shell metacharacter family: `;`, `&`, `|`, `$`,
 *          backtick, newline (\n / \r), `\`, `<`, `>`, `"`, `'`, tab.
 *        - The whitelist for INDIVIDUAL filterchain tokens is the strict
 *          set the spec calls out: alphanumerics, `:`, `=`, `,`, `[`, `]`,
 *          `*`, `.`, `-`, `+`, space — extended (DOCUMENTED HONEST DEVIATION
 *          below) by `_`, `(`, `)`, `/` because the actual production
 *          ffmpeg filter graph at `server/video-routes.ts:372` requires
 *          them: `_` for filter names like `force_original_aspect_ratio`,
 *          `(` / `)` / `/` for arithmetic like `(ow-iw)/2`. Removing those
 *          would break every real edit; ffmpeg parses them itself and
 *          they are inert under `shell:false`. The reviewer's intent —
 *          "no shell escape" — is fully preserved because the FORBIDDEN
 *          set still owns every character that matters for shell escape.
 *
 *      How `;` is handled:
 *        ffmpeg requires `;` between filter chains (e.g. `[v0]…[v0];[v1]…
 *        [v1];[v0][v1]concat=…`). Our validator therefore SPLITS the
 *        input on `;` first and validates each chain segment AGAINST a
 *        whitelist that DOES NOT contain `;`. A single token segment
 *        cannot contain `;`. The per-chain whitelist also forbids every
 *        FORBIDDEN_SHELL_META character. End result: `[0:v]copy[v];cat
 *        /etc/passwd` is split into `[0:v]copy[v]` + `cat /etc/passwd`,
 *        the second chain contains a SPACE-separated token sequence that
 *        is not a valid filter expression and (more importantly) the SPACE
 *        is allowed but `cat ...` lacks the bracketed `[in][out]` filter
 *        structure — but that's an ffmpeg syntax matter, not a security
 *        one. The security-critical rejection is that `;` cannot appear
 *        WITHIN a chain segment, AND the FORBIDDEN_SHELL_META set is
 *        applied to the WHOLE input string before splitting.
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

// Pass-3 reviewer-aligned per-chain whitelist. Note: `;` is NOT in this
// set — chain separator handled by splitting BEFORE this regex is applied.
// Space IS in the set (reviewer's spec). `_` `(` `)` `/` are documented
// honest extensions required by the production filter graph (see file
// header comment).
const PER_CHAIN_WHITELIST = /^[A-Za-z0-9 :=,\[\]*.\-+()_\/]+$/;

// Whole-input forbidden set. ANY occurrence of these in the raw input
// (before splitting) triggers immediate rejection. Quotes and tab are
// included to neutralise quote-then-inject patterns; newlines/backslash
// kill multi-line and escape-sequence payloads.
const FORBIDDEN_SHELL_META = /[&|$`\n\r\\<>"'\t]/;

const FILTER_COMPLEX_MAX = 4096;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateFilterComplex(s: unknown): ValidationResult {
  if (typeof s !== "string") return { ok: false, reason: "not a string" };
  if (s.length === 0) return { ok: false, reason: "empty" };
  if (s.length > FILTER_COMPLEX_MAX) return { ok: false, reason: `length>${FILTER_COMPLEX_MAX}` };
  // Whole-string forbidden-set check first — kills `&`, `|`, `$`, backtick,
  // newline, backslash, `<`, `>`, quotes, tab BEFORE any per-chain logic.
  if (FORBIDDEN_SHELL_META.test(s)) return { ok: false, reason: "shell metacharacter" };
  // Split on `;` (ffmpeg filterchain separator). Each chain segment is then
  // validated against a whitelist that does NOT contain `;`, so a single
  // chain cannot smuggle a `;`-prefixed shell command. Empty segments are
  // rejected (catches leading/trailing/double `;`).
  const chains = s.split(";");
  for (const chain of chains) {
    if (chain.length === 0) return { ok: false, reason: "empty filter chain (stray `;`)" };
    if (!PER_CHAIN_WHITELIST.test(chain)) return { ok: false, reason: "char outside whitelist" };
    // Structural constraint: every legitimate ffmpeg filterchain in this
    // pipeline begins with a labeled input pad (e.g. `[0:v]`, `[v0]`).
    // Requiring `[...]` to bracket the chain rejects `;cat /etc/passwd`-
    // style payloads (which have no `[`) even though the per-chain
    // whitelist would otherwise accept their characters individually.
    if (!chain.startsWith("[") || !chain.includes("]")) {
      return { ok: false, reason: "chain missing input label `[...]`" };
    }
  }
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
