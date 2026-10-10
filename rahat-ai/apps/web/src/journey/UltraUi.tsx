import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Change, HeatClass, JRoute, Metrics } from "./jtypes";
import { HEAT_COLOR } from "./jtypes";
import {
  ArrowIcon, BenchIcon, DropIcon, FlameIcon, LocateIcon, PinIcon, SearchIcon, SnowIcon, SunIcon, TreeIcon,
} from "../overview/icons";

export const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
export const dist = (m: number) => (m >= 1000 ? `${f(m / 1000, 2)} km` : `${f(m, 0)} m`);
export const sign = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${f(Math.abs(v), d)}`;

/* ------------------------------------------------------------------ icons (one family) */
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const mk = (d: ReactNode) => function Icon({ size = 20 }: { size?: number }) {
  return <svg {...base} width={size} height={size}>{d}</svg>;
};
const CheckIcon = mk(<path d="m5 12.5 4.5 4.5L19 7.5" />);
const PlusIcon = mk(<path d="M12 5v14M5 12h14" />);
const CloseIcon = mk(<path d="m6 6 12 12M18 6 6 18" />);
const SwapIcon = mk(<path d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3" />);
const RouteIcon = mk(<><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" /><path d="M8.4 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.6" /></>);
const ShieldIcon = mk(<><path d="M12 3 5 6v6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6l-7-3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>);
const UsersIcon = mk(<><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2A4.6 4.6 0 0 1 20.5 19" /></>);
const BoltIcon = mk(<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />);
const PauseIcon = mk(<path d="M8 5v14M16 5v14" />);
const PlayIcon = mk(<path d="m8 5 11 7-11 7V5Z" />);
const GearIcon = mk(<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M4.2 7.4l2.2 1.3M17.6 15.3l2.2 1.3M4.2 16.6l2.2-1.3M17.6 8.7l2.2-1.3" /></>);
const LayersIcon = mk(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);
const AlertIcon = mk(<><path d="M12 4 3 20h18L12 4Z" /><path d="M12 10v4.5M12 17.2v.1" /></>);
const ClockIcon = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
const FlagIcon = mk(<path d="M5 21V4m0 0h11l-2 4 2 4H5" />);
const UpIcon = mk(<path d="m6 14 6-6 6 6" />);
const DownIcon = mk(<path d="m6 10 6 6 6-6" />);
const EditIcon = mk(<path d="M4 20h4L19 9l-4-4L4 16v4Z" />);
const TrashIcon = mk(<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />);
const EyeIcon = mk(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>);
const SparkIcon = mk(<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />);

export const ICONS = {
  pin: PinIcon, search: SearchIcon, heat: FlameIcon, sun: SunIcon, shade: TreeIcon, water: DropIcon,
  rest: BenchIcon, cooling: SnowIcon, arrow: ArrowIcon, locate: LocateIcon, check: CheckIcon, plus: PlusIcon,
  close: CloseIcon, swap: SwapIcon, route: RouteIcon, shield: ShieldIcon, users: UsersIcon, bolt: BoltIcon,
  pause: PauseIcon, play: PlayIcon, gear: GearIcon, layers: LayersIcon, alert: AlertIcon, clock: ClockIcon,
  flag: FlagIcon, up: UpIcon, down: DownIcon, edit: EditIcon, trash: TrashIcon, eye: EyeIcon, spark: SparkIcon,
};
export type IcoName = keyof typeof ICONS;
export function Ico({ n, size = 20 }: { n: IcoName; size?: number }) {
  const I = ICONS[n];
  return <I size={size} />;
}
const NEED_NAME: Record<string, IcoName> = {
  WATER: "water", SHADE: "shade", REST: "rest", COOLING: "cooling", "PUBLIC FACILITY": "pin",
  EMERGENCY: "alert", HOSPITAL: "shield", FUEL: "bolt", FOOD: "pin", TRANSIT: "route", "ESSENTIAL SERVICES": "pin",
};
export function NeedIco({ k, size = 20 }: { k: string; size?: number }) {
  return <Ico n={NEED_NAME[k] ?? "pin"} size={size} />;
}
export const NEED_COLOR: Record<string, string> = {
  WATER: "#6fd8ff", SHADE: "#7fe3a4", REST: "#c9b2f5", COOLING: "#a8e6ff",
};

/* ------------------------------------------------------------------ badges and basics */
const BADGE: Record<string, string> = {
  "DEMO DATA": "demo", "MODEL ESTIMATE": "model", "SIMULATED JOURNEY": "sim",
  "USER INPUT": "user", "COMMUNITY REPORT": "community", "AI EXPLANATION": "ai",
  "LIVE DATA": "live", "PUBLIC DATA": "public", "PROVIDER DATA": "live",
  "SATELLITE-DERIVED": "public", UNAVAILABLE: "off", UNVERIFIED: "off",
};
export function Badge({ kind }: { kind: string }) {
  return <span className={`badge ${BADGE[kind] ?? "demo"}`}>{kind}</span>;
}
export function HeatChip({ cls }: { cls: HeatClass }) {
  return <span className="heatchip" style={{ background: HEAT_COLOR[cls] }}>{cls}</span>;
}
export function Loading({ text }: { text: string }) {
  return <div className="loading" role="status" aria-live="polite"><i /><i /><i /><span>{text}</span></div>;
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="errorbox" role="alert">
    <strong>Something got in the way.</strong>
    <p>{message}</p>
    {retry && <button onClick={retry}>Try again</button>}
  </div>;
}
export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{text}</p>{children}</div>;
}
export function Card({ title, tag, children, className = "" }: {
  title?: string; tag?: string; children: ReactNode; className?: string;
}) {
  return <section className={`jcard ${className}`}>
    {(title || tag) && <header><h2>{title}</h2>{tag && <Badge kind={tag} />}</header>}
    {children}
  </section>;
}
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="stat"><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
}

/* ------------------------------------------------------------------ RAHAT button system */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "lg" | "xl";
  arrow?: boolean; icon?: IcoName; loading?: boolean; success?: boolean;
};
export function Btn({
  variant = "secondary", size = "md", arrow, icon, loading, success, className = "", children, disabled, type = "button", ...rest
}: BtnProps) {
  return <button {...rest} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
    className={`btn ${variant} ${size} ${loading ? "is-loading" : ""} ${success ? "is-success" : ""} ${className}`.trim()}>
    {loading ? <span className="spin" aria-hidden="true" /> : icon ? <Ico n={icon} size={18} /> : null}
    <span className="btn-label">{children}</span>
    {arrow && !loading && <ArrowIcon size={18} />}
  </button>;
}

/* ------------------------------------------------------------------ page + data visual primitives */
export function PageHero({ eyebrow, title, sub, children, className = "" }: {
  eyebrow: string; title: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string;
}) {
  return <header className={`phero ${className}`}>
    <span className="eyebrow">{eyebrow}</span>
    <h1>{title}</h1>
    {sub && <p className="lead">{sub}</p>}
    {children}
  </header>;
}

export function Metric({ label, value, unit, sub, tone = "", bar, icon }: {
  label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "" | "hot" | "cool" | "amber" | "blue";
  bar?: number; icon?: IcoName;
}) {
  return <div className={`metric ${tone}`}>
    <span className="m-label">{icon && <Ico n={icon} size={14} />}{label}</span>
    <b className="m-value">{value}{unit && <small>{unit}</small>}</b>
    {sub && <span className="m-sub">{sub}</span>}
    {bar !== undefined && <i className="m-bar" aria-hidden="true"><u style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }} /></i>}
  </div>;
}

export function HeatStrip({ route, active, onPick, tall = false }: {
  route: JRoute; active?: number | null; onPick?: (i: number) => void; tall?: boolean;
}) {
  const total = route.segments.reduce((s, e) => s + e.minutes, 0) || 1;
  return <div className={`strip ${tall ? "tall" : ""}`} role="list" aria-label="Journey heat timeline">
    {route.segments.map((s, i) => onPick
      ? <button key={i} role="listitem" className={`strip-seg ${active === i ? "on" : ""}`}
        style={{ flex: s.minutes / total, background: HEAT_COLOR[s.heat_class] }}
        aria-label={`Segment ${i + 1}: ${s.heat_class}`} title={`${s.heat_class} · ${f(s.load)} u`} onClick={() => onPick(i)} />
      : <span key={i} role="listitem" className={`strip-seg ${active === i ? "on" : ""}`}
        style={{ flex: s.minutes / total, background: HEAT_COLOR[s.heat_class] }}
        aria-label={`Segment ${i + 1}: ${s.heat_class}`} />)}
  </div>;
}

/** Smoothly animates a number toward its target; jumps instantly when motion is reduced. */
export function useTween(target: number, ms = 600) {
  const [v, setV] = useState(target);
  useEffect(() => {
    const reduced = typeof window !== "undefined"
      && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        || document.documentElement.dataset.motion === "reduced");
    if (reduced || !Number.isFinite(target)) { setV(target); return; }
    const from = v; const t0 = performance.now(); let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(from + (target - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
export function AnimNum({ value, digits = 1, prefix = "" }: { value: number; digits?: number; prefix?: string }) {
  const v = useTween(value);
  return <>{prefix}{f(v, digits)}</>;
}

/* ------------------------------------------------------------------ accessibility + motion preferences */
export interface Prefs { contrast: boolean; motion: boolean }
const PREF_KEY = "rahat.prefs";
export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) { const p = JSON.parse(raw) as Partial<Prefs>; return { contrast: !!p.contrast, motion: !!p.motion }; }
  } catch { /* storage unavailable: fall back to defaults */ }
  return { contrast: false, motion: false };
}
export function applyPrefs(p: Prefs) {
  document.documentElement.dataset.contrast = p.contrast ? "high" : "normal";
  document.documentElement.dataset.motion = p.motion ? "reduced" : "full";
}
export function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  applyPrefs(p);
}

/* ------------------------------------------------------------------ what changed */
const ROWS: [string, keyof Metrics, string, boolean][] = [
  ["Time", "minutes", " min", false], ["Distance", "distance", " m", false],
  ["Estimated thermal exposure", "load", " u", false], ["Estimated shade", "shade", "", false],
  ["Relief points on route", "relief", "", false],
];
export function WhatChanged({ change, onDismiss }: { change: Change; onDismiss: () => void }) {
  const { before, after } = change;
  const fmtv = (k: keyof Metrics, v: number) =>
    k === "shade" ? `${f(v * 100, 0)}%` : k === "relief" ? String(v) : f(v, k === "distance" ? 0 : 1);
  const better = (k: keyof Metrics, d: number) =>
    d === 0 ? "" : (k === "shade" || k === "relief" ? d > 0 : d < 0) ? "good" : "bad";
  return <div className="whatchanged" role="region" aria-label="What changed">
    <div className="wc-head">
      <span className="eyebrow">ROUTE UPDATED · PROPOSAL</span>
      <h2>WHAT CHANGED?</h2>
      <p>{change.reason}</p>
    </div>
    <div className="wc-grid">
      <div className="wc-col"><span className="eyebrow">BEFORE · CURRENT ROUTE</span></div>
      <div className="wc-col"><span className="eyebrow">NOW · RAHAT ALTERNATIVE</span></div>
      <div className="wc-col diff"><span className="eyebrow">DIFFERENCE</span></div>
      {ROWS.map(([label, key, unit]) => {
        const d = after[key] - before[key];
        return [
          <div key={label + "b"} className="wc-cell"><small>{label}</small>
            <b>{fmtv(key, before[key])}{key === "shade" || key === "relief" ? "" : unit}</b></div>,
          <div key={label + "a"} className="wc-cell now"><small>{label}</small>
            <b>{fmtv(key, after[key])}{key === "shade" || key === "relief" ? "" : unit}</b></div>,
          <div key={label + "d"} className={`wc-cell diff ${better(key, d)}`}>
            <b>{key === "shade" ? `${sign(d * 100, 0)} pts` : sign(d, key === "relief" ? 0 : 1)}</b></div>,
        ];
      })}
    </div>
    <p className="muted">{change.geometryChanged
      ? "The path itself changes. Nothing is applied until you choose."
      : "The path stays the same; only the estimates moved. Nothing is applied until you choose."}
    {" "}<Badge kind="MODEL ESTIMATE" /> <Badge kind="DEMO DATA" /></p>
    <div className="row">
      <Btn variant="primary" size="lg" arrow onClick={() => { change.apply(); onDismiss(); }}>Take the alternative</Btn>
      <Btn onClick={onDismiss}>Keep my current route</Btn>
    </div>
  </div>;
}
