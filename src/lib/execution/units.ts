/** Decimal string to smallest-unit integer string. No floats. Throws on too many decimals. */
export function toBaseUnits(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`Invalid amount: ${amount}`);
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) throw new Error(`Amount has more than ${decimals} decimal places.`);
  const s = (whole + frac.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return s;
}

export function fromBaseUnits(units: string, decimals: number): string {
  const s = units.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
