/**
 * Currency & Exact Monetary Calculations for Budget Recommender.
 *
 * Enforces:
 * - Explicit ISO currency whitelist (no arbitrary 3-5 character strings).
 * - Exact currency-specific decimal scale (0, 2, 3 decimals).
 * - Validation of monetary amounts against currency decimal precision.
 * - Minor-unit integer arithmetic and deterministic rounding reconciliation.
 */

export const SUPPORTED_CURRENCIES: Record<string, { code: string; name: string; symbol: string; decimals: number }> = {
  USD: { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  GBP: { code: "GBP", name: "British Pound", symbol: "£", decimals: 2 },
  AED: { code: "AED", name: "UAE Dirham", symbol: "AED", decimals: 2 },
  SAR: { code: "SAR", name: "Saudi Riyal", symbol: "SAR", decimals: 2 },
  QAR: { code: "QAR", name: "Qatari Riyal", symbol: "QAR", decimals: 2 },
  KWD: { code: "KWD", name: "Kuwaiti Dinar", symbol: "KWD", decimals: 3 },
  BHD: { code: "BHD", name: "Bahraini Dinar", symbol: "BHD", decimals: 3 },
  OMR: { code: "OMR", name: "Omani Rial", symbol: "OMR", decimals: 3 },
  CAD: { code: "CAD", name: "Canadian Dollar", symbol: "CA$", decimals: 2 },
  AUD: { code: "AUD", name: "Australian Dollar", symbol: "A$", decimals: 2 },
  JPY: { code: "JPY", name: "Japanese Yen", symbol: "¥", decimals: 0 },
  SGD: { code: "SGD", name: "Singapore Dollar", symbol: "SG$", decimals: 2 },
  CHF: { code: "CHF", name: "Swiss Franc", symbol: "CHF", decimals: 2 },
};

export type SupportedCurrencyCode = keyof typeof SUPPORTED_CURRENCIES;

export interface CurrencyValidationResult {
  valid: boolean;
  error?: string;
  normalizedCurrency?: string;
  decimals?: number;
}

export function validateCurrency(currency: unknown): CurrencyValidationResult {
  if (currency === null || currency === undefined || currency === "") {
    return { valid: false, error: "Currency is required when specifying a budget." };
  }
  if (typeof currency !== "string") {
    return { valid: false, error: "Currency must be a string." };
  }
  const upper = currency.trim().toUpperCase();
  const config = SUPPORTED_CURRENCIES[upper];
  if (!config) {
    return {
      valid: false,
      error: `Unsupported currency code "${currency}". Supported currencies: ${Object.keys(SUPPORTED_CURRENCIES).join(", ")}.`,
    };
  }
  return { valid: true, normalizedCurrency: upper, decimals: config.decimals };
}

export interface AmountValidationResult {
  valid: boolean;
  error?: string;
  numericAmount?: number;
  normalizedAmount?: number | null;
}

export function validateBudgetAmount(amount: unknown, currencyCode?: string | null): AmountValidationResult {
  if (amount === null || amount === undefined || amount === "") {
    return { valid: true, numericAmount: undefined, normalizedAmount: null };
  }

  let num: number;
  let rawStr: string;

  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      return { valid: false, error: "Monthly budget must be a finite number." };
    }
    num = amount;
    rawStr = amount.toString();
  } else if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!trimmed) {
      return { valid: true, numericAmount: undefined, normalizedAmount: null };
    }
    // Disallow non-numeric characters except single decimal point
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { valid: false, error: "Monthly budget must be a valid positive number or zero." };
    }
    num = Number(trimmed);
    rawStr = trimmed;
    if (!Number.isFinite(num)) {
      return { valid: false, error: "Monthly budget must be a finite number." };
    }
  } else {
    return { valid: false, error: "Monthly budget must be a number or numeric string." };
  }

  if (num < 0) {
    return { valid: false, error: "Monthly budget cannot be negative." };
  }

  // Check currency decimal precision
  if (currencyCode) {
    const currCheck = validateCurrency(currencyCode);
    if (currCheck.valid && currCheck.decimals !== undefined) {
      const parts = rawStr.split(".");
      if (parts.length === 2 && parts[1].length > currCheck.decimals) {
        return {
          valid: false,
          error: `Budget precision exceeds maximum allowed decimal places for ${currCheck.normalizedCurrency} (${currCheck.decimals} decimals).`,
        };
      }
    }
  }

  return { valid: true, numericAmount: num, normalizedAmount: num };
}

