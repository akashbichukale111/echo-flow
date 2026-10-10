import {
  lazy, Suspense, useCallback, useEffect, useRef, useState,
  type FormEvent
} from "react";
import {
  Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate
} from "react-router-dom";
import ControlRoom from "./ControlRoom";
import { useDataSummary, useFetch, useRoute } from "./publicData";
import {
  ApprovalPanel, Badge, Button, Card, Chart, DataBadge, Drawer, FreshBadge,
  SourceBadge, EmptyState, ErrorState, EvidenceCard,
  KPI, LoadingState, Modal, ScenarioCard, StatusBadge,
  Table, Tabs, TextRows, Timeline, days, number, riskClass
} from "./components";
import { api } from "./api";
import {
  DEFAULT_PARAMETERS, type ActionRecord, type Analysis, type Health,
  type Scenario, type ScenarioParameters, type TankerResult,
  type PublicObservation, type MidcScheme,
  type Zone, type ZoneInput
} from "./types";

const OperationalMap = lazy(() => import("./OperationalMap"));
const NAV = [
  ["/control-room", "Control Room", "01"],
  ["/water-buffer", "Water Buffer", "02"],
  ["/shortage-clock", "Shortage Clock", "03"],
  ["/diagnosis", "Why / Diagnosis", "04"],
  ["/loss-anomalies", "Loss Anomalies", "05"],
  ["/what-if", "What-If Simulator", "06"],
  ["/tanker-intelligence", "Tanker Intelligence", "07"],
  ["/zone-map", "Zone Map", "08"],
  ["/action-center", "Action Center", "09"],
  ["/verification", "Verification", "10"],
  ["/evidence", "Evidence", "11"],
  ["/zone-configuration", "Zone Configuration", "12"],
  ["/settings", "Settings", "13"]
];
const COLORS = ["#8d9eaa", "#5ccae5", "#72ddb2", "#bd9deb"];

export default function App() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [selected, setSelected] = useState(
    localStorage.getItem("waterpulse-zone") || "ward-12"
  );
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [inspect, setInspect] = useState<number | null>(null);
  const [theme, setTheme] = useState(
    localStorage.getItem("waterpulse-theme") || "dark"
  );
  const [workspace, setWorkspace] = useState(
    localStorage.getItem("waterpulse-workspace") || ""
  );
  const location = useLocation();
  const navigate = useNavigate();

const selectZone = useCallback((id: string) => {
    localStorage.setItem("waterpulse-zone", id);
    setSelected(id);
  }, []);
  const reload = useCallback(() => setRefresh(v => v + 1), []);
  const switchWorkspace = useCallback((next: string) => {
    localStorage.setItem("waterpulse-workspace", next);
    localStorage.removeItem("waterpulse-zone");
    setWorkspace(next); setSelected(""); setAnalysis(null);
  }, []);
  const notify = useCallback((message: string) => setNotice(message), []);

useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("waterpulse-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => { setMobileNav(false); }, [location.pathname]);

useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      api<Zone[]>("/zones", "GET", undefined, controller.signal),
      api<ActionRecord[]>("/actions", "GET", undefined, controller.signal),
      api<Health>("/health", "GET", undefined, controller.signal)
    ]).then(async ([allZones, allActions, system]) => {
      if (controller.signal.aborted) return;
      setZones(allZones); setActions(allActions); setHealth(system);
      const id = allZones.some(z => z.id === selected)
        ? selected : allZones[0]?.id;
      if (!id) throw new Error("No zones are configured");
      if (!localStorage.getItem("waterpulse-workspace") && system.workspace) {
        localStorage.setItem("waterpulse-workspace", system.workspace);
      }
      if (id !== selected) { selectZone(id); return; }
      const result = await api<Analysis>(
        `/zones/${id}/analysis`, "GET", undefined, controller.signal
      );
      if (!controller.signal.aborted) setAnalysis(result);
    }).catch(e => {
      if (!controller.signal.aborted) {
        setAnalysis(null);
        setError(e instanceof Error ? e.message : "Could not load operations");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [selected, refresh, selectZone, workspace]);

const title = NAV.find(item => item[0] === location.pathname)?.[1]
    || "Page not found";
  const map = <Suspense fallback={<LoadingState />}>
    <OperationalMap zones={zones} selected={selected}
      onSelect={selectZone} />
  </Suspense>;
  const zoneActions = actions.filter(a => a.zone_id === selected);

async function draft(scenario: string, parameters = DEFAULT_PARAMETERS) {
    try {
      await api(`/zones/${selected}/actions`, "POST", {
        scenario, parameters, note: "Created from operator scenario review"
      });
      notify("Draft created. No action has been approved or dispatched.");
      reload(); navigate("/action-center");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not create draft");
    }
  }

return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <Link className="brand" to="/control-room">
        <span className="brand-mark">W</span>
        <span>WATERPULSE <em>AI</em><small>WATER OPERATIONS INTELLIGENCE</small></span>
      </Link>
      <div className="sidebar-label">OPERATIONS WORKSPACE</div>
      <nav aria-label="Main navigation">{NAV.map(([path, name, index]) =>
        <NavLink key={path} to={path}>
          <span className="nav-index">{index}</span>{name}
        </NavLink>
      )}</nav>
      <div className="sidebar-bottom">
        <span className="signal-dot" /> HUMAN-IN-THE-LOOP
        <p>Decision support.<br />Never autonomous infrastructure control.</p>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <Button className="mobile-menu" aria-label="Toggle navigation"
          aria-expanded={mobileNav} onClick={() => setMobileNav(v => !v)}>☰</Button>
        <div className="breadcrumb">OPERATIONS <span>/</span> {title}</div>
        <label className="location-select">
          <span className="sr-only">Selected zone</span>
          <select value={selected} onChange={e => selectZone(e.target.value)}>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
        <label className="location-select workspace-select">
          <span className="sr-only">Data workspace</span>
          <select value={health?.workspace ?? workspace}
            onChange={e => switchWorkspace(e.target.value)}>
            <option value="pilot">PILOT · public datasets</option>
            <option value="demo">DEMO · offline seed data</option>
          </select>
        </label>
        <Badge>{(health?.workspace ?? health?.mode) === "demo"
          ? "DEMO MODE" : "PILOT MODE"}</Badge>
        <Link className="profile" to="/settings" aria-label="Operator settings">OP</Link>
      </header>
      <main id="main-content">
        <div className="page-heading">
          <div><div className="eyebrow">SEE → UNDERSTAND → SIMULATE → DECIDE → ACT → VERIFY</div>
            <h1>{title}</h1></div>
          <div className="system-caption">
            <span className="signal-dot" />{health ? "API available" : "Connecting"}
            <small>{analysis
              ? `Calculated ${new Date(analysis.calculated_at).toLocaleTimeString()}`
              : "No calculation loaded"}</small>
          </div>
        </div>
        {error && <ErrorState message={error} retry={reload} />}
        {loading && <LoadingState />}
        {!loading && <Routes>
          <Route path="/" element={<Navigate to="/control-room" replace />} />
          <Route path="/settings" element={<Settings
            theme={theme} setTheme={setTheme}
            health={health} reload={reload} notify={notify} />} />
          <Route path="/zone-configuration" element={<ZoneConfiguration
            key={selected} zone={zones.find(z => z.id === selected)}
            saved={id => { selectZone(id); reload(); }}
            notify={notify} />} />
          {analysis && <>
            <Route path="/control-room" element={<ControlRoom
              analysis={analysis} health={health} map={map}
              actions={zoneActions}
              scenarioChoice={() => navigate("/what-if")}
              zoneStatus={<ZoneStatus zones={zones} selected={selected}
                select={selectZone} />}
              recommendation={<Recommendation analysis={analysis}
                draft={() => void draft(analysis.recommendation.scenario)} />} />} />
            <Route path="/water-buffer" element={<WaterBuffer analysis={analysis} />} />
            <Route path="/shortage-clock" element={<ShortageClock analysis={analysis} />} />
            <Route path="/diagnosis" element={<Diagnosis analysis={analysis} notify={notify} />} />
            <Route path="/loss-anomalies" element={<>
              {map}
              <div className="section-gap">
                {analysis.anomalies.length === 0
                  ? <EmptyState>No suspected anomaly has been entered for this zone.
                      This does not prove the absence of leakage.</EmptyState>
                  : analysis.anomalies.map(anomaly =>
                    <Card key={anomaly.id} title={anomaly.title}
                      aside={<Badge>{anomaly.source_type}</Badge>}>
                      <p>{anomaly.location} · {anomaly.confidence} confidence</p>
                      <TextRows items={anomaly.supporting_signals} />
                      <p>{anomaly.recommended_verification}</p>
                      <small>{new Date(anomaly.timestamp).toLocaleString()}</small>
                    </Card>)}
              </div>
            </>} />
            <Route path="/what-if" element={<Simulator
              key={selected} analysis={analysis} zones={zones}
              onDraft={draft} notify={notify} />} />
            <Route path="/tanker-intelligence" element={<Tanker
              key={selected} analysis={analysis} map={map} notify={notify} />} />
            <Route path="/zone-map" element={<Card title="Spatial operations">{map}</Card>} />
            <Route path="/action-center" element={<>
              <Recommendation analysis={analysis}
                draft={() => void draft(analysis.recommendation.scenario)} />
              <ActionCenter actions={zoneActions} reload={reload} notify={notify} />
            </>} />
            <Route path="/verification" element={<VerificationPage
              actions={zoneActions} reload={reload} notify={notify} />} />
            <Route path="/evidence" element={<>
              <PublicDataPanel analysis={analysis} />
              <Card title="Decision provenance">
                <p>Every record keeps its own source, timestamp, confidence and honesty
                  label. Municipal live demand and NRW telemetry are not connected.</p>
                <Table headers={["Source", "Value", "Class", "Label", "Confidence", "Timestamp", "Influence"]}
                  rows={analysis.evidence.map((e, i) => [
                    e.source, `${String(e.value)} ${e.unit}`,
                    <SourceBadge type={e.source_type} />,
                    <DataBadge label={e.data_label} />, e.confidence,
                    Number.isNaN(Date.parse(e.timestamp)) ? e.timestamp
                      : new Date(e.timestamp).toLocaleString(),
                    <Button onClick={() => setInspect(i)}
                      aria-label={`Inspect ${e.source}`}>Inspect</Button>
                  ])} />
              </Card>
              <div className="evidence-grid">{analysis.evidence.map((e, i) =>
                <EvidenceCard key={i} record={e} />)}</div>
              {inspect !== null && analysis.evidence[inspect] &&
                <Drawer title={analysis.evidence[inspect].source}
                  onClose={() => setInspect(null)}>
                  <p><SourceBadge type={analysis.evidence[inspect].source_type} />{" "}
                    <DataBadge label={analysis.evidence[inspect].data_label} /></p>
                  <p><strong>{String(analysis.evidence[inspect].value)} {analysis.evidence[inspect].unit}</strong></p>
                  <p>How it influenced the decision: {analysis.evidence[inspect].influence}</p>
                  <p>Confidence: {analysis.evidence[inspect].confidence} · Location: {analysis.evidence[inspect].location}</p>
                  <p>Recorded: {Number.isNaN(Date.parse(analysis.evidence[inspect].timestamp))
                    ? analysis.evidence[inspect].timestamp
                    : new Date(analysis.evidence[inspect].timestamp).toLocaleString()}</p>
                </Drawer>}
            </>} />
          </>}
          <Route path="*" element={<EmptyState>
            {error ? "Restore the API connection to use this workspace." :
              <>This route is not available. <Link to="/control-room">
                Return to Control Room</Link></>}
          </EmptyState>} />
        </Routes>}
        <footer className="app-footer">
          WATERPULSE AI · Estimates depend on input quality · Human verification required
        </footer>
      </main>
    </div>
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>;
}

function Kpis({ analysis: a }: { analysis: Analysis }) {
  return <div className="kpi-grid">
    <KPI label="WATER BUFFER" value={days(a.model.buffer_days)}
      detail="MODEL ESTIMATE · time to configured reserve" to="/water-buffer" />
    <KPI label="SHORTAGE CLOCK"
      value={a.clock.days === null ? "—" :
        `${a.clock.days}D ${String(a.clock.hours).padStart(2, "0")}H`}
      detail="MODEL ESTIMATE · not a physical countdown" to="/shortage-clock" />
    <KPI label="RISK" value={a.risk.level}
      detail={`Heuristic score ${a.risk.score}/100`} to="/diagnosis"
      tone={riskClass(a.risk.level)} />
    <KPI label="LOSS ANOMALIES" value={String(a.anomalies.length)}
      detail="Suspected · field verification required" to="/loss-anomalies" />
  </div>;
}

function ZoneStatus({
  zones, selected, select
}: { zones: Zone[]; selected: string; select: (id: string) => void }) {
  return <div className="zone-status">{zones.map(z => {
    const drain = z.demand_lpd / (1 - z.loss_pct / 100) - z.supply_lpd;
    const d = z.storage_l <= z.reserve_l ? 0 :
      drain <= 0 ? Infinity : (z.storage_l - z.reserve_l) / drain;
    const level = d < 1 ? "CRITICAL" : d < 3 ? "SHORTAGE APPROACHING" :
      d < 7 ? "WATCH" : "STABLE";
    return <button key={z.id} onClick={() => select(z.id)}
      className={selected === z.id ? "selected" : ""}>
      <strong>{z.name}</strong><StatusBadge level={level} />
      <small>{Number.isFinite(d) ? `${number(d, 2)} days to reserve`
        : "No depletion under constant inputs"}</small>
    </button>;
  })}</div>;
}

function Recommendation({
  analysis, draft
}: { analysis: Analysis; draft: () => void }) {
  const r = analysis.recommendation;
  return <Card title="AI Action Center" className="recommendation"
    aside={<Badge>{r.source_type}</Badge>}>
    <div className="recommendation-grid">
      <div><div className="eyebrow">RECOMMENDED INVESTIGATION</div>
        <h3>{r.title}</h3><p>{r.reasoning_summary}</p>
        <p>{analysis.diagnosis.summary}</p></div>
      <div className="impact">
        <strong>{r.expected_impact_days === null ? "Conditional"
          : `+${number(r.expected_impact_days, 2)} days`}</strong>
        <span>Estimated impact · {r.confidence} confidence</span>
        <Link to="/evidence">{r.evidence_count} evidence records ↗</Link>
        <Button className="primary" onClick={draft}>Create review draft</Button>
        <small>Not approved. No dispatch or physical control.</small>
      </div>
    </div>
    <details><summary>Assumptions, missing information and human checks</summary>
      <TextRows items={[
        ...r.missing_information, ...r.recommended_human_verification
      ]} /></details>
  </Card>;
}

function WaterBuffer({ analysis: a }: { analysis: Analysis }) {
  const z = a.zone;
  const percentage = Math.min(100, Math.max(0,
    (z.storage_l - z.reserve_l) / Math.max(z.storage_l, 1) * 100));
  const track = a.scenarios[0].projection;
  const day3 = track.find(point => point.day >= 3) ?? track[track.length - 1];
  const projectedPct = Math.min(100, Math.max(0,
    (day3?.storage_l ?? z.storage_l) / Math.max(z.storage_l, 1) * 100));
  const reservePct = Math.min(100, z.reserve_l / Math.max(z.storage_l, 1) * 100);
  return <>
    <Kpis analysis={a} />
    <div className="two-column">
      <Card title="Reservoir operating envelope" aside={<Badge>MODEL ESTIMATE</Badge>}>
        <div className="reservoir" role="img"
          aria-label={`${number(percentage)} percent of current storage above reserve`}>
          <div className="water" style={{ height: "100%" }} />
          <div className="projected-line" style={{ bottom: `${projectedPct}%` }}>
            Day 3 projection (no action)</div>
          <div className="reserve-threshold" style={{ bottom: `${reservePct}%` }}>
            Shortage threshold</div>
          <div className="reservoir-label">
            <strong>{number(z.storage_l / 1e6, 2)} ML</strong>
            <span>CURRENT GROSS STORAGE</span>
          </div>
          </div>
        <p>Scale: current gross storage = full height. Dashed lines show the configured shortage threshold and the no-action projection at day 3. Tank capacity is not supplied.</p>
      </Card>
      <Card title="Deterministic mass balance">
        <Table headers={["Quantity", "Value"]} rows={[
          ["Delivered demand", `${number(z.demand_lpd)} L/day`],
          ["Incoming supply", `${number(z.supply_lpd)} L/day`],
          ["Entered loss", `${z.loss_pct}%`],
          ["Gross withdrawal", `${number(a.model.gross_withdrawal_lpd)} L/day`],
          ["Estimated loss volume", `${number(a.model.estimated_loss_lpd)} L/day`],
          ["Net storage drawdown", `${number(a.model.net_drawdown_lpd)} L/day`],
          ["Usable delivered water above reserve", `${number(a.model.usable_delivered_l)} L`],
          ["Storage-only coverage", days(a.model.storage_only_days)],
          ["Supply-adjusted time to reserve", days(a.model.buffer_days)],
          ["Confidence", a.model.confidence]
        ]} />
      </Card>
    </div>
    <Card title="Projected depletion curve">
      <Chart series={[{ name: "No action",
        points: a.scenarios[0].projection, color: COLORS[0] }]}
        reserve={z.reserve_l} />
      <p>Historical measurements are unavailable. This is a projection, not a historical trend.</p>
    </Card>
    <Card title="Model assumptions"><TextRows items={a.model.assumptions} /></Card>
  </>;
}

function ShortageClock({ analysis: a }: { analysis: Analysis }) {
  return <Card title="Estimated Shortage Clock" aside={<Badge>MODEL OUTPUT</Badge>}>
    <div className="clock">
      <div><strong>{a.clock.days === null ? "—" :
        String(a.clock.days).padStart(2, "0")}</strong><span>DAYS</span></div>
      <i>:</i>
      <div><strong>{a.clock.hours === null ? "—" :
        String(a.clock.hours).padStart(2, "0")}</strong><span>HOURS</span></div>
    </div>
    <p className="center">Not a literal clock. Updated when operational inputs change.</p>
    <Table headers={["Operational context", "Estimate"]} rows={[
      ["Configured shortage threshold", `${number(a.zone.reserve_l)} L`],
      ["Estimated buffer", days(a.model.buffer_days)],
      ["Action window (24-hour lead assumption)",
        a.clock.action_window_hours === null ? "No estimated depletion"
          : `${a.clock.action_window_hours} hours`],
      ["Current model risk", a.risk.level],
      ["Observed risk trend", "Unavailable: no time-series meter history supplied"]
    ]} />
    <Chart series={[{ name: "No action",
      points: a.scenarios[0].projection, color: COLORS[1] }]}
      reserve={a.zone.reserve_l} />
    <TextRows items={a.model.assumptions} />
  </Card>;
}

function Diagnosis({
  analysis: a, notify
}: { analysis: Analysis; notify: (s: string) => void }) {
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  return <>
    <div className="kpi-grid">
      <KPI label="DEMAND TREND" value={`${a.zone.demand_trend_pct}%`}
        detail="Entered context · not compounded" to="/evidence" />
      <KPI label="SUPPLY TREND" value={`${a.zone.supply_trend_pct}%`}
        detail="Entered context · not compounded" to="/evidence" />
      <KPI label="ESTIMATED LOSS" value={`${a.zone.loss_pct}%`}
        detail="Loss trend unavailable" to="/loss-anomalies" />
      <KPI label="RAINFALL CONTEXT" value={String(a.environment.rainfall.value)}
        detail={a.environment.rainfall.source_type} to="/evidence" />
    </div>
    <Card title={a.diagnosis.primary_driver}>
      <p>{a.diagnosis.summary}</p><p>{a.diagnosis.secondary_signal}</p>
      <Button disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const result = await api<{ text: string; source: string }>(
            `/zones/${a.zone.id}/explanation`, "POST"
          );
          setExplanation(`${result.text}\n\nSource: ${result.source}`);
        } catch (e) { notify(e instanceof Error ? e.message : "Explanation failed"); }
        finally { setBusy(false); }
      }}>{busy ? "Generating explanation…" : "Explain the evidence"}</Button>
      {explanation && <p className="explanation">{explanation}</p>}
    </Card>
    <div className="two-column">
      <Card title="Risk contributions">
        <Table headers={["Factor", "Heuristic points"]}
          rows={Object.entries(a.risk.factors).map(([key, value]) =>
            [key.replaceAll("_", " "), number(value, 1)])} />
        <TextRows items={a.risk.assumptions} />
      </Card>
      <Card title="Evidence quality and missing information">
        <TextRows items={a.validator.missing_information} />
        <p>Groundwater context: {String(a.environment.groundwater.value)} · DEMO DATA</p>
      </Card>
    </div>
  </>;
}

