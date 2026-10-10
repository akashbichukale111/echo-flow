import {
  useEffect, useId, useRef, type ReactNode,
  type ButtonHTMLAttributes
} from "react";
import { Link } from "react-router-dom";
import type { Point, Scenario, Evidence } from "./types";

export const number = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });
export const days = (n: number | null) =>
  n === null ? "No depletion*" : `${number(n, 2)} days`;
export const riskClass = (level: string) =>
  level === "CRITICAL" ? "critical" :
  level === "SHORTAGE APPROACHING" ? "high" :
  level === "WATCH" ? "watch" : "stable";

export function Button({
  children, className = "", ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}
export function Card({
  title, children, className = "", aside
}: { title?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return <section className={`card ${className}`}>
    {(title || aside) && <header className="card-head">
      {title && <h2>{title}</h2>}{aside}
    </header>}
    {children}
  </section>;
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
const SOURCE_CLASS: Record<string, string> = {
  "PUBLIC DATA": "src-public", "OPERATOR INPUT": "src-operator",
  "DEMO DATA": "src-demo", "MODEL OUTPUT": "src-model",
  "AI RECOMMENDATION": "src-ai"
};
export function SourceBadge({ type }: { type: string }) {
  return <span className={`badge source ${SOURCE_CLASS[type] ?? ""}`}
    title={`Data class: ${type}`}>{type}</span>;
}
const LABEL_CLASS: Record<string, string> = {
  "REAL PUBLIC DATA": "lab-public", "PUBLIC DATA": "lab-public",
  "REAL GOVERNMENT BASELINE": "lab-baseline",
  "DERIVED MODEL INPUT": "lab-derived", "DERIVED MODEL": "lab-derived",
  "SIMULATED OPERATIONAL DATA": "lab-simulated", "SIMULATED": "lab-simulated",
  "MODEL OUTPUT": "lab-model", "OPERATOR INPUT": "lab-operator",
  "DEMO DATA": "lab-demo", "AI RECOMMENDATION": "lab-ai"
};
const LABEL_ICON: Record<string, string> = {
  "lab-public": "🟢", "lab-baseline": "🔵", "lab-derived": "🟡",
  "lab-simulated": "🟠", "lab-model": "🟣", "lab-operator": "⚪",
  "lab-demo": "⚫", "lab-ai": "🟣"
};
/** Honesty tier. Colour is never the only cue: icon and full text are shown. */
export function DataBadge({ label }: { label?: string | null }) {
  if (!label) return null;
  const cls = LABEL_CLASS[label] ?? "lab-demo";
  return <span className={`badge data-label ${cls}`}
    title={`Data class: ${label}`}>
    <span aria-hidden="true">{LABEL_ICON[cls]}</span> {label}</span>;
}
export function FreshBadge({ freshness }: {
  freshness?: { status: string; age_label: string } | null
}) {
  if (!freshness) return null;
  const cls = freshness.status === "CURRENT" ? "fresh-ok" :
    freshness.status === "STALE" ? "fresh-stale" : "fresh-unknown";
  const text = freshness.status === "STALE" ? "STALE DATA" :
    freshness.status === "UNKNOWN" ? "BASELINE · NO DATE" : freshness.status;
  return <span className={`badge ${cls}`}>{text} · {freshness.age_label}</span>;
}
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <span className="tooltip" tabIndex={0} aria-describedby={id}>
    {children}<span role="tooltip" id={id} className="tooltip-text">{label}</span>
  </span>;
}
export function Drawer({
  title, children, onClose
}: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="drawer" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="card-head"><h2 id={id}>{title}</h2>
      <Button onClick={onClose} aria-label="Close panel">×</Button></header>
    {children}
  </dialog>;
}
export function ApprovalPanel({
  status, onAction
}: { status: string; onAction: (operation: string) => void }) {
  return <div className="button-row" role="group" aria-label="Human approval">
    {status === "DRAFT" && <>
      <Button className="primary" onClick={() => onAction("approve")}>Approve</Button>
      <Button onClick={() => onAction("modify")}>Modify</Button>
      <Button onClick={() => onAction("reject")}>Reject</Button>
    </>}
    {status === "APPROVED" && <Button className="primary"
      onClick={() => onAction("execution")}>Record execution</Button>}
    {(status === "EXECUTED" || status === "VERIFIED") &&
      <Link to="/verification">Open verification ↗</Link>}
  </div>;
}
export function StatusBadge({ level }: { level: string }) {
  return <span className={`status ${riskClass(level)}`}>{level}</span>;
}
export function KPI({
  label, value, detail, to, tone = ""
}: { label: string; value: string; detail: string; to: string; tone?: string }) {
  return <Link to={to} className={`kpi ${tone}`}>
    <span className="eyebrow">{label}<span aria-hidden="true"> ↗</span></span>
    <strong>{value}</strong>
    <span>{detail}</span>
  </Link>;
}
export function Table({
  headers, rows
}: { headers: string[]; rows: ReactNode[][] }) {
  return <div className="table-scroll"><table>
    <thead><tr>{headers.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>
      {row.map((cell, j) => <td key={j}>{cell}</td>)}
    </tr>)}</tbody>
  </table></div>;
}
export function TextRows({ items }: { items: string[] }) {
  return <Table headers={["Detail"]} rows={items.map(item => [item])} />;
}
export function Chart({
  series, reserve = 0, label = "Projected gross storage"
}: {
  series: { name: string; points: Point[]; color: string }[];
  reserve?: number; label?: string
}) {
  const points = series.flatMap(s => s.points);
  const maxX = Math.max(1, ...points.map(p => p.day));
  const maxY = Math.max(1, reserve, ...points.map(p => p.storage_l));
  const x = (day: number) => 55 + day / maxX * 700;
  const y = (liters: number) => 220 - liters / maxY * 175;
  return <figure className="chart">
    <figcaption>{label} · MODEL OUTPUT</figcaption>
    <svg viewBox="0 0 800 260" role="img" aria-label={label}>
      {[0, .25, .5, .75, 1].map(t => <g key={t}>
        <line x1="55" x2="755" y1={y(t * maxY)} y2={y(t * maxY)}
          stroke="currentColor" opacity=".12" />
        <text x="2" y={y(t * maxY) + 4}>{number(t * maxY / 1e6, 2)}M</text>
      </g>)}
      <line x1="55" x2="755" y1={y(reserve)} y2={y(reserve)}
        stroke="#f9bc60" strokeDasharray="6 6" />
      {series.map(s => <polyline key={s.name} fill="none" stroke={s.color}
        strokeWidth="3"
        points={s.points.map(p => `${x(p.day)},${y(p.storage_l)}`).join(" ")} />)}
      <text x="55" y="247">Now</text>
      <text x="700" y="247">Day {number(maxX)}</text>
    </svg>
    <div className="legend">{series.map(s =>
      <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
    )}<span>Dashed: reserve threshold</span></div>
    <details><summary>Accessible chart data</summary>
      <Table headers={["Series", "Day", "Storage (L)"]}
        rows={series.flatMap(s => s.points.map(p =>
          [s.name, number(p.day, 2), number(p.storage_l)]))} />
    </details>
  </figure>;
}
export function ScenarioCard({
  scenario, selected, onChoose
}: { scenario: Scenario; selected: boolean; onChoose: () => void }) {
  return <button className={`scenario card ${selected ? "selected" : ""}`}
    onClick={onChoose} aria-pressed={selected}>
    <span className="eyebrow">{scenario.name}</span>
    <strong>{days(scenario.buffer_days)}</strong>
    <span>{scenario.impact_days === null ? "Conditional steady-state estimate"
      : `${scenario.impact_days >= 0 ? "+" : ""}${number(scenario.impact_days, 2)} days vs no action`}</span>
    <span>{scenario.feasible ? "Model constraints passed" : "Constraint blocked"}</span>
    <small>{scenario.resources}</small>
    <Badge>MODEL OUTPUT · {scenario.confidence} CONFIDENCE</Badge>
  </button>;
}
export function EvidenceCard({ record }: { record: Evidence }) {
  return <Card title={record.source} aside={<SourceBadge type={record.source_type} />}>
    <strong className="evidence-value">{String(record.value)} {record.unit}</strong>
    <p>{record.influence}</p>
    <small>{record.location} · {record.confidence} confidence · {
      new Date(record.timestamp).toLocaleString()
    }</small>
  </Card>;
}
export function Timeline({
  events
}: { events: { timestamp: string; event: string; note: string }[] }) {
  return <ol className="timeline">{events.map((event, index) =>
    <li key={index}><strong>{event.event}</strong><p>{event.note}</p>
      <time dateTime={event.timestamp}>
        {new Date(event.timestamp).toLocaleString()}
      </time>
    </li>)}</ol>;
}
export function Modal({
  title, children, onClose
}: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="card-head"><h2 id={id}>{title}</h2>
      <Button onClick={onClose} aria-label="Close dialog">×</Button></header>
    {children}
  </dialog>;
}
export function Tabs({
  values, selected, onChange
}: { values: string[]; selected: string; onChange: (s: string) => void }) {
  return <div className="tabs" aria-label="View selection">
    {values.map(value => <Button key={value}
      aria-pressed={value === selected}
      className={value === selected ? "primary" : ""}
      onClick={() => onChange(value)}>{value}</Button>)}
  </div>;
}
export function LoadingState() {
  return <div className="skeleton" role="status">Loading operational context…</div>;
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function ErrorState({
  message, retry
}: { message: string; retry: () => void }) {
  return <div className="error" role="alert"><p>{message}</p>
    <Button onClick={retry}>Retry</Button></div>;
}
