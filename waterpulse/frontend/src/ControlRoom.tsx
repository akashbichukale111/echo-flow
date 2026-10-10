import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Badge, Card, DataBadge, EmptyState, FreshBadge, KPI, ScenarioCard,
  StatusBadge, Tooltip, days, number, riskClass
} from "./components";
import type { ActionRecord, Analysis, Cause } from "./types";

const ML = (litres: number) => `${number(litres / 1e6, 2)} ML/day`;

function clockText(a: Analysis) {
  return a.clock.days === null ? "—" :
    `${a.clock.days}D ${String(a.clock.hours).padStart(2, "0")}H`;
}
function windowText(hours: number | null) {
  if (hours === null) return "—";
  return `${Math.floor(hours / 24)}D ${String(Math.floor(hours % 24)).padStart(2, "0")}H`;
}
const labelOf = (a: Analysis, field: string) =>
  a.composition.find(c => c.field === field)?.label;

function EvidenceKpis({ a }: { a: Analysis }) {
  const gw = a.data_context?.groundwater;
  const lead = gw?.stations?.[0];
  const weather = a.environment.weather_detail;
  const demand = a.zone.demand_lpd;
  const scheme = a.data_context?.supply_baseline.linked_scheme;
  return <div className="evidence-kpis">
    <section className="kpi-static" aria-label="Supply">
      <span className="eyebrow">SUPPLY</span>
      <strong>{ML(a.zone.supply_lpd)}</strong>
      <span>vs demand {ML(demand)}</span>
      <DataBadge label={labelOf(a, "supply_lpd")} />
      {scheme && <small>Baseline: {scheme.scheme} — {scheme.utilisation_mld} of{" "}
        {scheme.capacity_mld ?? "n/a"} MLD in use. REAL GOVERNMENT BASELINE,
        not live telemetry.</small>}
    </section>
    <section className="kpi-static" aria-label="Groundwater">
      <span className="eyebrow">GROUNDWATER</span>
      {lead ? <>
        <strong>{number(lead.value, 2)} m</strong>
        <span>{lead.station_name} · {lead.distance_km} km</span>
        <DataBadge label="REAL PUBLIC DATA" /> <FreshBadge freshness={lead.freshness} />
        <small>Observed {new Date(lead.timestamp ?? "").toLocaleString()}.
          Context only; not tank storage.</small>
      </> : a.workspace === "demo" ? <>
        <strong>{String(a.environment.groundwater.value)}</strong>
        <span>Demonstration context</span><DataBadge label="DEMO DATA" />
      </> : <>
        <strong>NO NEARBY STATION</strong>
        <span>{gw?.message ?? "Groundwater telemetry unavailable"}</span>
        <Badge>NOT REPRESENTATIVE</Badge>
      </>}
    </section>
    <section className="kpi-static" aria-label="Weather">
      <span className="eyebrow">WEATHER</span>
      {weather?.status === "OK" ? <>
        <strong>{number(weather.temperature_c ?? 0, 1)} °C</strong>
        <span>{weather.condition} · rain {weather.precip_mm} mm · {weather.humidity_pct}% RH ·
          wind {weather.wind_kph} km/h</span>
        <DataBadge label="REAL PUBLIC DATA" /> <FreshBadge freshness={weather.freshness} />
        <small>3-day forecast rain {weather.forecast_precip_mm} mm. Context only.</small>
      </> : a.environment.weather.source_type === "DEMO DATA" ? <>
        <strong>{String(a.environment.weather.value)} {a.environment.weather.unit}</strong>
        <span>Demonstration weather</span><DataBadge label="DEMO DATA" />
      </> : <>
        <strong>DATA UNAVAILABLE</strong>
        <span>{weather?.message ?? "Set WEATHER_PROVIDER=weatherapi and WEATHER_API_KEY."}</span>
      </>}
    </section>
  </div>;
}

function CauseCard({ cause }: { cause: Cause }) {
  return <li className={`cause ${cause.kind.toLowerCase()}`}>
    <span className="cause-rank">{cause.rank}</span>
    <div>
      <strong>{cause.title}</strong>
      <p>{cause.detail}</p>
      <div className="cause-tags">
        <DataBadge label={cause.label} />
        <Badge>{cause.kind === "DRIVER" ? "CALCULATED DRIVER" : "CONTEXT · NOT PROOF OF CAUSE"}</Badge>
      </div>
    </div>
  </li>;
}

function DidItWork({ actions }: { actions: ActionRecord[] }) {
  const done = [...actions].reverse().find(x => x.verification);
  if (!done || !done.verification) {
    const pending = actions.find(x => x.status === "EXECUTED");
    return <EmptyState>
      {pending ? <>An executed action is awaiting an observation.{" "}
        <Link to="/verification">Enter verification ↗</Link></>
        : <>No action has been verified for this zone yet. After a human approves
          and records execution, enter an observation to compare before and after.{" "}
          <Link to="/action-center">Open Action Center ↗</Link></>}
    </EmptyState>;
  }
  const v = done.verification;
  return <div className="verify-summary">
    <div><span className="eyebrow">BUFFER BEFORE</span><strong>{days(v.before_buffer_days)}</strong></div>
    <div><span className="eyebrow">BUFFER AFTER</span><strong>{days(v.after_buffer_days)}</strong></div>
    <div><span className="eyebrow">CHANGE</span><strong>{v.change_days === null ? "—" :
      `${v.change_days >= 0 ? "+" : ""}${number(v.change_days, 2)} days`}</strong></div>
    <p>{v.summary} <DataBadge label={v.simulated ? "SIMULATED OPERATIONAL DATA" : "OPERATOR INPUT"} />{" "}
      Observed {new Date(v.observed_at).toLocaleString()}. A before/after comparison is not
      proof that the action caused the change. <Link to="/verification">Details ↗</Link></p>
  </div>;
}

