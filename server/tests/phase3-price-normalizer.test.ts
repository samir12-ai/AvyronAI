/**
 * Phase 3 — Business Understanding / Offering / Price Contracts Isolated Tests
 *
 * Verifies:
 * 1. Physical CPG price normalization:
 *    - 400g at $25 -> $62.50 / kg
 *    - 1kg at $50 -> $50.00 / kg
 *    - 500g at 450 TL -> 900.00 TL / kg
 * 2. SaaS price normalization:
 *    - $200/mo for 5 seats -> $40.00 / seat / month (Fixes math bug in prior proposal)
 *    - $1200/yr for 5 seats -> $20.00 / seat / month
 *    - $50/mo per seat -> $50.00 / seat / month
 * 3. Services / hourly price normalization:
 *    - $150/hr -> $150.00 / hour
 * 4. Non-numeric / Quote-based / Free pricing:
 *    - "Contact us for custom enterprise pricing" -> QUOTE_BASED with amount: null
 *    - "Free tier" -> FREE with amount: 0
 * 5. Currency detection & preservation:
 *    - Correctly handles USD, EUR, GBP, TRY, AED
 * 6. OfferingVariantSpec construction:
 *    - Does not force default true on isSelectedCampaignVariant (Correction #1)
 */

import { describe, it, expect } from "vitest";
import {
  normalizePrice,
  detectCurrency,
  formatCurrencyAmount,
  createOfferingVariantSpec,
} from "../shared/price-normalizer";

describe("Phase 3: Currency Detection & Formatting", () => {
  it("detects major currencies accurately", () => {
    expect(detectCurrency("$49.99")).toBe("USD");
    expect(detectCurrency("€35.00")).toBe("EUR");
    expect(detectCurrency("£25.50")).toBe("GBP");
    expect(detectCurrency("450 TL")).toBe("TRY");
    expect(detectCurrency("₺600")).toBe("TRY");
    expect(detectCurrency("500 AED")).toBe("AED");
  });

  it("formats currency amounts cleanly", () => {
    expect(formatCurrencyAmount(25, "USD")).toBe("$25.00");
    expect(formatCurrencyAmount(62.5, "USD")).toBe("$62.50");
    expect(formatCurrencyAmount(450, "TRY")).toBe("450.00 TL");
    expect(formatCurrencyAmount(35, "EUR")).toBe("€35.00");
  });
});

describe("Phase 3: Physical CPG Price Normalization", () => {
  it("normalizes 400g box at $25 to $62.50 / kg", () => {
    const price = normalizePrice({
      amount: 25,
      currency: "USD",
      unit: "g",
      unitQuantity: 400,
    });

    expect(price.kind).toBe("FIXED");
    expect(price.amount).toBe(25);
    expect(price.currency).toBe("USD");
    expect(price.normalized).not.toBeNull();
    expect(price.normalized?.unit).toBe("kg");
    expect(price.normalized?.normalizedAmount).toBe(62.5);
    expect(price.normalized?.displayString).toBe("$62.50 / kg");
  });

  it("normalizes 1kg box at $50 to $50.00 / kg", () => {
    const price = normalizePrice({
      amount: 50,
      currency: "USD",
      unit: "kg",
      unitQuantity: 1,
    });

    expect(price.normalized?.unit).toBe("kg");
    expect(price.normalized?.normalizedAmount).toBe(50);
    expect(price.normalized?.displayString).toBe("$50.00 / kg");
  });

  it("normalizes 500g box in TRY currency cleanly", () => {
    const price = normalizePrice({
      amount: 450,
      currency: "TRY",
      unit: "g",
      unitQuantity: 500,
    });

    expect(price.currency).toBe("TRY");
    expect(price.normalized?.unit).toBe("kg");
    expect(price.normalized?.normalizedAmount).toBe(900);
    expect(price.normalized?.displayString).toBe("900.00 TL / kg");
  });

  it("parses weight strings like '400g mixed sweets $25' automatically", () => {
    const price = normalizePrice("$25 for 400g box");
    expect(price.amount).toBe(25);
    expect(price.normalized?.normalizedAmount).toBe(62.5);
    expect(price.normalized?.unit).toBe("kg");
  });
});

