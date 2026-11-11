/** SPak icon set: 24px grid, 1.75px stroke, round caps and joins, no fills (brand guidelines section 6). */
import type { SVGProps } from "react";

const PATHS = {
  success: <path d="M5 12.5l4.2 4.2L19 7" />,
  refunded: <><path d="M9 7L5 11l4 4" /><path d="M5 11h9a5 5 0 0 1 0 10h-2" /></>,
  error: <><circle cx="12" cy="12" r="8" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  warning: <><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  pending: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
  processing: <><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 4.5V8h-3.5" /></>,
  info: <><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8v.1" /></>,
  neutral: <><circle cx="12" cy="12" r="8" /><path d="M8.5 12h7" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>,
  external: <><path d="M14 5h5v5" /><path d="M19 5l-8 8" /><path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />,
  wallet: <><rect x="3.5" y="6.5" width="17" height="12" rx="2" /><path d="M16 12.5h.1M3.5 9.5h17" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...p }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
      {PATHS[name]}
    </svg>
  );
}