function Simulator({
  analysis, zones, onDraft, notify
}: {
  analysis: Analysis; zones: Zone[];
  onDraft: (s: string, p: ScenarioParameters) => Promise<void>;
  notify: (s: string) => void
}) {
  const [parameters, setParameters] = useState(DEFAULT_PARAMETERS);
  const [scenarios, setScenarios] = useState(analysis.scenarios);
  const [selected, setSelected] = useState("loss");
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState(true);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    setBusy(true); setValid(false);
    const timer = window.setTimeout(() => {
      api<Scenario[]>(`/zones/${analysis.zone.id}/scenarios`,
        "POST", parameters, controller.signal)
        .then(result => {
          if (current === sequence.current && !controller.signal.aborted) {
            setScenarios(result); setValid(true);
          }
        }).catch(e => {
          if (!controller.signal.aborted) {
            notify(e instanceof Error ? e.message : "Simulation failed");
          }
        }).finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [parameters, analysis.zone.id, notify]);

const chosen = scenarios.find(s => s.id === selected)!;
  const numeric = [
    ["loss_reduction_pp", "Loss reduction (percentage points)", 0, 30],
    ["intervention_delay_hours", "Intervention delay (hours)", 0, 720],
    ["trips_per_tanker", "Trips per available tanker", 0, 10],
    ["redistribution_l", "Redistribution volume (L)", 0, 10000000],
    ["donor_min_buffer_days", "Minimum donor buffer (days)", 0, 90]
  ] as const;
  return <>
    <Card title="Intervention assumptions" aside={<Badge>DETERMINISTIC SIMULATION</Badge>}>
      <div className="form-grid">{numeric.map(([key, label, min, max]) =>
        <label key={key}>{label}
          <input type="number" min={min} max={max} step="any"
            value={parameters[key]} onChange={e => setParameters(p => ({
              ...p, [key]: Number(e.target.value)
            }))} />
        </label>)}
        <label>Donor zone<select value={parameters.donor_zone_id || ""}
          onChange={e => setParameters(p => ({
            ...p, donor_zone_id: e.target.value || null
          }))}>
          <option value="">Largest available storage (automatic)</option>
          {zones.filter(z => z.id !== analysis.zone.id).map(z =>
            <option key={z.id} value={z.id}>{z.name}</option>)}
        </select></label>
      </div>
      <p role="status">{busy ? "Recalculating scenarios…" :
        valid ? "Results reflect the current parameters." : "Simulation unavailable."}</p>
    </Card>
    <div className={`scenario-grid ${busy ? "calculating" : ""}`}>
      {scenarios.map(s => <ScenarioCard key={s.id} scenario={s}
        selected={s.id === selected} onChoose={() => setSelected(s.id)} />)}
    </div>
    <Card title="Compare projected storage">
      <Chart reserve={analysis.zone.reserve_l}
        series={scenarios.map((s, i) => ({
          name: s.name, points: s.projection, color: COLORS[i]
        }))} />
    </Card>
    <Card title={`Review ${chosen.name}`}>
      <p>{chosen.resources}</p>
      {!chosen.feasible && <TextRows items={chosen.constraints} />}
      {chosen.donor_zone_id && <p>Donor remaining buffer: {days(chosen.donor_buffer_days)}</p>}
      <Button className="primary" disabled={busy || !valid || !chosen.feasible}
        onClick={() => void onDraft(chosen.id, parameters)}>Create scenario draft</Button>
      <details><summary>Scenario assumptions</summary>
        <TextRows items={chosen.assumptions} /></details>
    </Card>
  </>;
}

function Tanker({
  analysis, map, notify
}: { analysis: Analysis; map: React.ReactNode; notify: (s: string) => void }) {
  const [required, setRequired] = useState(100000);
  const [hours, setHours] = useState(12);
  const [result, setResult] = useState<TankerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const route = useRoute(analysis.zone.id);
  async function calculate(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      setResult(await api<TankerResult>(
        `/zones/${analysis.zone.id}/tankers`, "POST",
        { required_water_l: required, operating_hours: hours }
      ));
    } catch (e) { notify(e instanceof Error ? e.message : "Calculation failed"); }
    finally { setBusy(false); }
  }
  return <>
    <Card title="Tanker delivery planning" aside={<Badge>NO LIVE TRACKING</Badge>}>
      <form onSubmit={calculate}>
        <div className="form-grid">
          <label>Required water (L)<input type="number" min="1" max="100000000"
            required value={required} onChange={e => {
              setRequired(Number(e.target.value)); setResult(null);
            }} /></label>
          <label>Operating window (hours)<input type="number" min=".1" max="72"
            step="any" required value={hours} onChange={e => {
              setHours(Number(e.target.value)); setResult(null);
            }} /></label>
        </div>
        <p>{analysis.zone.available_tankers} tankers × {
          number(analysis.zone.tanker_capacity_l)} L · {
          analysis.zone.distance_km} km assumed one-way distance ·
          destination: {analysis.zone.name}</p>
        <Link to="/zone-configuration">Edit capacity, distance and turnaround inputs ↗</Link>
        <div className="button-row"><Button className="primary" disabled={busy}>
          {busy ? "Calculating…" : "Calculate delivery"}
        </Button></div>
      </form>
      {result && <>
        <Table headers={["Delivery estimate", "Value"]} rows={[
          ["Required trips", result.required_trips],
          ["First delivery", `${number(result.first_delivery_hours, 2)} hours`],
          ["Round-trip cycle", `${number(result.cycle_hours, 2)} hours`],
          ["Window capacity", `${number(result.delivery_capacity_l)} L`],
          ["Estimated completion", result.estimated_completion_hours === null
            ? "Unavailable: no tankers" : `${number(result.estimated_completion_hours, 2)} hours`],
          ["Feasible within window", result.feasible_in_window ? "Yes, under assumptions" : "No"],
          ["Priority context", analysis.risk.level]
        ]} />
        <TextRows items={result.assumptions} />
        <Link to="/what-if">Compare projected buffer effect in What-If ↗</Link>
      </>}
    </Card>
    <Card title="Route estimate" aside={<Badge>{route.data?.label ?? "LOADING"}</Badge>}>
      {route.loading && <p>Requesting route…</p>}
      {route.error && <p>Route unavailable: {route.error}</p>}
      {route.data && <>
        <Table headers={["Item", "Value"]} rows={[
          ["From", route.data.origin?.name ?? "No tanker source configured"],
          ["To", route.data.destination?.name ?? analysis.zone.name],
          ["Estimated distance", route.data.distance_km != null
            ? `${number(route.data.distance_km, 1)} km` : "Unavailable"],
          ["Estimated duration", route.data.duration_min != null
            ? `${route.data.duration_min} min` : "Unavailable"],
          ["Distance used by the tanker model", `${analysis.zone.distance_km} km (zone input)`],
          ["Traffic", route.data.traffic ?? "—"]
        ]} />
        <p>{route.data.message ?? ""} A road-route estimate is not live tanker tracking.
          Change the zone distance input to apply it to the model.</p>
      </>}
    </Card>
    {map}
  </>;
}

