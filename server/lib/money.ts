import Decimal from "decimal.js";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

function sanitizeNumericString(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, "");
  const cleaned = trimmed.replace(/[^\d,.\-]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      return cleaned.replace(/\./g, "").replace(",", ".");
    }
    return cleaned.replace(/,/g, "");
  }

  if (lastComma >= 0) {
    const fractionalLength = cleaned.length - lastComma - 1;
    return fractionalLength > 0 && fractionalLength <= 6
      ? cleaned.replace(",", ".")
      : cleaned.replace(/,/g, "");
  }

  return cleaned;
}

export function normalizeCurrencyCode(currency: string | null | undefined, fallback = "USD"): string {
  const normalized = String(currency || "").trim().toUpperCase();
  return normalized || fallback.toUpperCase();
}

export function getCurrencyMinorUnitExponent(currency: string | null | undefined): number {
  const normalized = normalizeCurrencyCode(currency);
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return 2;
}

export function parseMoneyDecimal(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid monetary amount");
    }
    return new Decimal(value);
  }

  const sanitized = sanitizeNumericString(String(value));
  if (!sanitized || sanitized === "-" || sanitized === "." || sanitized === "-.") {
    throw new Error("Invalid monetary amount");
  }

  return new Decimal(sanitized);
}

export function decimalFromMinorUnits(
  amountMinor: number,
  currency: string | null | undefined,
): Decimal {
  const exponent = getCurrencyMinorUnitExponent(currency);
  return new Decimal(amountMinor).div(new Decimal(10).pow(exponent));
}

export function toMinorUnits(
  amount: string | number | Decimal,
  currency: string | null | undefined,
): number {
  const exponent = getCurrencyMinorUnitExponent(currency);
  const minor = parseMoneyDecimal(amount)
    .mul(new Decimal(10).pow(exponent))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  if (!minor.isInteger() || !minor.isFinite()) {
    throw new Error("Invalid monetary minor unit conversion");
  }

  const asNumber = minor.toNumber();
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Monetary amount exceeds safe integer range");
  }

  return asNumber;
}

export function formatStoredAmount(
  amount: string | number | Decimal,
  currency: string | null | undefined,
): string {
  const exponent = getCurrencyMinorUnitExponent(currency);
  return parseMoneyDecimal(amount).toDecimalPlaces(exponent, Decimal.ROUND_HALF_UP).toFixed(exponent);
}

export function formatAmountValue(amount: string | number | Decimal): string {
  return parseMoneyDecimal(amount).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

export function normalizeStoredMoneyFields<T extends {
  amount?: string | number | null;
  amountValue?: string | number | null;
  amountMinor?: number | null;
  currency?: string | null;
}>(input: T): T {
  const currency = normalizeCurrencyCode(input.currency);

  let amountDecimal: Decimal | null = null;
  if (input.amount !== undefined && input.amount !== null && input.amount !== "") {
    amountDecimal = parseMoneyDecimal(input.amount);
  } else if (input.amountValue !== undefined && input.amountValue !== null && input.amountValue !== "") {
    amountDecimal = parseMoneyDecimal(input.amountValue);
  } else if (typeof input.amountMinor === "number" && Number.isFinite(input.amountMinor)) {
    amountDecimal = decimalFromMinorUnits(input.amountMinor, currency);
  }

  if (!amountDecimal) {
    return {
      ...input,
      currency,
    };
  }

  return {
    ...input,
    currency,
    amount: formatStoredAmount(amountDecimal, currency),
    amountValue: formatAmountValue(amountDecimal),
    amountMinor: toMinorUnits(amountDecimal, currency),
  };
}

export function decimalToNumber(amount: string | number | Decimal): number {
  return parseMoneyDecimal(amount).toNumber();
}

export function sumMoneyValues(values: Array<string | number | Decimal>): Decimal {
  return values.reduce((acc, value) => acc.plus(parseMoneyDecimal(value)), new Decimal(0));
}
