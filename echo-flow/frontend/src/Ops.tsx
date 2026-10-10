import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Prov, StatusPill } from "./Live";
import type { Anchor } from "./geo";
import type { Intervention, LiveContext, MapPhase, PickMode, RouteState, Scenario } from "./types";

export const defaultIntervention: Intervention = {
  pump: 0.6, gate_open: false, road_closed: false, buffer: "B6",
  clear_drain: false, noncritical_shed: 0, priority_power: false
};

const num = (v: unknown, digits = 2) => typeof v === "number" ? v.toFixed(digits) : null;

function Section({ title, children, tag }: { title: string; children: ReactNode; tag?: ReactNode }) {
  return <section className="ops-section"><h3>{title}{tag}</h3>{children}</section>;
}

export interface OpsProps {
  scenario: Scenario;
  selectedId: string | null;
  busy: boolean;
  stale: boolean;
  onSimulate: (i: Intervention) => void;
  onRunDecision: () => void;
  mapPhase: MapPhase;
  anchor: Anchor | null;
  onClearAnchor: () => void;
  route: RouteState;
  pickMode: PickMode;
  onRequestPick: (m: PickMode) => void;
  onCalculateRoute: () => void;
  onClearRoute: () => void;
  liveCtx: LiveContext | null;
  onSelectOption?: (id: string) => void;
}