function ActionCenter({
  actions, reload, notify
}: {
  actions: ActionRecord[]; reload: () => void; notify: (s: string) => void
}) {
  const [review, setReview] = useState<{
    action: ActionRecord; operation: string
  } | null>(null);
  const [note, setNote] = useState("");
  const [scenario, setScenario] = useState("loss");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!review) return;
    setBusy(true);
    try {
      await api(`/actions/${review.action.id}/${
        review.operation === "execution" ? "execution" : "decision"
      }`, "POST", review.operation === "execution"
        ? { note } : { decision: review.operation, note,
          ...(review.operation === "modify" ? { scenario } : {}) });
      setReview(null); reload();
      notify("Workflow updated. No external dispatch or infrastructure command sent.");
    } catch (e) { notify(e instanceof Error ? e.message : "Update failed"); }
    finally { setBusy(false); }
  }
  function open(action: ActionRecord, operation: string) {
    setReview({ action, operation }); setNote(""); setScenario(action.scenario);
  }
  return <div className="section-gap">
    {!actions.length && <EmptyState>
      No action drafts yet. Review a recommendation or scenario to create one.
    </EmptyState>}
    {[...actions].reverse().map(action => <Card key={action.id}
      title={action.expected.name} aside={<Badge>{action.status}</Badge>}>
      <p>Plan-time estimate: {days(action.expected.buffer_days)} ·
        zone version {action.zone_version}</p>
      <p>{action.expected.resources}</p>
      <Timeline events={action.history} />
      <ApprovalPanel status={action.status} onAction={op => open(action, op)} />
    </Card>)}
    {review && <Modal title={`${review.operation} · ${review.action.expected.name}`}
      onClose={() => { if (!busy) setReview(null); }}>
      <form onSubmit={submit}>
        <p>This records a human decision only. It does not send tankers,
          operate valves, or control municipal infrastructure.</p>
        {review.operation === "modify" && <label>Scenario
          <select value={scenario} onChange={e => setScenario(e.target.value)}>
            <option value="no_action">No action</option>
            <option value="tanker">Tanker deployment</option>
            <option value="loss">Loss intervention</option>
            <option value="redistribution">Redistribution</option>
          </select>
        </label>}
        <label>Operator rationale<textarea required minLength={5}
          maxLength={1500} value={note} onChange={e => setNote(e.target.value)} /></label>
        <Button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Confirm recorded decision"}
        </Button>
      </form>
    </Modal>}
  </div>;
}

