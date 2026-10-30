/**
 * Universal Price Normalizer
 *
 * Normalizes prices across:
 * 1. Physical CPG (weight/volume based, normalized to standard unit e.g. per kg)
 * 2. SaaS (subscription / seats based, normalized to per seat / month)
 * 3. Services (time / project based, normalized to per hour or per project)
 * 4. Quote-based / Custom / Free
 */

import {
  type CanonicalPrice,
  type PriceKind,
  type BillingPeriod,
  type NormalizedPricePerUnit,
  type OfferingVariantSpec,
} from "../../shared/business-understanding-types";

export interface RawPriceInput {
  kind?: PriceKind;
  currency?: string;
  amount?: number | null;
  billingPeriod?: BillingPeriod | null;
  unit?: string | null;
  unitQuantity?: number | null;
  seats?: number | null;
  weightGrams?: number | null;
  rawPriceString?: string | null;
  pricingNotes?: string | null;
}

/**
 * Currency symbol and code detection
 */
export function detectCurrency(text: string): string {
  if (!text) return "USD";
  const upper = text.toUpperCase();
  if (upper.includes("TRY") || upper.includes("TL") || text.includes("₺")) return "TRY";
  if (upper.includes("EUR") || text.includes("€")) return "EUR";
  if (upper.includes("GBP") || text.includes("£")) return "GBP";
  if (upper.includes("AED")) return "AED";
  if (upper.includes("CAD") || upper.includes("C$")) return "CAD";
  if (upper.includes("AUD") || upper.includes("A$")) return "AUD";
  if (upper.includes("SAR")) return "SAR";
  if (upper.includes("USD") || text.includes("$")) return "USD";
  return "USD";
}

/**
 * Currency symbol formatter
 */
export function formatCurrencyAmount(amount: number, currency: string): string {
  const formatted = amount.toFixed(2);
  switch (currency.toUpperCase()) {
    case "USD": return `$${formatted}`;
    case "EUR": return `€${formatted}`;
    case "GBP": return `£${formatted}`;
    case "TRY": return `${formatted} TL`;
    default: return `${formatted} ${currency}`;
  }
}

/**
 * Parses raw text or structured parameters into a validated CanonicalPrice.
 */
