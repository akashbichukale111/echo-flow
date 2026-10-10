import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, useLocation, useNavigate } from "react-router-dom";
import { request, runDecision } from "./api";
import CommandCenter from "./CommandCenter";
import Graph from "./Graph";
import type { Anchor } from "./geo";
import { parseAnchor } from "./geo";
import { AuditVerify, CoverageMatrix, IntegrationStatus, LiveContextPanel, Prov } from "./Live";
import { readMapConfig } from "./mapConfig";
import { defaultIntervention } from "./Ops";
import type { Check, Intervention, LiveContext, MapPhase, PickMode, ProviderResult, RouteState, Scenario } from "./types";

// Primary workspace navigation (the nine command-centre areas) and secondary analysis screens.
const primaryPages = [
  ["command", "Command Center"],
  ["options", "Find Options"],
  ["echo", "Simulation"],
  ["battle", "Counterfactuals"],
  ["challenge", "Red Team"],
  ["safety", "Safety Gate"],
  ["human", "Human Decision"],
  ["live", "Live Evidence"],
  ["audit", "Audit"]
];
const secondaryPages = [
  ["agents", "AI team"],
  ["impact", "Impact + equity"],
  ["analysis", "Model laboratory"],
  ["result", "New state"]
];

const idleRoute: RouteState = { phase: "IDLE", origin: null, destination: null, result: null, message: "" };