function VerificationPage({
  actions, reload, notify
}: {
  actions: ActionRecord[]; reload: () => void; notify: (s: string) => void
}) {
  const [active, setActive] = useState<ActionRecord | null>(null);
  const eligible = actions.filter(a =>
    a.status === "EXECUTED" || a.status === "VERIFIED");
  return <>
    <Card title="Close the operational loop">
      <p>Compare entered observations with the plan-time estimate. A comparison
        is not proof that the intervention caused the change.</p>
      <p>Verification is stored separately and never silently overwrites zone configuration.</p>
    </Card>
    {!eligible.length && <EmptyState>
      Approve a draft and record execution in Action Center before verification.
    </EmptyState>}
    {[...eligible].reverse().map(a => <Card key={a.id} title={a.expected.name}
      aside={<Badge>{a.verification
        ? a.verification.simulated ? "SIMULATED VERIFICATION" : "OPERATOR-ENTERED VERIFICATION"
        : "AWAITING OBSERVATION"}</Badge>}>
      {a.verification ? <>
        <Table headers={["Metric", "Before", "After"]} rows={[
          ["Buffer", days(a.verification.before_buffer_days),
            days(a.verification.after_buffer_days)],
          ["Estimated loss", `${a.verification.before_loss_pct}%`,
            `${a.verification.after_loss_pct}%`],
          ["Model risk", a.verification.before_risk.level,
            a.verification.after_risk.level],
          ["Anomaly observation", String(a.verification.before_anomaly),
            String(a.verification.after_anomaly)],
          ["Observed storage", `${number(a.before.storage_l)} L`,
            `${number(a.verification.observation.storage_l)} L`],
          ["Supply", `${number(a.before.supply_lpd)} L/day`,
            `${number(a.verification.observation.supply_lpd)} L/day`],
          ["Demand", `${number(a.before.demand_lpd)} L/day`,
            `${number(a.verification.observation.demand_lpd)} L/day`],
          ["Observation timestamp", "—", new Date(a.verification.observed_at).toLocaleString()],
          ["Plan-time expected buffer", days(
            a.verification.expected_buffer_days_at_plan_time
          ), "Not directly time-aligned"]
        ]} />
        <Chart label="Before/after entered loss estimate"
          series={[{ name: "Loss estimate (percentage points)",
            color: COLORS[2], points: [
              { day: 0, storage_l: a.verification.before_loss_pct * 1e6 },
              { day: 1, storage_l: a.verification.after_loss_pct * 1e6 }
            ] }]} />
        <p>The chart uses M-axis units as percentage points for this comparison;
          day 0/1 denotes before/after, not elapsed time.</p>
        <p>{a.verification.summary}</p>
        <EvidenceCard record={a.verification.provenance} />
      </> : <Button className="primary" onClick={() => setActive(a)}>
        Enter verification observation
      </Button>}
    </Card>)}
    {active && <Modal title="Record verification" onClose={() => setActive(null)}>
      <VerificationForm action={active} saved={() => {
        setActive(null); reload();
      }} notify={notify} />
    </Modal>}
  </>;
}