describe("Phase 3: SaaS Subscription Normalization", () => {
  it("normalizes $200/mo for 5 seats to $40.00 / seat / month", () => {
    const price = normalizePrice({
      kind: "SUBSCRIPTION",
      amount: 200,
      currency: "USD",
      billingPeriod: "MONTHLY",
      seats: 5,
    });

    expect(price.kind).toBe("SUBSCRIPTION");
    expect(price.normalized?.unit).toBe("seat_month");
    expect(price.normalized?.normalizedAmount).toBe(40);
    expect(price.normalized?.displayString).toBe("$40.00 / seat / month");
  });

  it("normalizes annual billing of $1200/yr for 5 seats to $20.00 / seat / month", () => {
    const price = normalizePrice({
      kind: "SUBSCRIPTION",
      amount: 1200,
      currency: "USD",
      billingPeriod: "ANNUAL",
      seats: 5,
    });

    expect(price.normalized?.unit).toBe("seat_month");
    expect(price.normalized?.normalizedAmount).toBe(20);
    expect(price.normalized?.displayString).toBe("$20.00 / seat / month");
  });

  it("normalizes single-seat monthly subscription at $50/mo", () => {
    const price = normalizePrice({
      kind: "SUBSCRIPTION",
      amount: 50,
      currency: "USD",
      billingPeriod: "MONTHLY",
      seats: 1,
    });

    expect(price.normalized?.normalizedAmount).toBe(50);
    expect(price.normalized?.displayString).toBe("$50.00 / seat / month");
  });
});

describe("Phase 3: Services & Hourly Normalization", () => {
  it("normalizes hourly consultation rate of $150/hr", () => {
    const price = normalizePrice({
      amount: 150,
      currency: "USD",
      billingPeriod: "HOURLY",
      unit: "hour",
    });

    expect(price.kind).toBe("UNIT_RATE");
    expect(price.normalized?.unit).toBe("hour");
    expect(price.normalized?.normalizedAmount).toBe(150);
    expect(price.normalized?.displayString).toBe("$150.00 / hour");
  });
});

describe("Phase 3: Non-Numeric, Quote-Based, and Free Pricing", () => {
  it("handles quote-based enterprise pricing with null amount (Correction #2)", () => {
    const price = normalizePrice("Contact us for custom enterprise pricing");
    expect(price.kind).toBe("QUOTE_BASED");
    expect(price.amount).toBeNull();
    expect(price.normalized).toBeUndefined();
  });

  it("handles free plan with 0 amount", () => {
    const price = normalizePrice("Free tier");
    expect(price.kind).toBe("FREE");
    expect(price.amount).toBe(0);
    expect(price.normalized?.displayString).toBe("Free");
  });
});

describe("Phase 3: OfferingVariantSpec Contract Invariants", () => {
  it("does not default isSelectedCampaignVariant to true (Correction #1)", () => {
    const spec = createOfferingVariantSpec({
      variantId: "var_box_400g",
      name: "400g Mixed Sweets Box",
      offeringType: "PHYSICAL_PRODUCT",
      priceInput: { amount: 25, unit: "g", unitQuantity: 400 },
    });

    expect(spec.isSelectedCampaignVariant).toBeUndefined();
    expect(spec.price.normalized?.normalizedAmount).toBe(62.5);
  });

  it("preserves explicit variant selection when provided", () => {
    const spec = createOfferingVariantSpec({
      variantId: "var_box_400g",
      name: "400g Mixed Sweets Box",
      offeringType: "PHYSICAL_PRODUCT",
      priceInput: { amount: 25, unit: "g", unitQuantity: 400 },
      isSelectedCampaignVariant: true,
    });

    expect(spec.isSelectedCampaignVariant).toBe(true);
  });
});
