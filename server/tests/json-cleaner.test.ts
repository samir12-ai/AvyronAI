import { describe, it, expect } from "vitest";
import { cleanJsonString } from "../strategic-core/extraction-routes";

describe("JSON Cleaner", () => {
  it("strips markdown code fences (```json ... ```)", () => {
    const input = '```json\n{"a": 1, "b": "hello"}\n```';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: 1, b: "hello" });
  });

  it("strips plain code fences (``` ... ```)", () => {
    const input = '```\n{"x": true}\n```';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ x: true });
  });

  it("removes trailing commas in objects", () => {
    const input = '{"a": 1, "b": 2, }';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("removes trailing commas in arrays", () => {
    const input = '{"items": [1, 2, 3, ]}';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ items: [1, 2, 3] });
  });

  it("removes nested trailing commas", () => {
    const input = '{"a": {"b": 1, }, "c": [1, 2, ], }';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: { b: 1 }, c: [1, 2] });
  });

  it("does NOT over-strip valid JSON (no trailing commas)", () => {
    const valid = '{"a": 1, "b": [1, 2, 3], "c": {"d": "hello"}}';
    const result = cleanJsonString(valid);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: 1, b: [1, 2, 3], c: { d: "hello" } });
  });

  it("preserves valid JSON with strings containing special chars", () => {
    const valid = '{"msg": "Hello, world!", "data": [1, 2]}';
    const result = cleanJsonString(valid);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ msg: "Hello, world!", data: [1, 2] });
  });

  it("preserves commas inside string values", () => {
    const input = '{"text": "one, two, three", "count": 3}';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed.text).toBe("one, two, three");
    expect(parsed.count).toBe(3);
  });

  it("handles code fences + trailing commas together", () => {
    const input = '```json\n{"a": 1, "b": 2, }\n```';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("handles preamble text before JSON", () => {
    const input = 'Here is the analysis:\n\n{"result": "ok"}';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ result: "ok" });
  });

  it("removes single-line comments", () => {
    const input = '{\n"a": 1, // this is a comment\n"b": 2\n}';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("throws on input with no JSON object", () => {
    expect(() => cleanJsonString("just plain text with no json")).toThrow();
  });

  it("handles real extraction-shaped response with code fences and trailing commas", () => {
    const input = '```json\n{\n  "detectedLanguage": "en",\n  "transcribedText": null,\n  "ocrText": "Buy Now",\n  "detectedOffer": { "value": "50% off", "confidence": 85, },\n  "detectedPositioning": { "value": "discount", "confidence": 90, },\n  "detectedCTA": { "value": "Shop Now", "confidence": 95, },\n  "detectedAudienceGuess": { "value": "millennials", "confidence": 70, },\n  "detectedFunnelStage": { "value": "conversion", "confidence": 80, },\n  "detectedPriceIfVisible": { "value": 29.99, "confidence": 92, },\n}\n```';
    const result = cleanJsonString(input);
    const parsed = JSON.parse(result);
    expect(parsed.detectedLanguage).toBe("en");
    expect(parsed.detectedOffer.value).toBe("50% off");
    expect(parsed.detectedPriceIfVisible.value).toBe(29.99);
  });
});