export function normalizePrice(input: RawPriceInput | string | number): CanonicalPrice {
  if (typeof input === "number") {
    return {
      kind: "FIXED",
      currency: "USD",
      amount: input,
      billingPeriod: "ONE_TIME",
      normalized: {
        unit: "unit",
        normalizedAmount: input,
        currency: "USD",
        displayString: formatCurrencyAmount(input, "USD"),
      },
      rawPriceString: String(input),
    };
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    const currency = detectCurrency(trimmed);

    // Check for quote/enterprise patterns
    if (/(contact|quote|custom|enterprise|inquire|request)/i.test(trimmed)) {
      return {
        kind: "QUOTE_BASED",
        currency,
        amount: null,
        rawPriceString: trimmed,
        pricingNotes: trimmed,
      };
    }

    // Check for free
    if (/\bfree\b/i.test(trimmed) || /0\s*(\$|usd|eur|tl)/i.test(trimmed)) {
      return {
        kind: "FREE",
        currency,
        amount: 0,
        billingPeriod: "ONE_TIME",
        normalized: {
          unit: "free",
          normalizedAmount: 0,
          currency,
          displayString: "Free",
        },
        rawPriceString: trimmed,
      };
    }

    // Extract numeric amount
    const numMatch = trimmed.match(/(\d+(?:[.,]\d+)?)/);
    const amount = numMatch ? parseFloat(numMatch[1].replace(",", ".")) : null;

    if (amount === null) {
      return {
        kind: "QUOTE_BASED",
        currency,
        amount: null,
        rawPriceString: trimmed,
      };
    }

    // Check unit / period patterns in string
    let unit: string | null = null;
    let unitQuantity: number | null = null;
    let billingPeriod: BillingPeriod = "ONE_TIME";

    // Weight checks (e.g. 400g, 500g, 1kg)
    const weightMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(kg|g|gram|grams)\b/i);
    if (weightMatch) {
      unitQuantity = parseFloat(weightMatch[1]);
      unit = weightMatch[2].toLowerCase().startsWith("kg") ? "kg" : "g";
    }

    // SaaS checks (e.g. /seat/mo, /user/mo, /month)
    if (/(seat|user)/i.test(trimmed)) {
      unit = "seat";
      const seatMatch = trimmed.match(/(\d+)\s*(?:seat|user)s?/i);
      if (seatMatch) unitQuantity = parseInt(seatMatch[1], 10);
    }
    if (/(mo|month)/i.test(trimmed)) {
      billingPeriod = "MONTHLY";
    } else if (/(yr|year|annual)/i.test(trimmed)) {
      billingPeriod = "ANNUAL";
    } else if (/(hr|hour)/i.test(trimmed)) {
      billingPeriod = "HOURLY";
      unit = "hour";
    }

    return normalizePrice({
      currency,
      amount,
      billingPeriod,
      unit,
      unitQuantity,
      rawPriceString: trimmed,
    });
  }

  // Structured RawPriceInput
  const currency = (input.currency || detectCurrency(input.rawPriceString || "") || "USD").toUpperCase();
  const rawAmount = input.amount ?? null;
  const rawString = input.rawPriceString || (rawAmount != null ? `${rawAmount} ${currency}` : undefined);

  // Quote based
  if (input.kind === "QUOTE_BASED" || (rawAmount === null && input.kind !== "FREE")) {
    return {
      kind: "QUOTE_BASED",
      currency,
      amount: null,
      billingPeriod: input.billingPeriod ?? null,
      unit: input.unit ?? null,
      unitQuantity: input.unitQuantity ?? null,
      rawPriceString: rawString,
      pricingNotes: input.pricingNotes,
    };
  }

  // Free
  if (input.kind === "FREE" || rawAmount === 0) {
    return {
      kind: "FREE",
      currency,
      amount: 0,
      billingPeriod: input.billingPeriod ?? "ONE_TIME",
      normalized: {
        unit: "free",
        normalizedAmount: 0,
        currency,
        displayString: "Free",
      },
      rawPriceString: rawString,
    };
  }

  // 1. Weight-based physical CPG normalizer (target: per kg)
  const isGrams = input.unit === "g" || input.unit === "gram" || input.unit === "grams" || input.weightGrams;
  const isKg = input.unit === "kg" || input.unit === "kilogram";

  if (isGrams) {
    const grams = input.unitQuantity || input.weightGrams || 1000;
    const perKg = (rawAmount / grams) * 1000;
    const rounded = Math.round(perKg * 100) / 100;
    return {
      kind: input.kind || "FIXED",
      currency,
      amount: rawAmount,
      billingPeriod: input.billingPeriod || "ONE_TIME",
      unit: "g",
      unitQuantity: grams,
      normalized: {
        unit: "kg",
        normalizedAmount: rounded,
        currency,
        displayString: `${formatCurrencyAmount(rounded, currency)} / kg`,
      },
      rawPriceString: rawString,
      pricingNotes: input.pricingNotes,
    };
  }

  if (isKg) {
    const qty = input.unitQuantity || 1;
    const perKg = rawAmount / qty;
    const rounded = Math.round(perKg * 100) / 100;
    return {
      kind: input.kind || "FIXED",
      currency,
      amount: rawAmount,
      billingPeriod: input.billingPeriod || "ONE_TIME",
      unit: "kg",
      unitQuantity: qty,
      normalized: {
        unit: "kg",
        normalizedAmount: rounded,
        currency,
        displayString: `${formatCurrencyAmount(rounded, currency)} / kg`,
      },
      rawPriceString: rawString,
      pricingNotes: input.pricingNotes,
    };
  }

  // 2. SaaS normalizer (target: per seat / month)
  const isSaaS = input.kind === "SUBSCRIPTION" || input.seats || input.unit === "seat" || input.unit === "user";
  if (isSaaS) {
    const seats = input.seats || input.unitQuantity || 1;
    let monthlyAmount = rawAmount;
    if (input.billingPeriod === "ANNUAL") {
      monthlyAmount = rawAmount / 12;
    }

    const perSeatMonth = monthlyAmount / seats;
    const rounded = Math.round(perSeatMonth * 100) / 100;

    return {
      kind: "SUBSCRIPTION",
      currency,
      amount: rawAmount,
      billingPeriod: input.billingPeriod || "MONTHLY",
      unit: "seat",
      unitQuantity: seats,
      normalized: {
        unit: "seat_month",
        normalizedAmount: rounded,
        currency,
        displayString: `${formatCurrencyAmount(rounded, currency)} / seat / month`,
      },
      rawPriceString: rawString,
      pricingNotes: input.pricingNotes,
    };
  }

  // 3. Service / Hourly normalizer (target: per hour)
  const isHourly = input.billingPeriod === "HOURLY" || input.unit === "hour" || input.unit === "hr";
  if (isHourly) {
    const rounded = Math.round(rawAmount * 100) / 100;
    return {
      kind: "UNIT_RATE",
      currency,
      amount: rawAmount,
      billingPeriod: "HOURLY",
      unit: "hour",
      unitQuantity: input.unitQuantity || 1,
      normalized: {
        unit: "hour",
        normalizedAmount: rounded,
        currency,
        displayString: `${formatCurrencyAmount(rounded, currency)} / hour`,
      },
      rawPriceString: rawString,
      pricingNotes: input.pricingNotes,
    };
  }

  // Default fallback
  const rounded = Math.round(rawAmount * 100) / 100;
  return {
    kind: input.kind || "FIXED",
    currency,
    amount: rawAmount,
    billingPeriod: input.billingPeriod || "ONE_TIME",
    unit: input.unit || "unit",
    unitQuantity: input.unitQuantity || 1,
    normalized: {
      unit: input.unit || "unit",
      normalizedAmount: rounded,
      currency,
      displayString: formatCurrencyAmount(rounded, currency),
    },
    rawPriceString: rawString,
    pricingNotes: input.pricingNotes,
  };
}

/**
 * Creates an OfferingVariantSpec with normalized canonical price.
 */
export function createOfferingVariantSpec(params: {
  variantId: string;
  name: string;
  offeringType: "PHYSICAL_PRODUCT" | "DIGITAL_PRODUCT" | "SAAS" | "SERVICE" | "HYBRID";
  priceInput: RawPriceInput | string | number;
  sku?: string | null;
  attributes?: Record<string, string | number | boolean>;
  isDefault?: boolean;
  isSelectedCampaignVariant?: boolean;
}): OfferingVariantSpec {
  return {
    variantId: params.variantId,
    name: params.name,
    offeringType: params.offeringType,
    sku: params.sku ?? null,
    attributes: params.attributes,
    price: normalizePrice(params.priceInput),
    isDefault: params.isDefault,
    isSelectedCampaignVariant: params.isSelectedCampaignVariant,
  };
}