function VerificationForm({
  action, saved, notify
}: { action: ActionRecord; saved: () => void; notify: (s: string) => void }) {
  const [form, setForm] = useState({
    storage_l: action.before.storage_l,
    supply_lpd: action.before.supply_lpd,
    demand_lpd: action.before.demand_lpd,
    loss_pct: action.before.loss_pct,
    anomaly_observed: action.before.observed_anomaly,
    simulated: true,
    note: ""
  });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api(`/actions/${action.id}/verification`, "POST", {
        ...form, observed_at: new Date().toISOString()
      });
      saved(); notify("Verification saved with explicit observation provenance.");
    } catch (e) { notify(e instanceof Error ? e.message : "Verification failed"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <p>Defaults copy the before state; they are not new measurements.
      Enter an observation taken now. Keep simulated mode enabled for demo values.</p>
    <div className="form-grid">
      {([
        ["storage_l", "Observed storage (L)"],
        ["supply_lpd", "Observed incoming supply (L/day)"],
        ["demand_lpd", "Observed delivered demand (L/day)"],
        ["loss_pct", "Observed/estimated loss (%)"]
      ] as const).map(([key, label]) => <label key={key}>{label}
        <input required type="number" min={key === "demand_lpd" ? 1 : 0}
          max={key === "loss_pct" ? 60 : undefined} step="any"
          value={form[key]} onChange={e =>
            setForm(f => ({ ...f, [key]: Number(e.target.value) }))} />
      </label>)}
    </div>
    <label className="checkbox"><input type="checkbox"
      checked={form.anomaly_observed} onChange={e =>
        setForm(f => ({ ...f, anomaly_observed: e.target.checked }))} />
      Anomaly still observed</label>
    <label className="checkbox"><input type="checkbox"
      checked={form.simulated} onChange={e =>
        setForm(f => ({ ...f, simulated: e.target.checked }))} />
      Simulated verification</label>
    <label>Observation notes<textarea required minLength={5}
      maxLength={2000} value={form.note}
      onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></label>
    <Button className="primary" disabled={busy}>Save verification</Button>
  </form>;
}

const DEFAULT_ZONE: ZoneInput = {
  name: "New operator zone", location: "Enter locality",
  latitude: 18.52, longitude: 73.85,
  demand_lpd: 620000, storage_l: 2400000, supply_lpd: 500000,
  loss_pct: 8, reserve_l: 240000,
  tanker_capacity_l: 10000, available_tankers: 3,
  refill_minutes: 30, distance_km: 8, speed_kph: 25, unload_minutes: 20,
  demand_trend_pct: 0, supply_trend_pct: 0, criticality: 3,
  observed_anomaly: false, priority_facilities: "", notes: ""
};

function ZoneConfiguration({
  zone, saved, notify
}: { zone?: Zone; saved: (id: string) => void; notify: (s: string) => void }) {
  const [mode, setMode] = useState("Edit selected");
  const [form, setForm] = useState<ZoneInput>(() => {
    if (!zone) return DEFAULT_ZONE;
    const { id: _id, version: _version, provenance: _provenance, ...inputs } = zone;
    return inputs;
  });
  const [busy, setBusy] = useState(false);
  const fields = [
    ["demand_lpd", "Daily delivered demand (L/day)", 1, 1000000000],
    ["storage_l", "Current storage (L)", 0, 10000000000],
    ["supply_lpd", "Incoming supply (L/day)", 0, 1000000000],
    ["loss_pct", "Estimated distribution loss (%)", 0, 60],
    ["reserve_l", "Shortage reserve threshold (L)", 0, 10000000000],
    ["tanker_capacity_l", "Tanker capacity (L)", 1, 100000],
    ["available_tankers", "Available tankers", 0, 1000],
    ["refill_minutes", "Refill time (minutes)", 1, 1440],
    ["distance_km", "One-way source distance (km)", 0, 1000],
    ["speed_kph", "Assumed average speed (km/h)", 1, 130],
    ["unload_minutes", "Unloading time (minutes)", 1, 240],
    ["demand_trend_pct", "Demand trend (%)", -90, 200],
    ["supply_trend_pct", "Supply trend (%)", -100, 200],
    ["criticality", "Zone criticality (1–5)", 1, 5],
    ["latitude", "Latitude", -85, 85],
    ["longitude", "Longitude", -180, 180]
  ] as const;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const editing = mode === "Edit selected" && zone;
      const result = await api<Zone>(
        editing ? `/zones/${zone.id}` : "/zones",
        editing ? "PUT" : "POST",
        editing ? { ...form, expected_version: zone.version } : form
      );
      saved(result.id); notify("Zone saved as OPERATOR INPUT.");
    } catch (e) { notify(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  }
  return <Card title="Operational zone configuration" aside={<Badge>OPERATOR INPUT</Badge>}>
    <Tabs values={["Edit selected", "Create new"]} selected={mode}
      onChange={value => {
        setMode(value);
        if (value === "Create new") setForm({ ...DEFAULT_ZONE });
        else if (zone) {
          const { id: _id, version: _version, provenance: _p, ...inputs } = zone;
          setForm(inputs);
        }
      }} />
    <form onSubmit={submit}>
      <div className="form-grid">
        <label>Zone name<input required maxLength={80} value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <label>Location<input required maxLength={120} value={form.location}
          onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></label>
        {fields.map(([key, label, min, max]) => <label key={key}>{label}
          <input type="number" required min={min} max={max}
            step={key === "available_tankers" || key === "criticality" ? "1" : "any"}
            value={form[key]} onChange={e =>
              setForm(f => ({ ...f, [key]: Number(e.target.value) }))} />
        </label>)}
        <label>Priority facilities<input maxLength={500}
          value={form.priority_facilities} onChange={e =>
            setForm(f => ({ ...f, priority_facilities: e.target.value }))} /></label>
        <label>Notes<textarea maxLength={2000} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></label>
      </div>
      <label className="checkbox"><input type="checkbox"
        checked={form.observed_anomaly} onChange={e =>
          setForm(f => ({ ...f, observed_anomaly: e.target.checked }))} />
        Suspected anomaly observed; field verification required</label>
      <p>Coordinates locate an illustrative zone center. No verified boundary,
        pipe, facility or network geometry is inferred.</p>
      <Button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save zone"}
      </Button>
    </form>
  </Card>;
}

function Settings({
  theme, setTheme, health, reload, notify
}: {
  theme: string; setTheme: (s: string) => void;
  health: Health | null; reload: () => void; notify: (s: string) => void
}) {
  const [token, setToken] = useState("");
  const summary = useDataSummary();
  async function exportData() {
    try {
      const data = await api<unknown>("/export");
      const url = URL.createObjectURL(new Blob(
        [JSON.stringify(data, null, 2)], { type: "application/json" }
      ));
      const link = document.createElement("a");
      link.href = url; link.download = "waterpulse-workspace.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { notify(e instanceof Error ? e.message : "Export failed"); }
  }
  const providers = summary.data?.providers;
  const state = (p?: { status?: string; stations?: number; schemes?: number }) =>
    !p ? "Loading" : p.status === "DATA_UNAVAILABLE" ? "DATA UNAVAILABLE"
      : `Loaded · ${p.stations ?? p.schemes} ${p.schemes ? "schemes" : "stations"}`;
  return <div className="two-column">
    <Card title="Workspace preferences">
      <label>Color foundation<select value={theme}
        onChange={e => setTheme(e.target.value)}>
        <option value="dark">Dark command room</option>
        <option value="light">Light operations</option>
      </select></label>
      <p>Map basemap comes from MapTiler when VITE_MAPTILER_KEY is set at build time;
        otherwise an OpenStreetMap raster is requested. An offline schematic is used
        when WebGL is unavailable.</p>
      <Button onClick={() => void exportData()}>Export workspace evidence and history</Button>
    </Card>
    <Card title="Operator session and integrations">
      <Table headers={["Setting", "Status"]} rows={[
        ["API", health?.status || "Unavailable"],
        ["Server mode", health?.mode || "Unknown"],
        ["Active workspace", health?.workspace || "Unknown"],
        ["Storage", health?.storage || "Unknown"],
        ["Weather adapter", `${health?.weather_provider || "Unknown"}${
          health?.weather_configured ? " · key configured" : ""}`],
        ["Amazon Location routing", health?.routing_configured
          ? "Key configured (server side)" : "Not configured — straight-line fallback"],
        ["Bedrock configuration", health?.bedrock_configured ? "Configured, not verified here" : "Not configured"],
        ["Physical controls", "None"],
        ["IMD / CGWB", "Not connected"]
      ]} />
      <form onSubmit={e => {
        e.preventDefault();
        sessionStorage.setItem("waterpulse-token", token);
        setToken(""); reload(); notify("Pilot token stored for this browser session.");
      }}>
        <label>Pilot API session token
          <input type="password" autoComplete="off" value={token}
            onChange={e => setToken(e.target.value)} />
        </label>
        <Button>Use session token</Button>
      </form>
      <p>This single-operator pilot credential is not a replacement for production SSO,
        tenant isolation or RBAC. Provider keys belong only in backend environment
        configuration.</p>
    </Card>
    <Card title="Public datasets">
      <Table headers={["Dataset", "Status", "Freshness"]} rows={[
        ["Delhi groundwater", state(providers?.groundwater),
          providers?.groundwater?.freshness?.age_label ?? "—"],
        ["Maharashtra SCADA", state(providers?.scada),
          providers?.scada?.freshness?.age_label ?? "—"],
        ["Maharashtra discharge", state(providers?.discharge),
          providers?.discharge?.freshness?.age_label ?? "—"],
        ["MIDC water supply schemes", state(providers?.water_supply), "Baseline · no date"]
      ]} />
      <p>{summary.data?.statement}</p>
    </Card>
  </div>;
}

function PublicDataPanel({ analysis }: { analysis: Analysis }) {
  const summary = useDataSummary();
  const ctx = analysis.data_context;
  const schemes = useFetch<{ items: MidcScheme[]; count: number }>(
    "/data/water-supply?placed_only=true&limit=8", analysis.zone.id);
  if (analysis.workspace === "demo") {
    return <Card title="Public datasets" aside={<DataBadge label="DEMO DATA" />}>
      <p>The DEMO workspace never mixes in real observations. Switch to the PILOT
        workspace in the top bar to see the integrated public datasets as evidence.</p>
    </Card>;
  }
  const obs: PublicObservation[] = [
    ...(ctx?.groundwater.stations ?? []),
    ...(ctx?.scada.latest ?? []).filter(o => o.unit === "cusec" || o.unit === "m")
      .slice(0, 6),
    ...(ctx?.discharge.latest ? [ctx.discharge.latest] : [])
  ];
  const providers = summary.data?.providers;
  return <>
    <Card title="Real public data near this zone" aside={<DataBadge label="REAL PUBLIC DATA" />}>
      <p>{summary.data?.statement ?? "The supplied datasets are real public/government data, not necessarily live telemetry."}</p>
      {ctx && <ul className="status-list">
        {(["groundwater", "scada", "discharge"] as const).map(k =>
          <li key={k}><strong>{k.toUpperCase()}</strong>: {ctx[k].status === "OK"
            ? "nearby public telemetry found" : ctx[k].message ?? ctx[k].status}</li>)}
      </ul>}
      {obs.length === 0 ? <EmptyState>No public telemetry within {ctx?.radius_km ?? 50} km
        of this zone. Nothing is substituted.</EmptyState> :
        <Table headers={["Station", "Parameter", "Value", "Observed", "Freshness", "Source", "Distance"]}
          rows={obs.map(o => [
            o.station_name, o.parameter, `${number(o.value, 2)} ${o.unit}`,
            o.timestamp ? new Date(o.timestamp).toLocaleString() : "—",
            <FreshBadge freshness={o.freshness} />, o.source,
            o.distance_km != null ? `${o.distance_km} km` : "—"])} />}
      {providers?.scada?.quality_flags?.map(f => <p key={f} className="note">⚠ {f}</p>)}
      {providers?.discharge?.all_zero_in_file && <p className="note">⚠ The discharge file
        reports 0 cusec for every gate across its whole history. That does not show whether
        a downstream canal is flowing.</p>}
    </Card>
    <Card title="MIDC supply schemes (baseline)" aside={<DataBadge label="REAL GOVERNMENT BASELINE" />}>
      <p>Plant capacity and utilisation are static baseline figures with no observation
        date. They are never shown as live.</p>
      {schemes.data && <Table headers={["Scheme", "Capacity (MLD)", "In use (MLD)", "Utilisation", "Industrial", "Domestic"]}
        rows={schemes.data.items.map(m => [m.scheme, m.capacity_mld ?? "—",
          m.utilisation_mld ?? "—",
          m.utilisation_pct != null ? `${m.utilisation_pct}%` : "—",
          m.industrial_mld ?? "—", m.domestic_mld ?? "—"])} />}
      {schemes.error && <ErrorState message={schemes.error} retry={() => undefined} />}
    </Card>
  </>;
}
