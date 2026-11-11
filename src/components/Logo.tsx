/* eslint-disable @next/next/no-img-element */
/** Approved logo files only (public/brand/logo). Light and dark artwork switch with the theme; never recoloured in CSS. */
export function Logo({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [light, dark] = compact ? ["spak-symbol.svg", "spak-symbol-dark.svg"] : ["spak-logo-horizontal.svg", "spak-logo-horizontal-dark.svg"];
  return (
    <span className={`inline-flex items-center ${className}`}>
      <img src={`/brand/logo/${light}`} alt="SPak" className="logo-light h-full w-auto" />
      <img src={`/brand/logo/${dark}`} alt="SPak" className="logo-dark h-full w-auto" />
    </span>
  );
}
