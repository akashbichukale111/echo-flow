import type { ReactNode } from "react";
import type { ReliefKind } from "./overviewData";

const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const make = (d: ReactNode) => function Icon({ size = 20 }: { size?: number }) {
  return <svg {...base} width={size} height={size}>{d}</svg>;
};
export const TreeIcon = make(<><path d="M12 21v-6" /><path d="M12 15c-4 0-6.5-2.4-6.5-5.6A6.5 6.5 0 0 1 12 3a6.5 6.5 0 0 1 6.5 6.4C18.5 12.6 16 15 12 15Z" /></>);
export const DropIcon = make(<path d="M12 3s6 6.2 6 10.6A6 6 0 0 1 6 13.6C6 9.2 12 3 12 3Z" />);
export const BenchIcon = make(<><path d="M4 11h16" /><path d="M5 11V7h14v4" /><path d="M6 11v7M18 11v7M4 15h16" /></>);
export const SnowIcon = make(<><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" /><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2" /></>);
export const SunIcon = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></>);
export const PinIcon = make(<><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>);
export const ArrowIcon = make(<path d="M5 12h14m-5-6 6 6-6 6" />);
export const LocateIcon = make(<><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>);
export const SearchIcon = make(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const FlameIcon = make(<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.2.8 1.9 1.6 2.2C10.2 8 10.6 5.4 12 3Z" />);

export const RELIEF_ICON: Record<ReliefKind, (p: { size?: number }) => JSX.Element> = {
  SHADE: TreeIcon, WATER: DropIcon, REST: BenchIcon, COOLING: SnowIcon,
};