/**
 * Calculates exact minor-unit monetary allocations with deterministic rounding reconciliation.
 *
 * @param totalBudget The monthly budget amount (e.g. 5000.00)
 * @param currencyCode Validated ISO currency code
 * @param allocations Array of { channelId, sharePercentage } where sum of sharePercentage is 100%
 */
export function calculateExactAllocations<T extends { channelId: string; sharePercentage: number }>(
  totalBudget: number,
  currencyCode: string,
  allocations: T[]
): Array<T & { monthlyAmount: number; minorUnits: number }> {
  if (allocations.length === 0) return [];
  if (totalBudget === 0) {
    return allocations.map((a) => ({
      ...a,
      monthlyAmount: 0,
      minorUnits: 0,
    }));
  }

  const curr = SUPPORTED_CURRENCIES[currencyCode.toUpperCase()] || { decimals: 2 };
  const factor = Math.pow(10, curr.decimals);

  // Exact integer minor units for the total budget (e.g. $5,000.00 -> 500000 cents)
  const totalMinorUnits = Math.round(totalBudget * factor);

  // Calculate raw minor units per channel
  let sumAllocatedMinorUnits = 0;
  const withMinor = allocations.map((a) => {
    // minor units = (totalMinorUnits * sharePercentage) / 100
    const rawUnits = Math.round((totalMinorUnits * a.sharePercentage) / 100);
    sumAllocatedMinorUnits += rawUnits;
    return {
      ...a,
      minorUnits: rawUnits,
      monthlyAmount: rawUnits / factor,
    };
  });

  // Reconcile rounding discrepancy deterministically
  const discrepancy = totalMinorUnits - sumAllocatedMinorUnits;
  if (discrepancy !== 0 && withMinor.length > 0) {
    // Find channel with largest share (or first one) to absorb the small 1-2 cent discrepancy
    let highestIdx = 0;
    let highestShare = -1;
    for (let i = 0; i < withMinor.length; i++) {
      if (withMinor[i].sharePercentage > highestShare) {
        highestShare = withMinor[i].sharePercentage;
        highestIdx = i;
      }
    }
    withMinor[highestIdx].minorUnits += discrepancy;
    withMinor[highestIdx].monthlyAmount = withMinor[highestIdx].minorUnits / factor;
  }

  return withMinor;
}

export function validateCurrencyCode(code: unknown): boolean {
  return validateCurrency(code).valid;
}

export function getCurrencyDecimals(code: string): number {
  return SUPPORTED_CURRENCIES[code.toUpperCase()]?.decimals ?? 2;
}

export function reconcileAllocations<T extends { channel: string; sharePercentage: number; allocatedAmount: number; rationale?: string }>(
  allocations: T[],
  totalBudget: number,
  currencyCode: string
): T[] {
  if (allocations.length === 0) return [];
  const mapped = allocations.map((a) => ({
    ...a,
    channelId: a.channel,
    sharePercentage: a.sharePercentage,
  }));
  const exact = calculateExactAllocations(totalBudget, currencyCode, mapped);

  // Normalize share percentages to sum to 100%
  const totalShare = exact.reduce((s, a) => s + a.sharePercentage, 0);
  const shareDiscrepancy = 100 - totalShare;

  return exact.map((a, idx) => {
    let adjShare = a.sharePercentage;
    if (idx === 0 && Math.abs(shareDiscrepancy) > 0.0001) {
      adjShare = Number((a.sharePercentage + shareDiscrepancy).toFixed(4));
    }
    return {
      ...a,
      allocatedAmount: a.monthlyAmount,
      sharePercentage: adjShare,
    } as unknown as T;
  });
}
