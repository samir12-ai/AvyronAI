/**
 * F9.3 — Constant-time Stripe webhook signature verifier.
 *
 * Extracted into its own module so behavior-level tests
 * (server/tests/regression-suite-expansion.test.ts) can call the EXACT
 * same function that runs in `server/auth.ts`. Any drift in this file
 * (e.g. revert to `===`, short-circuit `||`, dropped length-pad) fails
 * the named regression test.
 *
 * Doctrine:
 *  - Both content equality + length equality ALWAYS execute (no
 *    short-circuit). Folded with bitwise `&` so total work is constant
 *    regardless of which (or both) mismatched.
 *  - Length-padding ensures `crypto.timingSafeEqual` never throws on
 *    unequal-length inputs (it requires equal-length buffers).
 */
import * as crypto from "crypto";

export function verifyStripeWebhookSignature(
  provided: string | undefined | null,
  expected: string,
): boolean {
  const sigBuf = Buffer.from(String(provided ?? ""), "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  const padLen = Math.max(sigBuf.length, expBuf.length, 1);
  const sigPad = Buffer.concat([sigBuf, Buffer.alloc(padLen - sigBuf.length)]);
  const expPad = Buffer.concat([expBuf, Buffer.alloc(padLen - expBuf.length)]);
  const contentOk = crypto.timingSafeEqual(sigPad, expPad) ? 1 : 0;
  const lengthOk = sigBuf.length === expBuf.length ? 1 : 0;
  return (contentOk & lengthOk) === 1;
}
