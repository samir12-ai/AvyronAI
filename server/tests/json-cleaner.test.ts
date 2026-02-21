import { cleanJsonString } from "../strategic-core/extraction-routes";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
  } catch (e: any) {
    results.push({ name, passed: false, error: e.message });
  }
}

function assertEqual(actual: any, expected: any) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Expected ${e}, got ${a}`);
  }
}

test("strips markdown code fences (```json ... ```)", () => {
  const input = '```json\n{"a": 1, "b": "hello"}\n```';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { a: 1, b: "hello" });
});

test("strips plain code fences (``` ... ```)", () => {
  const input = '```\n{"x": true}\n```';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { x: true });
});

test("removes trailing commas in objects", () => {
  const input = '{"a": 1, "b": 2, }';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { a: 1, b: 2 });
});

test("removes trailing commas in arrays", () => {
  const input = '{"items": [1, 2, 3, ]}';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { items: [1, 2, 3] });
});

test("removes nested trailing commas", () => {
  const input = '{"a": {"b": 1, }, "c": [1, 2, ], }';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { a: { b: 1 }, c: [1, 2] });
});

test("does NOT over-strip valid JSON (no trailing commas)", () => {
  const valid = '{"a": 1, "b": [1, 2, 3], "c": {"d": "hello"}}';
  const result = cleanJsonString(valid);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { a: 1, b: [1, 2, 3], c: { d: "hello" } });
});

test("preserves valid JSON with strings containing special chars", () => {
  const valid = '{"msg": "Hello, world!", "data": [1, 2]}';
  const result = cleanJsonString(valid);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { msg: "Hello, world!", data: [1, 2] });
});

test("preserves commas inside string values", () => {
  const input = '{"text": "one, two, three", "count": 3}';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.text, "one, two, three");
  assertEqual(parsed.count, 3);
});

test("handles code fences + trailing commas together", () => {
  const input = '```json\n{"a": 1, "b": 2, }\n```';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { a: 1, b: 2 });
});

test("handles preamble text before JSON", () => {
  const input = 'Here is the analysis:\n\n{"result": "ok"}';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { result: "ok" });
});

test("removes single-line comments", () => {
  const input = '{\n"a": 1, // this is a comment\n"b": 2\n}';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed, { a: 1, b: 2 });
});

test("throws on input with no JSON object", () => {
  let threw = false;
  try {
    cleanJsonString("just plain text with no json");
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected cleanJsonString to throw on non-JSON input");
});

test("handles real extraction-shaped response with code fences and trailing commas", () => {
  const input = '```json\n{\n  "detectedLanguage": "en",\n  "transcribedText": null,\n  "ocrText": "Buy Now",\n  "detectedOffer": { "value": "50% off", "confidence": 85, },\n  "detectedPositioning": { "value": "discount", "confidence": 90, },\n  "detectedCTA": { "value": "Shop Now", "confidence": 95, },\n  "detectedAudienceGuess": { "value": "millennials", "confidence": 70, },\n  "detectedFunnelStage": { "value": "conversion", "confidence": 80, },\n  "detectedPriceIfVisible": { "value": 29.99, "confidence": 92, },\n}\n```';
  const result = cleanJsonString(input);
  const parsed = JSON.parse(result);
  assertEqual(parsed.detectedLanguage, "en");
  assertEqual(parsed.detectedOffer.value, "50% off");
  assertEqual(parsed.detectedPriceIfVisible.value, 29.99);
});

async function runAll() {
  console.log("\n=== JSON Cleaner Unit Tests ===\n");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const r of results) {
    console.log(`${r.passed ? "✓" : "✗"} ${r.name}${r.error ? ` — ${r.error}` : ""}`);
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${results.length} tests\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAll();
