import type { ReactNode } from "react";
import type { Change, HeatClass, Metrics } from "./jtypes";
import { HEAT_COLOR } from "./jtypes";

export const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
export const dist = (m: number) => (m >= 1000 ? `${f(m / 1000, 2)} km` : `${f(m, 0)} m`);
export const sign = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${f(Math.abs(v), d)}`;

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
          <div key={label + "a"} className="wc-cell"><small>{label}</small>
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
      <button className="primary" onClick={() => { change.apply(); onDismiss(); }}>Take the alternative</button>
      <button onClick={onDismiss}>Keep my current route</button>
    </div>
  </div>;
}