export default function ControlRoom({
  analysis: a, zoneStatus, map, recommendation, actions, scenarioChoice, health
}: {
  analysis: Analysis; zoneStatus: ReactNode; map: ReactNode;
  recommendation: ReactNode; actions: ActionRecord[];
  scenarioChoice: (scenarioId: string) => void;
  health: { mode: string; workspace?: string } | null;
}) {
  const demo = (a.workspace ?? health?.workspace ?? health?.mode) === "demo";
  const formulaGross = `${ML(a.zone.demand_lpd)} ÷ (1 − ${a.zone.loss_pct}%) = ${ML(a.model.gross_withdrawal_lpd)}`;
  return <>
    <section className="hero">
      <div>
        <div className="hero-brand"><Badge>WATERPULSE AI</Badge>
          <span>Water Shortage Prevention OS</span></div>
        <h2>Predict the Shortage. Find the Loss.<br />
          <span>Simulate the Fix. Act Before the Tap Runs Dry.</span></h2>
        <ol className="loop" aria-label="Decision loop">
          {["SEE", "UNDERSTAND", "SIMULATE", "DECIDE", "ACT", "VERIFY"].map(s =>
            <li key={s}>{s}</li>)}
        </ol>
        <p className="honesty">
          {demo ? "DEMO workspace: every value is synthetic demonstration data."
            : "PILOT workspace: public datasets supply the baseline and nearby context; operating state that no dataset provides is labelled SIMULATED OPERATIONAL DATA. Municipal live demand and NRW telemetry are not connected."}
        </p>
      </div>
      <div className="hero-status"><StatusBadge level={a.risk.level} />
        <Tooltip label="Heuristic score from buffer, trends, loss, context and criticality. Not scientifically validated.">
          <span>MODEL RISK ESTIMATE ⓘ</span></Tooltip>
      </div>
    </section>

    <div className="kpi-grid">
      <KPI label="WATER BUFFER" value={days(a.model.buffer_days)}
        detail="MODEL ESTIMATE · time to configured reserve" to="/water-buffer" />
      <KPI label="SHORTAGE CLOCK" value={clockText(a)}
        detail={`Action window: ${windowText(a.clock.action_window_hours)} · MODEL ESTIMATE, not a physical countdown`}
        to="/shortage-clock" />
      <KPI label="RISK" value={a.risk.level} to="/diagnosis" tone={riskClass(a.risk.level)}
        detail={`Heuristic score ${a.risk.score}/100`} />
      <KPI label="NRW / LOSS" value={`${a.zone.loss_pct}%`} to="/loss-anomalies"
        detail={`${labelOf(a, "loss_pct") ?? "—"} · ${a.anomalies.length} suspected anomal${a.anomalies.length === 1 ? "y" : "ies"}`} />
    </div>
    <EvidenceKpis a={a} />

    <Card title="Water balance (stated units)" aside={<Badge>MODEL OUTPUT</Badge>}>
      <p className="formula">Storage + Supply − Gross withdrawal = Net drawdown ·
        Gross withdrawal = Demand ÷ (1 − Loss%)</p>
      <p className="formula-live">{formulaGross}; net drawdown {ML(a.model.net_drawdown_lpd)};
        buffer = usable storage above reserve ÷ net drawdown. Constant-input
        assumption; not a hydraulic forecast.</p>
      <ul className="composition" aria-label="Where each model input comes from">
        {a.composition.map(c => <li key={c.field}><span>{c.name}</span>
          <DataBadge label={c.label} /></li>)}
      </ul>
    </Card>

    <div className="control-grid">
      <Card title="Operational map" aside={<Badge>POINTS · NOT ZONE GEOMETRY</Badge>}>{map}</Card>
      <Card title="Zone status">{zoneStatus}
        <div className="note">Status here uses buffer thresholds. The full risk model also
          considers operational context.</div></Card>
    </div>

    <Card title="Why is this happening?" aside={<Badge>EVIDENCE-LINKED</Badge>}>
      <ol className="causes">{a.causes.map(c => <CauseCard key={c.id} cause={c} />)}</ol>
      <p className="note">Drivers come from the deterministic water balance. Context signals
        come from nearby public telemetry and are never presented as proof of cause.{" "}
        <Link to="/diagnosis">Full diagnosis ↗</Link></p>
    </Card>

    <Card title="What can we do?" aside={<Badge>CONDITIONAL MODEL OUTPUTS</Badge>}>
      <div className="scenario-grid">{a.scenarios.map(s =>
        <ScenarioCard key={s.id} scenario={s} selected={s.id === a.recommendation.scenario}
          onChoose={() => scenarioChoice(s.id)} />)}</div>
      <p className="note">Scenario estimates are conditional model outputs under stated
        assumptions. Cost and hydraulic optimisation are not performed.{" "}
        <Link to="/what-if">Open the simulator ↗</Link></p>
    </Card>

    <h2 className="section-title">Recommended action</h2>
    {recommendation}

    <Card title="Did it work?" aside={<Badge>VERIFY</Badge>}>
      <DidItWork actions={actions} />
    </Card>
  </>;
}
