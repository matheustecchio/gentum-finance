const MIN_CENTS = -(1n << 63n);
const MAX_CENTS = (1n << 63n) - 1n;

// Parse decimal input as text: never multiply a JavaScript Number by 100.
export function toCents(amount: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) throw new Error("Use a number with up to two decimal places");
  const [, sign, whole, fraction = ""] = match;
  const cents = BigInt(`${sign}${whole}${fraction.padEnd(2, "0")}`);
  if (cents < MIN_CENTS || cents > MAX_CENTS) throw new Error("Amount exceeds the supported range");
  return cents.toString();
}

export function formatMoney(amount: string, currency: string): string {
  if (!/^(0|-[1-9]\d*|[1-9]\d*)$/.test(amount)) throw new Error("Invalid integer cents");
  const cents = BigInt(amount);
  if (cents < MIN_CENTS || cents > MAX_CENTS) throw new Error("Amount exceeds the supported range");
  return formatAggregateMoney(amount, currency);
}

// Period totals can exceed one stored transaction's int64 range.
export function formatAggregateMoney(amount: string, currency: string): string {
  if (!/^(0|-[1-9]\d*|[1-9]\d*)$/.test(amount)) throw new Error("Invalid integer cents");
  const cents = BigInt(amount);
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const grouped = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
    .formatToParts(whole).filter(({ type }) => type === "integer" || type === "group");
  let inserted = false;
  return formatter.formatToParts(cents < 0n ? -1n : 1n).flatMap((part) => {
    if (part.type === "integer" || part.type === "group") {
      if (inserted) return [];
      inserted = true;
      return grouped;
    }
    if (part.type === "fraction") return [{ ...part, value: fraction }];
    return [part];
  }).map(({ value }) => value).join("");
}
