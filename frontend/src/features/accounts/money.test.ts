import { formatMoney, toCents } from "./money";

describe("integer cents", () => {
  it.each([
    ["1", "100"], ["10.50", "1050"], ["0.29", "29"], ["-0.01", "-1"],
    ["-0.00", "0"], [" 001.2 ", "120"],
    ["92233720368547758.07", "9223372036854775807"],
    ["-92233720368547758.08", "-9223372036854775808"],
  ])("converts %s exactly to %s", (amount, expected) => {
    expect(toCents(amount)).toBe(expected);
  });
  it.each(["1.001", "1e3", "NaN", "", "1,20", "92233720368547758.08", "-92233720368547758.09"])("rejects %s", (value) => {
    expect(() => toCents(value)).toThrow();
  });
  it.each(["9223372036854775807", "-9223372036854775808", "-1", "0", "29"])("formats %s without precision loss", (value) => {
    expect(formatMoney(value, "EUR").replace(/\D/g, "")).toBe(BigInt(value) < 100n && BigInt(value) > -100n
      ? `0${(BigInt(value) < 0n ? -BigInt(value) : BigInt(value)).toString().padStart(2, "0")}`
      : value.replace("-", ""));
    expect(formatMoney(value, "EUR").includes("-")).toBe(BigInt(value) < 0n);
  });
});
