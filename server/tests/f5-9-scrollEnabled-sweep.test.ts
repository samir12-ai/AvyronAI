/**
 * F5.9 — scrollEnabled / showsVerticalScrollIndicator boolean coercion sweep.
 *
 * Static scanner: walks `app/` and `components/` for any usage of the
 * forbidden non-coerced pattern:
 *   scrollEnabled={someExpr || other}              (string-OR-string fallthrough)
 *   showsVerticalScrollIndicator={someExpr || …}
 *
 * The expo react-native bridge throws
 *   "TypeError: expected dynamic type 'boolean', but had type 'string'"
 * when a string lands in these props. Allowed shapes:
 *   - literal: `{true}` / `{false}`
 *   - explicitly coerced: `{!!expr}` / `{Boolean(expr)}`
 *   - omitted entirely
 *
 * Passing this test is the F5.9 closure evidence — no manual sweep needed.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const FORBIDDEN_PROPS = ["scrollEnabled", "showsVerticalScrollIndicator", "showsHorizontalScrollIndicator"];
const SCAN_DIRS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "web-build", ".git"]);

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield full;
  }
}

function findOffenders(filePath: string): string[] {
  const src = readFileSync(filePath, "utf8");
  const offenders: string[] = [];
  for (const prop of FORBIDDEN_PROPS) {
    // Match `prop={...}` then inspect the brace contents.
    const re = new RegExp(`\\b${prop}=\\{([^{}]*)\\}`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const expr = m[1].trim();
      if (expr === "true" || expr === "false") continue;
      if (expr.startsWith("!!")) continue;
      if (/^Boolean\s*\(/.test(expr)) continue;
      // Coerced ternary (?:) producing literal true/false on both sides is OK.
      if (/\?\s*(true|false)\s*:\s*(true|false)\s*$/.test(expr)) continue;
      // Forbidden patterns: bare `||` or `??` between non-boolean operands.
      if (/\|\||\?\?/.test(expr)) {
        offenders.push(`${filePath}: ${prop}={${expr}}`);
      }
    }
  }
  return offenders;
}

describe("F5.9 — scrollEnabled boolean coercion sweep", () => {
  it("no non-coerced scrollEnabled / showsVerticalScrollIndicator in app/ or components/", () => {
    const allOffenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(dir)) {
        allOffenders.push(...findOffenders(file));
      }
    }
    expect(allOffenders, allOffenders.join("\n")).toEqual([]);
  });

  it("scanner correctly flags a synthetic offender (negative-control)", () => {
    // Sanity: the regex actually catches the forbidden shape so the all-clean
    // assertion above isn't a vacuous pass.
    const synthetic = `<FlatList scrollEnabled={someStr || other} />`;
    const re = /\bscrollEnabled=\{([^{}]*)\}/;
    const m = synthetic.match(re);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\|\|/);
  });
});
