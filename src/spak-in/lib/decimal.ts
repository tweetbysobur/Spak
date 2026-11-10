/**
 * Fixed-point decimal math on bigint. No floating point anywhere in financial paths.
 * Values are plain decimal strings ("50", "0.25").
 */
const RE = /^(\d+)(?:\.(\d+))?$/;

export function isDecimal(s: string): boolean {
  return RE.test(s);
}

interface Fixed { n: bigint; scale: number }

function parse(s: string): Fixed {
  const m = RE.exec(s);
  if (!m) throw new Error(`Not a decimal string: ${s}`);
  const frac = m[2] ?? "";
  return { n: BigInt(m[1] + frac), scale: frac.length };
}

function align(a: Fixed, b: Fixed): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.n * 10n ** BigInt(scale - a.scale), b.n * 10n ** BigInt(scale - b.scale), scale];
}

function format(n: bigint, scale: number): string {
  const s = n.toString().padStart(scale + 1, "0");
  const whole = s.slice(0, s.length - scale) || "0";
  const frac = scale ? s.slice(s.length - scale).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}

/** Canonical form: no leading zeros, no trailing fractional zeros. */
export function normalizeDecimal(s: string): string {
  const f = parse(s);
  return format(f.n, f.scale);
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = align(parse(a), parse(b));
  return x < y ? -1 : x > y ? 1 : 0;
}

export function addDecimal(a: string, b: string): string {
  const [x, y, scale] = align(parse(a), parse(b));
  return format(x + y, scale);
}

export function mulDecimal(a: string, b: string): string {
  const x = parse(a), y = parse(b);
  return format(x.n * y.n, x.scale + y.scale);
}

export function isZero(a: string): boolean {
  return parse(a).n === 0n;
}

export function fractionDigits(a: string): number {
  return normalizeDecimal(a).split(".")[1]?.length ?? 0;
}

/** Decimal string to integer string in the asset's smallest unit. Throws on excess precision. */
export function toBaseUnits(amount: string, decimals: number): string {
  const f = parse(amount);
  if (fractionDigits(amount) > decimals) throw new Error(`More than ${decimals} decimal places.`);
  return (f.n * 10n ** BigInt(decimals - f.scale)).toString();
}

export function fromBaseUnits(units: string, decimals: number): string {
  if (!/^\d+$/.test(units)) throw new Error(`Not an integer string: ${units}`);
  return format(BigInt(units), decimals);
}