function EntityDetail({ scenario, id, busy, onSimulate }: { scenario: Scenario; id: string; busy: boolean; onSimulate: (i: Intervention) => void }) {
  const node = scenario.graph.nodes.find(n => n.id === id);
  const r = scenario.run;
  if (!node) return <p className="muted">Entity not found in the current scenario.</p>;
  const base = r?.intervention ?? defaultIntervention;
  const metrics = r?.simulation.metrics;
  const depth = node.id === "A" ? metrics?.zone_a_depth_m : node.id === "B" ? metrics?.zone_b_depth_m : undefined;
  const option = r?.options.find(o => o.id === node.id);
  const heat = scenario.state.mode === "heat";
  return (
    <>
      <div className="entity-head"><strong>{node.id}</strong><span className="badge">{node.kind.toUpperCase()}</span><Prov label="SIMULATED" /></div>
      <dl className="kv">
        <div><dt>Position</dt><dd>synthetic ({node.x}, {node.y}) m from demo anchor — not a surveyed location</dd></div>
        {node.population > 0 && <div><dt>Population</dt><dd>{node.population.toLocaleString()} <small>(synthetic)</small></dd></div>}
        {num(depth) && <div><dt>Water depth</dt><dd>{num(depth)} m <Prov label="DERIVED" /></dd></div>}
        {option && <div><dt>Option check</dt><dd>{option.status} · {option.capacity_m3.toLocaleString()} m³ · {option.exposure}</dd></div>}
      </dl>
      {option && option.checks.some(c => !c.pass) && (
        <ul className="fail-list">{option.checks.filter(c => !c.pass).map(c => <li key={c.name}>FAIL · {c.name}{c.detail ? ` — ${c.detail}` : ""}</li>)}</ul>
      )}
      {!heat && (node.kind === "buffer" && (node.id === "B5" || node.id === "B6")) && (
        <button disabled={busy} onClick={() => onSimulate({ ...base, buffer: node.id as "B5" | "B6" })}>SIMULATE WITH {node.id} BUFFER</button>
      )}
      {node.kind === "pump" && (
        <label className="inline">Pump level
          <select disabled={busy} value={base.pump} onChange={e => onSimulate({ ...base, pump: Number(e.target.value) })}>
            {(heat ? [0, .4, .5, .6, .8, 1] : [0, .4, .6, .8, 1]).map(v => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
          </select>
        </label>
      )}
      {!heat && node.kind === "drain" && (
        <button disabled={busy} onClick={() => onSimulate({ ...base, clear_drain: !base.clear_drain })}>
          {base.clear_drain ? "SIMULATE WITHOUT DRAIN CLEARING" : `SIMULATE CLEARING DRAIN ${node.id}`}</button>
      )}
      {!heat && node.kind === "road" && node.id === "R7" && (
        <button disabled={busy} onClick={() => onSimulate({ ...base, road_closed: !base.road_closed })}>
          {base.road_closed ? "SIMULATE REOPENING R7" : "SIMULATE CLOSING R7"}</button>
      )}
      <p className="muted small-note">Selecting an action re-runs the server-side decision workflow. Nothing is executed; approval stays with the human gate.</p>
    </>
  );
}

function RoutePanel(p: OpsProps) {
  const { route } = p;
  const ready = p.mapPhase === "READY";
  const fmt = (v: [number, number] | null) => v ? `${v[1].toFixed(4)}, ${v[0].toFixed(4)}` : "not set";
  const data = route.result?.status === "LIVE" ? route.result.data as { distance_km: number; duration_min: number; travel_mode: string } : null;
  return (
    <div className="route-tool">
      <dl className="kv">
        <div><dt>Origin (lat, lon)</dt><dd>{fmt(route.origin)}</dd></div>
        <div><dt>Destination</dt><dd>{fmt(route.destination)}</dd></div>
      </dl>
      <div className="btn-row">
        <button className="secondary tiny" disabled={!ready} aria-pressed={p.pickMode === "origin"} onClick={() => p.onRequestPick("origin")}>SET ORIGIN</button>
        <button className="secondary tiny" disabled={!ready} aria-pressed={p.pickMode === "destination"} onClick={() => p.onRequestPick("destination")}>SET DESTINATION</button>
        <button className="tiny" disabled={!route.origin || !route.destination || route.phase === "PENDING"} onClick={p.onCalculateRoute}>
          {route.phase === "PENDING" ? "CALCULATING…" : "CALCULATE ROUTE"}</button>
        {(route.origin || route.destination) && <button className="secondary tiny" onClick={p.onClearRoute}>CLEAR</button>}
      </div>
      {!ready && <p className="muted small-note">Routing points are chosen on the map, which is not available right now.</p>}
      {route.phase === "LIVE" && data && (
        <div className="route-result ok" role="status">
          <b>CALCULATED ROUTE · AMAZON LOCATION</b> <Prov label="DERIVED" />
          <p>{data.distance_km} km · {data.duration_min} min · {data.travel_mode}</p>
          <small>{route.result?.limitations}</small>
        </div>
      )}
      {route.phase === "FAILED" && (
        <div className="route-result fail" role="alert">
          <b>ROUTE NOT CALCULATED</b>{route.result ? ` · ${route.result.status.replace("_", " ")}` : ""}
          <p>{route.message}</p>
        </div>
      )}
    </div>
  );
}

export function OpsPanel(p: OpsProps) {
  const { scenario, stale } = p;
  const r = scenario.run;
  const failing = r?.safety.checks.filter(c => !c.pass) ?? [];
  const metrics = r?.simulation.metrics;
  const depths = [["Zone A", metrics?.zone_a_depth_m], ["Zone B", metrics?.zone_b_depth_m]]
    .filter(([, v]) => typeof v === "number" && (v as number) > 0);

  let next: ReactNode;
  if (!r) next = <><p>No analysis yet. Run the decision engine to compute options, consequences and safety checks.</p>
    <button disabled={p.busy} onClick={p.onRunDecision}>RUN ANALYSIS</button></>;
  else if (stale) next = <><p className="warning">State or knowledge changed since the last run. Re-simulate before any authorization.</p>
    <button disabled={p.busy} onClick={p.onRunDecision}>RE-SIMULATE</button></>;
  else if (r.executed) next = <><p>Simulated action recorded. Observe again.</p><button disabled={p.busy} onClick={p.onRunDecision}>RE-SIMULATE NEW STATE</button></>;
  else if (r.rejected) next = <p>Plan rejected by the human commander. Modify the intervention or re-run.</p>;
  else if (!r.safety.allowed) next = <><p className="warning">Blocked by the safety gate ({failing.length} failing check{failing.length === 1 ? "" : "s"}).</p>
    <Link className="linkbtn" to="/echo-flow/safety">REVIEW SAFETY GATE →</Link></>;
  else next = <><p>Safety gate passed for the <em>modeled</em> constraints. A human must authorize the simulated action.</p>
    <Link className="linkbtn" to="/echo-flow/human">HUMAN DECISION →</Link></>;

  const providers = p.liveCtx ? Object.entries(p.liveCtx.providers) : [];
  return (
    <div className="ops">
      <Section title="Next decision">{next}</Section>
      <Section title={p.selectedId ? `Selected · ${p.selectedId}` : "Selected entity"}>
        {p.selectedId ? <EntityDetail scenario={scenario} id={p.selectedId} busy={p.busy} onSimulate={p.onSimulate} />
          : <p className="muted">Select a pin on the map to inspect it and propose an intervention.</p>}
      </Section>
      <Section title="Active risks" tag={<Prov label="DERIVED" />}>
        {!r ? <p className="muted">Computed after a decision run.</p> : (
          <ul className="risk-list">
            {depths.map(([n, v]) => <li key={String(n)}>{String(n)} simulated depth {(v as number).toFixed(2)} m</li>)}
            {r.no_feasible_buffer && <li>No feasible low-harm buffer found</li>}
            {!scenario.unknown.verified && <li>Unverified: {scenario.unknown.name} [{scenario.unknown.low.toFixed(2)}, {scenario.unknown.high.toFixed(2)}]</li>}
            {failing.map(c => <li key={c.name} className="bad">Safety: {c.name}</li>)}
            {!depths.length && !r.no_feasible_buffer && scenario.unknown.verified && !failing.length && <li className="muted">No modeled risk flags</li>}
          </ul>
        )}
      </Section>
      <Section title="Recommended options" tag={r ? <Prov label="DERIVED" /> : undefined}>
        {!r ? <p className="muted">No options computed yet.</p> : <>
          <p className="selected-plan">{r.selected_plan}</p>
          <ul className="option-list">{r.options.map(o => (
            <li key={o.id}><button className="linklike" onClick={() => p.onSelectOption?.(o.id)}>{o.id}</button>
              <span className={`badge ${o.status === "FAIL" ? "danger" : ""}`}>{o.status}</span>
              <small>{o.distance_m.toFixed(0)} m</small></li>))}
          </ul>
        </>}
      </Section>
      <Section title="Evidence status">
        {providers.length ? (
          <ul className="evidence-list">{providers.map(([k, v]) => (
            <li key={k}><span>{k.replaceAll("_", " ")}</span><StatusPill status={v.status} /></li>))}
          </ul>
        ) : <p className="muted">No live evidence fetched this session. <Link to="/echo-flow/live">Open Live Evidence →</Link></p>}
        {p.liveCtx && <small className="muted">Fetched {new Date(p.liveCtx.fetched_at).toLocaleString()}</small>}
      </Section>
      <Section title="Routing">
        <RoutePanel {...p} />
      </Section>
      {p.anchor && (
        <p className="muted small-note">Demo anchor {p.anchor.lat.toFixed(4)}, {p.anchor.lon.toFixed(4)} — visualisation only.{" "}
          <button className="linklike" onClick={p.onClearAnchor}>Remove from map</button></p>
      )}
    </div>
  );
}

export function CompareStrip({ scenario, clock }: { scenario: Scenario; clock: ReactNode }) {
  const r = scenario.run;
  if (!r) {
    return <div className="compare-empty"><p className="muted">Decision comparison appears here after the first run.</p>{clock}</div>;
  }
  const changes = Object.keys(r.simulation.before)
    .filter(k => typeof r.simulation.before[k] === "number" && typeof r.simulation.after[k] === "number"
      && Math.abs((r.simulation.after[k] as number) - (r.simulation.before[k] as number)) > 1e-9).slice(0, 4);
  return (
    <div className="compare">
      <div className="table-scroll">
        <table className="compact">
          <caption className="sr-only">Plan comparison</caption>
          <thead><tr><th>Plan</th><th>Constraints</th><th>Zone A depth</th><th>Affected</th><th>Stress cases</th></tr></thead>
          <tbody>{Object.entries(r.plans).map(([name, plan]) => {
            const m = plan.metrics;
            return <tr key={name} className={name === r.selected_plan ? "chosen" : ""}>
              <th>{name}{name === r.selected_plan ? " ★" : ""}</th>
              <td>{plan.accepted ? "MET" : "VIOLATED"}</td>
              <td>{num(m.zone_a_depth_m) ?? "—"}{num(m.zone_a_depth_m) ? " m" : ""}</td>
              <td>{typeof m.affected_population === "number" ? m.affected_population.toLocaleString() : "—"}</td>
              <td>{r.robustness[name]?.acceptable}/{r.robustness[name]?.total}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="before-after">
        <span className="eyebrow">BEFORE → AFTER · SELECTED PLAN <Prov label="DERIVED" /></span>
        <ul>{changes.length ? changes.map(k => (
          <li key={k}><small>{k.replaceAll("_", " ")}</small>
            <b>{Number(r.simulation.before[k]).toLocaleString(undefined, { maximumFractionDigits: 1 })} → {Number(r.simulation.after[k]).toLocaleString(undefined, { maximumFractionDigits: 1 })}</b></li>
        )) : <li className="muted">No state change in this plan</li>}</ul>
      </div>
      {clock}
    </div>
  );
}