export function Evidence({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">Not available</span>;
  if (typeof value === "boolean") return <span>{value ? "YES" : "NO"}</span>;
  if (typeof value === "number") return <span>{Number.isInteger(value) ? value : value.toFixed(3)}</span>;
  if (typeof value === "string") return <span>{value}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">No records</span>;
    return <div className="evidence-array">{value.map((v, i) => (
      <details key={i}><summary>Record {i + 1}</summary><Evidence value={v} /></details>
    ))}</div>;
  }
  return (
    <dl className="evidence">
      {Object.entries(value as Record<string, unknown>).map(([key, v]) => (
        <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd><Evidence value={v} /></dd></div>
      ))}
    </dl>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  return <div className="checks">{checks.map(c => (
    <div key={c.name} className={c.pass ? "check-ok" : "check-fail"}>
      <strong>{c.pass ? "PASS" : "FAIL"} · {c.name}</strong>
      {c.detail && <small>{c.detail}</small>}
    </div>
  ))}</div>;
}

function Clock({ scenario }: { scenario: Scenario }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const start = Date.parse(scenario.run?.created_at ?? scenario.created_at);
  const remaining = Math.max(0, scenario.decision_window_seconds - Math.floor((clock - start) / 1000));
  return (
    <div className="decision-clock">
      <span>MODELED DECISION WINDOW</span>
      <strong>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</strong>
      <small>{remaining ? "Authorization expires when this reaches zero" : "EXPIRED · Re-simulate"}</small>
    </div>
  );
}

const emptyIntervention: Intervention = defaultIntervention;

function Delta({ before, after }: { before: unknown; after: unknown }) {
  if (typeof before !== "number" || typeof after !== "number") return <span className="muted">—</span>;
  const d = after - before;
  if (Math.abs(d) < 1e-9) return <span>unchanged</span>;
  return <span className={d < 0 ? "delta-down" : "delta-up"}>{d < 0 ? "▼ improved/lower " : "▲ higher "}{Math.abs(d).toFixed(2)}</span>;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const seg = location.pathname.split("/").filter(Boolean);
  const inApp = seg[0] === "echo-flow";
  const page = inApp ? (seg[1] || "command") : "command";
  const mapConfig = useMemo(() => readMapConfig(), []);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<Intervention>(emptyIntervention);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(() => parseAnchor(import.meta.env.VITE_DEMO_ANCHOR));
  const [liveCtx, setLiveCtx] = useState<LiveContext | null>(null);
  const [mapPhase, setMapPhase] = useState<MapPhase>(mapConfig.status === "READY" ? "LOADING" : "NOT_CONFIGURED");
  const [pickMode, setPickMode] = useState<PickMode>("none");
  const [route, setRoute] = useState<RouteState>(idleRoute);
  const started = useRef(false);

  async function job<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      return await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    request<Record<string, unknown>>("/health").then(setHealth).catch(() => {
      setHealth(null);
      setError("API unavailable. No emergency state or AWS status is assumed.");
    });
  }, []);

  useEffect(() => {
    if (scenario?.run) setForm(scenario.run.intervention);
    else if (scenario?.state.mode === "heat") {
      setForm({ ...emptyIntervention, pump: 1, gate_open: true, buffer: null, priority_power: true, noncritical_shed: 0.35 });
    }
  }, [scenario?.run?.id, scenario?.id]);

  // Leaving the Command Center unmounts the map, so its load state no longer applies.
  useEffect(() => {
    if (page !== "command") setMapPhase(mapConfig.status === "READY" ? "LOADING" : "NOT_CONFIGURED");
  }, [page, mapConfig.status]);

  async function load(mode: "flood" | "heat", target?: string | false) {
    await job("Loading synthetic scenario", async () => {
      const d = await request<Scenario>("/scenarios", { mode }, token);
      setScenario(d);
      setSelectedId(null);
      if (target !== false) navigate(target ?? "/echo-flow/command");
    });
  }

  // The product opens straight into a working Command Center: load the flood scenario once at start-up.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load("flood", false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(intervention?: Intervention) {
    if (!scenario) return;
    await job("Running deterministic analysis and configured agents", async () => {
      setScenario(await runDecision(scenario.id, token, intervention));
    });
  }

  async function mutate(path: string, body: unknown, label: string) {
    if (!scenario) return;
    await job(label, async () => {
      setScenario(await request<Scenario>(`/scenarios/${scenario.id}/${path}`, body, token));
    });
  }

  function handlePick(mode: PickMode, lngLat: [number, number]) {
    setPickMode("none");
    if (mode === "anchor") setAnchor({ lat: lngLat[1], lon: lngLat[0] });
    else if (mode === "origin") setRoute(r0 => ({ ...idleRoute, origin: lngLat, destination: r0.destination }));
    else if (mode === "destination") setRoute(r0 => ({ ...idleRoute, origin: r0.origin, destination: lngLat }));
  }

  async function calculateRoute() {
    if (!route.origin || !route.destination) return;
    setRoute(r0 => ({ ...r0, phase: "PENDING", result: null, message: "" }));
    try {
      const res = await request<ProviderResult>("/route",
        { origin: route.origin, destination: route.destination, travel_mode: "Car" }, token);
      // Only a LIVE status means a route was calculated; every other status is a failure and shows no route.
      if (res.status === "LIVE") setRoute(r0 => ({ ...r0, phase: "LIVE", result: res, message: "" }));
      else setRoute(r0 => ({ ...r0, phase: "FAILED", result: res, message: res.detail || "The routing service returned no route." }));
    } catch (e) {
      setRoute(r0 => ({ ...r0, phase: "FAILED", result: null, message: e instanceof Error ? e.message : "Route request failed" }));
    }
  }

  const r = scenario?.run;
  const stale = Boolean(r && scenario && (
    r.state_revision !== scenario.state_revision || r.knowledge_revision !== scenario.knowledge_revision));
  const metrics = r?.simulation.metrics;
  const scalarMetrics = metrics ? Object.entries(metrics).filter(([, v]) => typeof v === "number").slice(0, 8) : [];

  function panel(title: string, children: ReactNode) {
    return <section className="panel"><h2>{title}</h2>{children}</section>;
  }

  function renderPage() {
    if (page === "live") {
      return <>
        <LiveContextPanel token={token} scenario={scenario} alertKeyword="flood" onApplied={setScenario} onFetched={setLiveCtx} />
        <IntegrationStatus />
        <section className="panel">
          <h2>What is actually built</h2>
          <p className="muted">Implemented = working engine and decision workflow. Partial = covered through another engine's model.
            Planned = not built. Data: <Prov label="SIMULATED" /> internal model values, <Prov label="REAL / PUBLIC" /> external sources,{" "}
            <Prov label="DERIVED" /> computed from either, <Prov label="AI REASONING" /> model explanations.</p>
          <CoverageMatrix />
        </section>
      </>;
    }

    if (!scenario) {
      if (busy) return <div className="skeleton-grid" role="status" aria-label="Loading scenario">
        <div className="skeleton map" /><div className="skeleton side" /><div className="skeleton strip" /></div>;
      return panel("No scenario loaded", <>
        <p>The synthetic scenario could not be loaded automatically. Check that the backend is running on 127.0.0.1:5201.</p>
        <button onClick={() => load("flood")} disabled={!!busy}>LOAD FLOOD SCENARIO</button>
        <button className="secondary" onClick={() => load("heat")} disabled={!!busy}>LOAD HEAT-WATER SCENARIO</button>
      </>);
    }

    if (page === "command") {
      return <CommandCenter
        config={mapConfig} scenario={scenario} anchor={anchor} onAnchor={setAnchor}
        onClearAnchor={() => setAnchor(null)} selectedId={selectedId} onSelect={setSelectedId}
        busy={!!busy} stale={stale} onSimulate={i => void run(i)} onRunDecision={() => void run()}
        mapPhase={mapPhase} onMapPhase={(p0) => setMapPhase(p0)}
        route={route} pickMode={pickMode} onRequestPick={setPickMode} onPick={handlePick}
        onCancelPick={() => setPickMode("none")} onCalculateRoute={() => void calculateRoute()}
        onClearRoute={() => { setRoute(idleRoute); setPickMode("none"); }} liveCtx={liveCtx}
        clock={<Clock scenario={scenario} />} />;
    }

    if (!r) return panel("Analysis not run", <>
      <p>Run the decision engine to create calculations and evidence for this screen.</p>
      <button onClick={() => run()} disabled={!!busy}>RUN DECISION</button>
    </>);

    if (page === "options") return panel("Search → validate → challenge", <>
      {r.no_feasible_buffer && (
        <p className="warning">NO FEASIBLE LOW-HARM BUFFER FOUND. Inspect non-buffer plans; none is automatically authorized.</p>
      )}
      {!r.options.length && <p>Heat-Water plans use power-allocation controls, not flood buffers.</p>}
      <div className="candidate-grid">{r.options.map(o => (
        <article key={o.id} className="candidate">
          <span className={`badge ${o.status === "FAIL" ? "danger" : ""}`}>{o.status}</span>
          <h3>{o.id}</h3>
          <p>{o.distance_m.toFixed(0)} m · {o.range}</p>
          <p>{o.capacity_m3.toLocaleString()} m³ · exposure: {o.exposure}</p>
          {o.precheck_pass && o.status === "FAIL" && (
            <p className="warning">⚠ INTERVENTION ECHO DETECTED: preliminary checks passed; consequence validation rejected this option.</p>
          )}
          <Checks checks={o.checks.map(c => ({ ...c, detail: c.detail }))} />
        </article>
      ))}</div>
    </>);

    if (page === "agents") return (
      <div className="candidate-grid">{r.agents.map(a => (
        <section className="panel" key={a.agent_id}>
          <h2>{a.agent_id.toUpperCase()}</h2>
          <span className="badge">{a.status}</span>
          <p className="muted"><Prov label={a.provider.includes("BEDROCK") && a.status === "COMPLETE" ? "AI REASONING" : "DERIVED"} /> {a.provider}</p>
          <p>{a.reasoning_summary}</p>
          <time>{a.timestamp}</time>
          <details><summary>Inspect evidence</summary><Evidence value={a.evidence} /></details>
        </section>
      ))}</div>
    );

    if (page === "battle") {
      const keys = Array.from(new Set(Object.values(r.plans).flatMap(p => Object.keys(p.metrics))))
        .filter(k => Object.values(r.plans).some(p => typeof p.metrics[k] === "number"));
      const noAction = Object.values(r.plans)[0];
      return panel("Counterfactual battle · trade-offs, not a winner badge", <>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Metric</th>{Object.keys(r.plans).map(n => <th key={n}>{n}</th>)}</tr></thead>
            <tbody>
              {keys.map(k => <tr key={k}>
                <th>{k.replaceAll("_", " ")}</th>
                {Object.entries(r.plans).map(([name, p]) =>
                  <td key={name}><Evidence value={p.metrics[k]} /><br /><small><Delta before={noAction.metrics[k]} after={p.metrics[k]} /></small></td>)}
              </tr>)}
              <tr><th>Modeled constraints</th>
                {Object.entries(r.plans).map(([name, p]) => <td key={name}>{p.accepted ? "MET" : "VIOLATED"}</td>)}
              </tr>
              <tr><th>Stress cases acceptable</th>
                {Object.keys(r.plans).map(name => <td key={name}>{r.robustness[name].acceptable}/{r.robustness[name].total}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">Deltas are relative to PLAN 0. All values are calculated synthetic estimates.</p>
      </>);
    }

    if (page === "echo") return <>
      <Graph graph={scenario.graph} echoes={r.simulation.echoes} />
      {panel("⚠ INTERVENTION ECHO · calculated propagation", (
        <div className="echo-chain">{r.simulation.echoes.map((e, i) => (
          <article key={i}><strong>{e.source} → {e.target}</strong>
            <p>{e.label}</p><Evidence value={e.value} /> {e.unit}</article>
        ))}</div>
      ))}
      {panel("Consequence Council", <Evidence value={r.simulation.consequence_council} />)}
      {panel("Connectivity and phantom islands", <Evidence value={r.simulation.metrics.route ?? {
        scope: "Heat-Water uses dependency analysis rather than road connectivity" }} />)}
    </>;

    if (page === "safety") return <>
      {panel("Server-side safety gate · modeled constraints only", <>
        <span className={`badge ${r.safety.allowed && !stale ? "" : "danger"}`}>
          {r.safety.allowed && !stale ? "ALL MODELED CHECKS PASS" : "ACTION BLOCKED"}</span>
        {stale && <p className="warning">State or knowledge changed. Re-simulate before authorization.</p>}
        <p className="muted">Enforced on the server; the interface cannot bypass it. Passing means the plan meets these modeled
          constraints — never that it is safe in the real world. Approval authorizes a simulated action only.</p>
        <Checks checks={r.safety.checks} />
        <div className="actions"><Link className="linkbtn" to="/echo-flow/human">HUMAN DECISION →</Link>
          <Link className="linkbtn" to="/echo-flow/challenge">VERIFY MISSING MEASUREMENT →</Link></div>
      </>)}
      {panel("Stress-case acceptance (equally weighted demo cases, not probabilities)", (
        <div className="table-scroll"><table className="compact"><thead><tr><th>Plan</th><th>Acceptable</th></tr></thead>
          <tbody>{Object.entries(r.robustness).map(([n, v]) => <tr key={n}><th>{n}</th><td>{v.acceptable}/{v.total}</td></tr>)}</tbody></table></div>
      ))}
    </>;

    if (page === "challenge") return <>
      <div className="two-columns">
        {panel("Red Team · how can the proposal fail?", <Evidence value={r.red_team} />)}
        {panel("Value of Information", <Evidence value={r.voi} />)}
      </div>
      {panel("Verify the missing measurement", <>
        <p>{scenario.unknown.name} · interval [{scenario.unknown.low.toFixed(2)}, {scenario.unknown.high.toFixed(2)}]
          {scenario.unknown.verified ? " · VERIFIED (synthetic)" : " · UNVERIFIED"}</p>
        <p>This action reads a controlled synthetic fixture, not a real sensor.</p>
        <button disabled={!!busy} onClick={() => mutate("verify", { confirm_synthetic_measurement: true },
          "Recording explicitly synthetic verification")}>VERIFY SYNTHETIC MEASUREMENT</button>
        <button className="secondary" disabled={!!busy} onClick={() => run()}>RUN AGAIN</button>
      </>)}
      {panel("Model doubt", <Evidence value={r.model_doubt} />)}
    </>;

    if (page === "impact") return panel("Impact + economic ledger + equity guardrail", <>
      <div className="table-scroll"><table>
        <thead><tr><th>Plan</th><th>Affected population</th><th>Vulnerable exposure</th><th>Damage (INR, simulated)</th><th>Resource cost (INR)</th><th>Equity</th></tr></thead>
        <tbody>{Object.entries(r.plans).map(([name, p]) => {
          const eq = p.checks.find(c => c.name === "Equity");
          return <tr key={name}>
            <th>{name}</th>
            <td><Evidence value={p.metrics.affected_population} /></td>
            <td><Evidence value={p.metrics.vulnerable_exposure} /></td>
            <td><Evidence value={p.metrics.damage_estimate_inr} /></td>
            <td><Evidence value={p.metrics.resource_cost_inr} /></td>
            <td>{eq?.pass ? "WITHIN LIMIT" : "EQUITY CONSTRAINT VIOLATED"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="muted">SIMULATED ESTIMATE — synthetic coefficients, not real damage data.</p>
    </>);

    if (page === "analysis") return <>
      {[
        ["Minimum necessary intervention", r.minimum_intervention],
        ["Chronos · temporal sequences", r.chronos],
        ["Recovery trajectory", r.recovery],
        ["Critical breakpoint intervals", r.breakpoint],
        ["Structural linchpins", r.linchpins],
      ].map(([title, value]) => (
        <section className="panel" key={String(title)}><h2>{String(title)}</h2><Evidence value={value} /></section>
      ))}
    </>;

    if (page === "human") return <>
      <section className="human-gate">
        <span className="eyebrow">HUMAN COMMAND · SIMULATION ONLY</span>
        <h1>{r.safety.allowed && !stale ? "Review. Then authorize." : "ACTION BLOCKED"}</h1>
        <h2>{r.selected_plan}</h2>
        {stale && <p className="warning">State or knowledge changed. Re-simulate before authorization.</p>}
        <Checks checks={r.safety.checks} />
        <div className="actions">
          <button disabled={!!busy || stale || !r.safety.allowed || !!r.rejected || !!r.executed}
            onClick={() => {
              if (window.confirm("Authorize this SIMULATED action? No real infrastructure will be controlled.")) {
                void mutate("human-decision", { run_id: r.id, decision: "approve", confirmed: true, reason }, "Recording human approval");
              }
            }}>APPROVE</button>
          <button className="danger-button" disabled={!!busy || stale || !reason.trim()}
            onClick={() => mutate("human-decision", { run_id: r.id, decision: "reject", reason }, "Recording rejection")}>REJECT</button>
          <button className="secondary" disabled={!!busy || scenario.approval?.run_id !== r.id}
            onClick={() => mutate("execute", { run_id: r.id }, "Executing simulated action")}>EXECUTE SIMULATED ACTION</button>
        </div>
        <label>Decision reason
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} placeholder="Required for rejection" />
        </label>
      </section>
      {panel("Modify intervention · forces a new analysis", <>
        <div className="form-grid">
          <label>Pump
            <select value={form.pump} onChange={e => setForm({ ...form, pump: Number(e.target.value) })}>
              {(scenario.state.mode === "heat" ? [0, .4, .5, .6, .8, 1] : [0, .4, .6, .8, 1])
                .map(v => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
            </select>
          </label>
          {scenario.state.mode === "flood" ? <>
            <label>Buffer
              <select value={form.buffer ?? ""} onChange={e => setForm({ ...form, buffer: (e.target.value || null) as Intervention["buffer"] })}>
                <option value="">None</option><option>B5</option><option>B6</option>
              </select>
            </label>
            {(["gate_open", "road_closed", "clear_drain"] as const).map(key => (
              <label key={key}>
                <input type="checkbox" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} />
                {key.replaceAll("_", " ")}
              </label>
            ))}
          </> : <>
            <label>Noncritical shedding fraction
              <input type="number" min={0} max={.5} step={.05} value={form.noncritical_shed}
                onChange={e => setForm({ ...form, noncritical_shed: Number(e.target.value) })} />
            </label>
            <label><input type="checkbox" checked={form.priority_power}
              onChange={e => setForm({ ...form, priority_power: e.target.checked })} /> Priority power allocation</label>
          </>}
        </div>
        <button disabled={!!busy || stale} onClick={() => mutate("human-decision",
          { run_id: r.id, decision: "modify", intervention: form, reason }, "Re-evaluating human modification")}>
          MODIFY + RE-SIMULATE</button>
      </>)}
    </>;

    if (page === "result") return <>
      {panel("Action result", <Evidence value={scenario.action_result ?? { status: "No simulated action has been executed" }} />)}
      {panel("Current observed synthetic state", <Evidence value={scenario.state} />)}
      {panel("Decision evolution", <Evidence value={scenario.learning} />)}
      <button disabled={!!busy} onClick={() => run()}>RE-SIMULATE NEW STATE</button>
    </>;

    if (page === "audit") return panel("Inspectable audit trail", (
      <div className="timeline">
        <AuditVerify scenario={scenario} token={token} />
        {scenario.audit.map(event => (
          <article key={event.id}>
            <time>{new Date(event.timestamp).toLocaleString()}</time>
            <h3>{event.name}</h3>
            <p>{event.source}</p>
            <small>{event.data_reference}</small>
            <details><summary>Event evidence</summary><Evidence value={event.data} /></details>
          </article>
        ))}
      </div>
    ));

    return panel("Screen not found", <Link to="/echo-flow/command">Return to the Command Center</Link>);
  }

  if (!inApp) return <Navigate to="/echo-flow/command" replace />;

  const mapLabel = mapPhase === "READY" ? "MAP LOADED · AMAZON LOCATION"
    : mapPhase === "FAILED" ? "MAP FAILED"
    : mapPhase === "NOT_CONFIGURED" ? "MAP NOT CONNECTED"
    : page === "command" ? "MAP LOADING" : "MAP NOT LOADED";
  const mapTone = mapPhase === "READY" ? "ok" : mapPhase === "LOADING" ? "idle" : "bad";
  const freshness = liveCtx ? `LIVE EVIDENCE · FETCHED ${new Date(liveCtx.fetched_at).toLocaleTimeString()}` : "LIVE EVIDENCE · NOT FETCHED";

  return (
    <div className={`app-shell${page === "command" ? " is-command" : ""}`}>
      <header className="topbar">
        <Link to="/echo-flow/command" className="brand" aria-label="ECHO-FLOW Command Center">
          ECHO<span>—</span>FLOW<small>FLOOD &amp; EMERGENCY DECISION INTELLIGENCE</small></Link>
        <div className="chips" aria-label="System status">
          <span className="chip mode" title="No command is ever sent to real infrastructure">SIMULATION MODE</span>
          <span className={`chip ${stale ? "warn" : ""}`}>{scenario
            ? `${scenario.state.mode === "flood" ? "FLOOD" : "HEAT–WATER"} · SYNTHETIC · REV ${scenario.state_revision}${stale ? " · RUN STALE" : ""}`
            : "NO SCENARIO"}</span>
          <span className="chip">{freshness}</span>
          <span className={`chip ${health ? "ok" : "bad"}`}>{health ? "BACKEND ONLINE" : "BACKEND UNAVAILABLE"}</span>
          <span className={`chip ${mapTone}`}>{mapLabel}</span>
        </div>
        <div className="segmented scenario-switch" role="group" aria-label="Scenario">
          <button aria-pressed={scenario?.state.mode === "flood"} disabled={!!busy} onClick={() => load("flood", "/echo-flow/command")}>FLOOD</button>
          <button aria-pressed={scenario?.state.mode === "heat"} disabled={!!busy} onClick={() => load("heat", "/echo-flow/command")}>HEAT–WATER</button>
        </div>
      </header>
      <aside className="rail">
        <nav aria-label="Decision workspace">
          {primaryPages.map(([path, label]) => <NavLink key={path} to={`/echo-flow/${path}`}>{label}</NavLink>)}
          <span className="rail-sep">ANALYSIS</span>
          {secondaryPages.map(([path, label]) => <NavLink key={path} to={`/echo-flow/${path}`}>{label}</NavLink>)}
        </nav>
        <div className="rail-footer">
          <details className="connection">
            <summary>Connection</summary>
            <p>{health ? `AWS: ${String(health.aws)}` : "API UNAVAILABLE · AWS STATUS UNKNOWN"}</p>
            <label>Cognito JWT · held in memory only
              <input type="password" value={token} autoComplete="off" onChange={e => setToken(e.target.value)} />
            </label>
            <p>Not needed in loopback-only local demo mode.</p>
          </details>
          <small>AI explains. Deterministic models calculate. Humans authorize. Uncalibrated synthetic demonstration — not operational guidance.</small>
        </div>
      </aside>
      <main>
        {error && <div className="error" role="alert">
          <strong>Operation not confirmed</strong><p>{error}</p>
          {scenario && <button onClick={() => job("Reloading scenario", async () => {
            setScenario(await request<Scenario>(`/scenarios/${scenario.id}`, undefined, token));
          })}>RELOAD SCENARIO</button>}
          <button className="secondary" onClick={() => setError("")}>DISMISS</button>
        </div>}
        {busy && <div className="working" role="status">{busy}…</div>}
        {scenario && <div className="workspace-bar">
          <div><span className="eyebrow">{scenario.metadata.name}</span>
            <p>State revision {scenario.state_revision} · Knowledge revision {scenario.knowledge_revision}</p>
          </div>
          <button disabled={!!busy} onClick={() => run()}>RUN DECISION</button>
        </div>}
        {renderPage()}
      </main>
    </div>
  );
}
