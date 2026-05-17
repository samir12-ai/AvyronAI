import { describe, it, expect } from "vitest";
import { redactString, redactValue, RedactionMap } from "../../orchestrator/replay/redaction";

describe("Task #89 / redaction — PII field classes", () => {
  it("redacts email addresses to a stable token (same input → same token)", () => {
    const m = new RedactionMap();
    const t1 = redactString("Contact founder@acme.com for details", m);
    const t2 = redactString("Email: founder@acme.com", m);
    expect(t1).toMatch(/redact:[a-f0-9]{12}/);
    expect(t1.match(/redact:[a-f0-9]{12}/)![0]).toBe(t2.match(/redact:[a-f0-9]{12}/)![0]);
    expect(m.size()).toBe(1);
  });

  it("redacts @handles but not email local-parts", () => {
    const m = new RedactionMap();
    const out = redactString("DM @brandhandle or email founder@acme.com", m);
    expect(out).not.toContain("@brandhandle");
    expect(out).not.toContain("founder@acme.com");
    // Two distinct PII values → two tokens.
    expect(m.size()).toBe(2);
  });

  it("redacts bare FQDNs (acme.com) but not single-label words", () => {
    const m = new RedactionMap();
    const out = redactString("visit www.acme.com or shop.acme.com today", m);
    expect(out).not.toContain("www.acme.com");
    expect(out).not.toContain("shop.acme.com");
    expect(out).toContain("today");
  });

  it("walks nested objects/arrays and redacts every string", () => {
    const m = new RedactionMap();
    const out = redactValue(
      {
        accountEmail: "owner@brand.co",
        socials: ["@brand", "@brand_official"],
        meta: { nested: { website: "https://brand.co/blog" } },
        nonString: 42,
        boolField: true,
        arr: [{ contact: "ops@brand.co" }],
      },
      m,
    );
    expect(out.accountEmail).toMatch(/redact:[a-f0-9]{12}/);
    expect(out.socials[0]).toMatch(/redact:[a-f0-9]{12}/);
    expect(out.meta.nested.website).not.toContain("brand.co");
    expect(out.nonString).toBe(42);
    expect(out.boolField).toBe(true);
    expect(out.arr[0].contact).toMatch(/redact:[a-f0-9]{12}/);
  });

  it("RedactionMap.clear() wipes originals so PII does not linger", () => {
    const m = new RedactionMap();
    redactString("a@b.com", m);
    expect(m.size()).toBe(1);
    m.clear();
    expect(m.size()).toBe(0);
  });

  it("returns the input unchanged when nothing matches", () => {
    const m = new RedactionMap();
    const out = redactString("simple text without pii", m);
    expect(out).toBe("simple text without pii");
    expect(m.size()).toBe(0);
  });
});
