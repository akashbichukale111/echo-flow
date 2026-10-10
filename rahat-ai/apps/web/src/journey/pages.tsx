import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useJ } from "./ctx";
import JourneyMap, { POI_COLOR, type MapLayers } from "./JourneyMap";
import type { JPOI, JReq, JRoute, NeedResult, Place } from "./jtypes";
import { HEAT_COLOR, metricsOf } from "./jtypes";
import { Badge, Card, Empty, ErrorBox, HeatChip, Loading, Stat, WhatChanged, dist, f, sign } from "./ui";

const Rider3D = lazy(() => import("./Rider3D"));
const NEED_ICON: Record<string, string> = {
  WATER: "💧", SHADE: "🌳", REST: "🪑", COOLING: "❄", "PUBLIC FACILITY": "🚻", EMERGENCY: "🚨",
  HOSPITAL: "✚", FUEL: "⛽", FOOD: "🍴", TRANSIT: "🚇", "ESSENTIAL SERVICES": "🛒",
};

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function hasWebGL() {
  try { return !!document.createElement("canvas").getContext("webgl2")
    || !!document.createElement("canvas").getContext("webgl"); } catch { return false; }
}
function Stage({ scene, go = false }: { scene: "hero" | "choice"; go?: boolean }) {
  const fb = <div className={`stage2d ${scene}`} role="img"
    aria-label="Illustration of a rider about to travel. 3D unavailable, showing 2D fallback.">
    <div className="sun2d" /><div className="road2d" /><div className="rider2d">🏍</div>
  </div>;
  if (!hasWebGL()) return fb;
  return <Boundary fallback={fb}><Suspense fallback={fb}><Rider3D scene={scene} go={go} /></Suspense></Boundary>;
}

function useLayers(initial?: Partial<MapLayers>) {
  return useState<MapLayers>({ thermal: true, shade: true, relief: true, alternatives: true, ...initial });
}
function Toggles({ layers, set }: { layers: MapLayers; set: (l: MapLayers) => void }) {
  return <div className="toggles" role="group" aria-label="Map layers">
    {(["thermal", "shade", "relief", "alternatives"] as const).map(k =>
      <button key={k} aria-pressed={layers[k]} onClick={() => set({ ...layers, [k]: !layers[k] })}>
        {k === "alternatives" ? "Other routes" : k[0].toUpperCase() + k.slice(1)}</button>)}
  </div>;
}
function Legend() {
  return <div className="legend" aria-label="Thermal classes">
    {(["LOW", "MODERATE", "ELEVATED", "HIGH"] as const).map(c =>
      <span key={c}><i style={{ background: HEAT_COLOR[c] }} />{c}</span>)}
    <span className="muted">Estimated thermal load · MODEL ESTIMATE</span>
  </div>;
}

function Gate({ children }: { children: (p: NonNullable<ReturnType<typeof useJ>["plan"]>) => ReactNode }) {
  const j = useJ();
  if (j.error && !j.plan) return <ErrorBox message={j.error} retry={j.retry} />;
  if (!j.plan) return <Loading text="Finding routes…" />;
  return <>
    {j.loading && <div className="reloading" role="status">Analysing thermal exposure…</div>}
    {j.error && <ErrorBox message={j.error} retry={j.retry} />}
    {children(j.plan)}
  </>;
}

export function why(routes: JRoute[], needs: string[]) {
  const fast = routes.find(r => r.id === "fastest"), rahat = routes.find(r => r.id === "rahat");
  if (!fast || !rahat) return "";
  if (rahat.same_geometry_as === "fastest") {
    return "For these inputs the fastest path is also the lowest-exposure path the engine found within your detour allowance.";
  }
  const d = rahat.delta_vs_fastest;
  const n = needs.length ? ` Your selected needs (${needs.join(", ").toLowerCase()}) were weighed in the relief score.` : "";
  return `RAHAT's estimated thermal exposure is ${f(Math.abs(d.load_pct), 0)}% ${d.load_pct <= 0 ? "lower" : "higher"} than the fastest route `
    + `for ${sign(d.minutes)} min and ${sign(d.distance, 0)} m, with ${f(rahat.shade * 100, 0)}% estimated shade `
    + `(fastest: ${f(fast.shade * 100, 0)}%) and ${rahat.relief_count} relief point${rahat.relief_count === 1 ? "" : "s"} on route `
    + `(fastest: ${fast.relief_count}).${n}`;
}

function Corridor({ route }: { route: JRoute }) {
  const j = useJ();
  const stages = route.corridor.stages;
  if (!stages.length) return <p className="muted">No relief points lie on this route.</p>;
  return <ol className="corridor-chain" aria-label="RAHAT relief corridor">
    {stages.map((s, i) => <li key={s.poi + i}>
      <span className="ck">{s.kinds.map(k => k).join(" + ")}</span>
      <small>{s.name}</small>
      <small className="muted">{j.boot.map.nodes[s.node].name}</small>
    </li>)}
    <li className="dest"><span className="ck">DESTINATION</span></li>
  </ol>;
}

function SegmentInspector() {
  const { segment, seg, setSeg } = useJ();
  if (!segment || !seg) return <Empty title="Click any road segment" text="Tap a coloured segment on the map or timeline to see why its thermal load is what it is." />;
  return <div className="inspector">
    <header><h3>SEGMENT DETAILS</h3><HeatChip cls={segment.heat_class} /></header>
    <p>{segment.explanation}</p>
    <dl>
      <div><dt>Thermal load</dt><dd>{f(segment.load)} u</dd></div>
      <div><dt>Solar exposure index</dt><dd>{f(segment.solar_exposure, 2)}</dd></div>
      <div><dt>Shade estimate</dt><dd>{f(segment.shade * 100, 0)}%</dd></div>
      <div><dt>Duration</dt><dd>{f(segment.minutes)} min</dd></div>
      <div><dt>Traffic / delay</dt><dd>{f(segment.delay_minutes)} min</dd></div>
      <div><dt>Nearby relief</dt><dd>{segment.nearby_relief
        ? `${segment.nearby_relief.name} · ${dist(segment.nearby_relief.distance_m)}` : "None"}</dd></div>
      <div><dt>Confidence</dt><dd>Low · uncalibrated</dd></div>
      <div><dt>Source · time</dt><dd>{segment.source} · {segment.timestamp.slice(11, 16)}</dd></div>
    </dl>
    <button onClick={() => setSeg(null)}>Close details</button>
  </div>;
}

function RouteCards({ compact = false }: { compact?: boolean }) {
  const j = useJ();
  if (!j.plan) return null;
  return <div className={`rcards ${compact ? "compact" : ""}`}>
    {j.plan.routes.filter(r => r.id !== "balanced" || !r.same_geometry_as).map(r =>
      <button key={r.id} className={`rcard ${r.id} ${j.selected === r.id ? "sel" : ""}`}
        aria-pressed={j.selected === r.id} onClick={() => j.select(r.id)}>
        <span className="eyebrow">{r.label}{r.same_geometry_as ? ` · same path as ${r.same_geometry_as}` : ""}</span>
        <strong>{f(r.minutes)}<small> min</small></strong>
        <dl>
          <div><dt>Distance</dt><dd>{dist(r.distance)}</dd></div>
          <div><dt>Est. thermal exposure</dt><dd>{f(r.load)} u</dd></div>
          <div><dt>Est. shade</dt><dd>{f(r.shade * 100, 0)}%</dd></div>
          <div><dt>Water · rest · cooling</dt><dd>{r.water_on_route} · {r.rest_on_route} · {r.cooling_on_route}</dd></div>
          <div><dt>Relief on route</dt><dd>{r.relief_count}</dd></div>
          <div><dt>Detour</dt><dd>{sign(r.detour_minutes)} min</dd></div>
        </dl>
        <div className="classbar" aria-label="Thermal class mix">
          {(["LOW", "MODERATE", "ELEVATED", "HIGH"] as const).map(c => r.classes[c] > 0 &&
            <i key={c} style={{ flex: r.classes[c], background: HEAT_COLOR[c] }} title={`${c}: ${r.classes[c]} segments`} />)}
        </div>
        <small className="muted">MODEL ESTIMATE · confidence low</small>
      </button>)}
  </div>;
}

/* ---------------- Start / planner ---------------- */
type Target = "add" | "origin" | "destination" | number;
function AddStopDialog({ target, onClose, label }: {
  target: Target; onClose: () => void; label: (n: number, l: string) => void;
}) {
  const j = useJ();
  const [tab, setTab] = useState<"search" | "map">("search");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Place[] | null>(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      api<{ items: Place[] }>(`/journey/search?q=${encodeURIComponent(q)}`, undefined, c.signal)
        .then(r => { setItems(r.items); setErr(""); })
        .catch(e => { if (e.name !== "AbortError") setErr("Search is unavailable right now."); });
    }, 180);
    return () => { clearTimeout(t); c.abort(); };
  }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const commit = (node: number, name: string) => {
    if (target === "origin") j.setReq({ origin: node });
    else if (target === "destination") j.setReq({ destination: node });
    else if (target === "add") j.setReq({ waypoints: [...j.req.waypoints, { node }] });
    else j.setReq({ waypoints: j.req.waypoints.map((w, i) => (i === target ? { node } : w)) });
    label(node, name);
    onClose();
  };
  const node = picked !== null ? j.boot.map.nodes[picked] : null;
  const near = node ? j.boot.relief.map(p => ({
    p, d: Math.hypot(j.boot.map.nodes[p.node].x - node.x, j.boot.map.nodes[p.node].y - node.y),
  })).sort((a, b) => a.d - b.d)[0] : null;
  const title = target === "add" ? "ADD NEXT STOP" : target === "origin" ? "EDIT START"
    : target === "destination" ? "EDIT DESTINATION" : "EDIT STOP";
  return <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
    <div className="sheet">
      <header><h2>{title}</h2><button aria-label="Close" onClick={onClose}>×</button></header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "search"} onClick={() => setTab("search")}>SEARCH</button>
        <button role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>SELECT ON MAP</button>
      </div>
      {tab === "search" ? <>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} maxLength={60}
          placeholder="Search any place in India…" aria-label="Search places" />
        <p className="muted">Demo mode searches a small Delhi list. A real geocoder plugs in here for any Indian location. <Badge kind="DEMO DATA" /></p>
        {err && <ErrorBox message={err} />}
        {!items ? <Loading text="Searching…" /> : items.length === 0
          ? <Empty title="No demo match" text="Try India Gate, Connaught Place, Janpath, AIIMS or Mandi House." />
          : <ul className="results">{items.map(p => <li key={p.name}>
            <button disabled={!p.inside_demo_coverage}
              onClick={() => p.node !== null && commit(p.node, p.name)}>
              <b>{p.name}</b>
              <small>{p.inside_demo_coverage
                ? `Snaps to ${j.boot.map.nodes[p.node as number].name}, ${dist(p.snapped_distance_m ?? 0)} away`
                : p.note}</small>
            </button></li>)}</ul>}
        <div className="chips">{["India Gate", "Connaught Place", "Janpath", "Mandi House"].map(s =>
          <button key={s} onClick={() => setQ(s)}>{s}</button>)}</div>
      </> : <>
        <div className="pickmap">
          <JourneyMap map={j.boot.map} routes={j.plan?.routes ?? []} selected="rahat" pois={j.boot.relief}
            layers={{ thermal: true, shade: false, relief: true, alternatives: false }}
            waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination}
            pick onNode={setPicked} label="Select a point on the demo map" />
        </div>
        {node ? <div className="ctxinfo">
          <b>{node.name}</b>
          <small>{node.lat.toFixed(5)}, {node.lon.toFixed(5)} · USER INPUT · demo junction</small>
          {near && <small>Nearest demo relief: {near.p.name}, about {dist(near.d)}.</small>}
          <button className="primary" onClick={() => commit(node.id, node.name)}>Confirm this point</button>
        </div> : <p className="muted">Tap a dot on the map to see what is there.</p>}
      </>}
    </div>
  </div>;
}

export function StartPage() {
  const j = useJ();
  const nav = useNavigate();
  const [target, setTarget] = useState<Target | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const name = (n: number) => labels[n] ?? j.boot.map.nodes[n]?.name ?? `Node ${n}`;
  const swap = () => j.setReq({ origin: j.req.destination, destination: j.req.origin });
  const move = (i: number, d: -1 | 1) => {
    const w = [...j.req.waypoints]; const k = i + d;
    if (k < 0 || k >= w.length) return;
    [w[i], w[k]] = [w[k], w[i]]; j.setReq({ waypoints: w });
  };
  const toggleNeed = (n: string) => j.setReq({
    needs: j.req.needs.includes(n) ? j.req.needs.filter(x => x !== n) : [...j.req.needs, n],
  });
  const same = j.req.origin === j.req.destination;
  return <div className="split">
    <div className="col">
      <span className="eyebrow">START JOURNEY</span>
      <h1>YOUR JOURNEY</h1>
      <Card>
        <ol className="stops">
          <li><span className="dot start" /><div><small>START</small><b>{name(j.req.origin)}</b></div>
            <div className="acts"><button onClick={() => setTarget("origin")} aria-label="Edit start">Edit</button></div></li>
          {j.req.waypoints.map((w, i) => <li key={`${w.node}-${i}`}><span className="dot wp">{i + 1}</span>
            <div><small>STOP {i + 1}</small><b>{name(w.node)}</b></div>
            <div className="acts">
              <button aria-label="Move stop up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button aria-label="Move stop down" disabled={i === j.req.waypoints.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button onClick={() => setTarget(i)}>Edit</button>
              <button aria-label={`Remove stop ${i + 1}`}
                onClick={() => j.setReq({ waypoints: j.req.waypoints.filter((_, k) => k !== i) })}>Remove</button>
            </div></li>)}
          <li><span className="dot dest" /><div><small>DESTINATION</small><b>{name(j.req.destination)}</b></div>
            <div className="acts"><button onClick={() => setTarget("destination")} aria-label="Edit destination">Edit</button></div></li>
        </ol>
        <div className="row">
          <button className="addstop" disabled={j.req.waypoints.length >= 5} onClick={() => setTarget("add")}>+ ADD NEXT STOP</button>
          <button onClick={swap}>⇅ Swap start and destination</button>
        </div>
        {same && <ErrorBox message="Start and destination are the same place. Pick a different destination." />}
      </Card>
      <Card title="WHAT DO YOU NEED ON THE WAY?" tag="USER INPUT">
        <div className="needs" role="group" aria-label="Needs on the way">
          {j.boot.needs.map(n => <button key={n} aria-pressed={j.req.needs.includes(n)} onClick={() => toggleNeed(n)}>
            <span aria-hidden="true">{NEED_ICON[n]}</span> {n}</button>)}
        </div>
        <p className="muted">Needs are soft preferences. They raise the score of routes passing matching relief points and change the RELIEF PRIORITY path.</p>
      </Card>
      <Card title="How you travel">
        <div className="form-row">
          <label>Mode<select value={j.req.travel_mode} onChange={e => j.setReq({ travel_mode: e.target.value as JReq["travel_mode"] })}>
            <option value="rider">Bike / motorcycle</option><option value="cycle">Cycle</option><option value="walk">Walk</option></select></label>
          <label>Departure<select value={j.req.departure.slice(11, 16)}
            onChange={e => j.setReq({ departure: `2026-05-15T${e.target.value}:00+05:30` })}>
            {["10:00", "12:00", "14:00", "16:00", "18:00"].map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Max detour {j.req.max_detour_pct}%
            <input type="range" min={0} max={150} step={10} value={j.req.max_detour_pct}
              onChange={e => j.setReq({ max_detour_pct: +e.target.value })} /></label>
        </div>
      </Card>
      <div className="row sticky-cta">
        <button className="primary big" disabled={same || !j.plan} onClick={() => nav("/journey/choice")}>
          SEE THE HEAT CHOICE</button>
        <button disabled={same || !j.plan} onClick={() => nav("/journey/route")}>Go to route planner</button>
      </div>
    </div>
    <div className="col map">
      <Gate>{plan => <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected} pois={j.boot.relief}
        layers={{ thermal: true, shade: true, relief: true, alternatives: true }}
        waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination} />}</Gate>
    </div>
    {target !== null && <AddStopDialog target={target} onClose={() => setTarget(null)}
      label={(n, l) => setLabels(s => ({ ...s, [n]: l }))} />}
  </div>;
}

/* ---------------- Heat choice ---------------- */
export function ChoicePage() {
  const nav = useNavigate();
  const j = useJ();
  return <Gate>{plan => {
    const fast = plan.routes.find(r => r.id === "fastest")!, rahat = plan.routes.find(r => r.id === "rahat")!;
    const hi = (r: JRoute) => r.classes.HIGH + r.classes.ELEVATED;
    return <section className="choice">
      <div className="choice-stage"><Stage scene="choice" /></div>
      <div className="choice-top">
        <div><span className="eyebrow">FASTEST WAY</span><b>{f(fast.minutes)} min</b><small>{dist(fast.distance)} · {f(fast.load)} u</small></div>
        <span className="vs">vs</span>
        <div className="g"><span className="eyebrow">RAHAT WAY</span><b>{f(rahat.minutes)} min</b><small>{dist(rahat.distance)} · {f(rahat.load)} u</small></div>
      </div>
      <aside className="choice-card hot">
        <h2>HIGH HEAT / HIGH EXPOSURE</h2>
        <p className="muted">Sun-exposed concrete, traffic, less shade, limited relief. Fastest route.</p>
        <dl>
          <div><dt>Estimated thermal exposure</dt><dd>{f(fast.load)} u</dd></div>
          <div><dt>Est. shade</dt><dd>{f(fast.shade * 100, 0)}%</dd></div>
          <div><dt>Elevated or high segments</dt><dd>{hi(fast)} of {fast.segments.length}</dd></div>
          <div><dt>Water points</dt><dd>{fast.water_on_route}</dd></div>
          <div><dt>Relief points</dt><dd>{fast.relief_count}</dd></div>
        </dl>
      </aside>
      <aside className="choice-card cool">
        <h2>RAHAT CORRIDOR</h2>
        <p className="muted">Trees, building shadow, water, rest and cooling where the engine found them.</p>
        <dl>
          <div><dt>Estimated thermal exposure</dt><dd>{f(rahat.load)} u <small>({sign(rahat.delta_vs_fastest.load_pct, 0)}%)</small></dd></div>
          <div><dt>Est. shade</dt><dd>{f(rahat.shade * 100, 0)}%</dd></div>
          <div><dt>Elevated or high segments</dt><dd>{hi(rahat)} of {rahat.segments.length}</dd></div>
          <div><dt>Water points</dt><dd>{rahat.water_on_route}</dd></div>
          <div><dt>Relief points</dt><dd>{rahat.relief_count}</dd></div>
        </dl>
      </aside>
      <div className="choice-foot">
        <p>{why(plan.routes, j.req.needs)}</p>
        <div className="row"><Badge kind="DEMO DATA" /><Badge kind="MODEL ESTIMATE" />
          <button className="primary big" onClick={() => { j.select("rahat"); nav("/journey/route"); }}>CHOOSE THE RAHAT WAY</button>
          <button onClick={() => { j.select("fastest"); nav("/journey/route"); }}>Compare all routes</button></div>
      </div>
    </section>;
  }}</Gate>;
}

/* ---------------- Route planner ---------------- */
export function RoutePage() {
  const j = useJ();
  const nav = useNavigate();
  const [layers, setLayers] = useLayers();
  const [poi, setPoi] = useState<JPOI | null>(null);
  return <Gate>{plan => {
    const r = j.route ?? plan.routes[0];
    return <div className="split">
      <div className="col">
        <span className="eyebrow">ROUTE PLANNER</span>
        <h1>Choose how to cross the heat</h1>
        <RouteCards />
        <Card title="RAHAT RELIEF CORRIDOR" tag="MODEL ESTIMATE">
          <Corridor route={r} />
          <p>{why(plan.routes, j.req.needs)}</p>
        </Card>
        <SegmentInspector />
        <div className="row sticky-cta">
          <button className="primary big" onClick={() => { j.startLive(); nav("/journey/live"); }}>START JOURNEY</button>
          <button onClick={() => j.openNeed(j.req.origin)}>I NEED RAHAT</button>
        </div>
      </div>
      <div className="col map">
        <Toggles layers={layers} set={setLayers} />
        <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected} pois={j.boot.relief} layers={layers}
          waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination}
          closed={j.req.closed_relief} highlight={poi?.id}
          focusSegment={j.seg ? { route: j.seg.route.id, index: j.seg.index } : null}
          onSegment={(rt, i) => j.setSeg({ route: rt, index: i })} onPOI={setPoi} />
        <Legend />
        {poi && <PoiCard poi={poi} onClose={() => setPoi(null)} />}
      </div>
    </div>;
  }}</Gate>;
}
function PoiCard({ poi, onClose }: { poi: JPOI; onClose: () => void }) {
  return <div className="poicard" role="dialog" aria-label={poi.name}>
    <header><b>{poi.name}</b><button aria-label="Close" onClick={onClose}>×</button></header>
    <div className="row"><Badge kind={poi.source} /><Badge kind="UNVERIFIED" /></div>
    <dl>
      <div><dt>Type</dt><dd>{poi.type}</dd></div>
      <div><dt>Status</dt><dd>{poi.status} · {poi.availability}</dd></div>
      <div><dt>Coordinates</dt><dd>{poi.lat.toFixed(5)}, {poi.lon.toFixed(5)}</dd></div>
      <div><dt>Offers</dt><dd>{poi.tags.join(", ").toLowerCase()}</dd></div>
      <div><dt>Confidence</dt><dd>{poi.confidence}</dd></div>
      <div><dt>Verification</dt><dd>{poi.verification}</dd></div>
    </dl>
  </div>;
}

/* ---------------- Thermal map ---------------- */
export function ThermalPage() {
  const j = useJ();
  const [layers, setLayers] = useLayers();
  return <Gate>{plan => <div className="split">
    <div className="col">
      <span className="eyebrow">THERMAL MAP</span><h1>Road heat score</h1>
      <p className="muted">Every segment is LOW, MODERATE, ELEVATED or HIGH estimated thermal load. These are
        thresholds on a model index, not temperatures people feel.</p>
      <Card title="Conditions" tag="DEMO DATA">
        <div className="stats">
          <Stat label="Temperature" value={`${f(plan.weather.temperature_c)} °C`} sub={plan.weather.source} />
          <Stat label="Sun elevation" value={`${f(plan.sun.elevation, 0)}°`} sub="MODEL ESTIMATE" />
          <Stat label="Sun azimuth" value={`${f(plan.sun.azimuth, 0)}°`} />
        </div>
        <label className="switch"><input type="checkbox" checked={j.req.heatwave}
          onChange={e => j.setReq({ heatwave: e.target.checked })} />
          HEATWAVE MODE scenario (+4 °C demo offset; threshold {plan.heatwave.threshold_c} °C is illustrative)</label>
      </Card>
      <Card title="Selected route classes">
        <div className="classes">{(["LOW", "MODERATE", "ELEVATED", "HIGH"] as const).map(c =>
          <div key={c}><i style={{ background: HEAT_COLOR[c] }} /><b>{(j.route ?? plan.routes[0]).classes[c]}</b><small>{c}</small></div>)}</div>
      </Card>
      <RouteCards compact />
      <SegmentInspector />
    </div>
    <div className="col map">
      <Toggles layers={layers} set={setLayers} />
      <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected} pois={j.boot.relief} layers={layers}
        waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination}
        focusSegment={j.seg ? { route: j.seg.route.id, index: j.seg.index } : null}
        onSegment={(rt, i) => j.setSeg({ route: rt, index: i })} />
      <Legend />
    </div>
  </div>}</Gate>;
}

/* ---------------- Exposure ---------------- */
function Timeline({ route }: { route: JRoute }) {
  const j = useJ();
  const total = route.segments.reduce((s, e) => s + e.minutes, 0);
  return <div>
    <div className="timeline" role="list" aria-label="Journey heat timeline">
      {route.segments.map((s, i) => <button key={i} role="listitem" style={{ flex: s.minutes / total, background: HEAT_COLOR[s.heat_class] }}
        aria-label={`Segment ${i + 1}: ${s.heat_class}`} className={j.seg?.index === i && j.seg.route.id === route.id ? "on" : ""}
        onClick={() => j.setSeg({ route, index: i })} />)}
    </div>
    <div className="tl-ends"><span>START</span><span>DESTINATION</span></div>
  </div>;
}
export function ExposurePage() {
  const j = useJ();
  return <Gate>{plan => {
    const r = j.route ?? plan.routes[0];
    const keys = Object.keys(r.breakdown);
    const maxAbs = Math.max(...plan.routes.flatMap(x => Object.values(x.breakdown).map(Math.abs)), 1);
    return <div className="stack">
      <span className="eyebrow">EXPOSURE</span><h1>Where the exposure comes from</h1>
      <p className="muted">Estimated thermal exposure in illustrative units. Not body temperature, not a health prediction. <Badge kind="MODEL ESTIMATE" /></p>
      <RouteCards compact />
      <Card title={`${r.label}: journey heat timeline`}>
        <Timeline route={r} />
        <SegmentInspector />
      </Card>
      <Card title="Exposure breakdown by route">
        {keys.map(k => <div key={k} className="bars"><span>{k}</span>
          <div>{plan.routes.filter(x => x.id !== "balanced").map(x => {
            const v = x.breakdown[k] ?? 0;
            return <div key={x.id} className="bar"><em>{x.label}</em>
              <i className={v < 0 ? "neg" : ""} style={{ width: `${Math.abs(v) / maxAbs * 100}%` }} />
              <b>{sign(v)} u</b></div>;
          })}</div></div>)}
        <p className="muted">Components reconcile to the route total (validator checks this on every plan).</p>
      </Card>
    </div>;
  }}</Gate>;
}

/* ---------------- Relief network + around me ---------------- */
export function ReliefPage() {
  const j = useJ();
  const [filter, setFilter] = useState("ALL");
  const [radius, setRadius] = useState(500);
  const [node, setNode] = useState(j.req.origin);
  const [around, setAround] = useState<{ items: (JPOI & { distance: number })[] } | null>(null);
  const [err, setErr] = useState("");
  const [poi, setPoi] = useState<JPOI | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const types = ["ALL", ...Array.from(new Set(j.boot.relief.map(p => p.type)))];
  const shown = j.boot.relief.filter(p => filter === "ALL" || p.type === filter);
  useEffect(() => {
    const c = new AbortController();
    setAround(null);
    api<{ items: (JPOI & { distance: number })[] }>(`/journey/around?node=${node}&radius_m=${radius}`, undefined, c.signal)
      .then(r => { setAround(r); setErr(""); })
      .catch(e => { if (e.name !== "AbortError") setErr(e instanceof Error ? e.message : "Could not load nearby relief."); });
    return () => c.abort();
  }, [node, radius]);
  const locate = () => {
    if (!navigator.geolocation) { setErr("Location is not available in this browser. Pick a point on the map instead."); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      api<{ node: number | null; inside_demo_coverage: boolean }>(
        `/journey/nearest-node?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`)
        .then(r => {
          if (r.node === null) setErr("You are outside the demo area, so your location was not used. Pick a point on the map.");
          else { setNode(r.node); setErr(""); }
        }).catch(() => setErr("Could not match your location to the demo map."));
    }, () => setErr("Location permission was not granted. You can pick a point on the map instead."),
    { timeout: 8000, maximumAge: 0 });
  };
  const layers: MapLayers = { thermal: false, shade: true, relief: true, alternatives: false };
  return <div className="split">
    <div className="col">
      <span className="eyebrow">RELIEF NETWORK</span><h1>Relief around you</h1>
      <div className="row"><button className="primary big" onClick={() => j.openNeed(node)}>I NEED RAHAT</button>
        <button onClick={locate}>Use my location</button>
        <button aria-pressed={pickMode} onClick={() => setPickMode(!pickMode)}>Select on map</button></div>
      <p className="muted">Location is only read when you press the button and is never stored. <b>{j.boot.map.nodes[node].name}</b></p>
      <Card title="AROUND ME">
        <div className="chips" role="group" aria-label="Radius">{[250, 500, 1000, 2000].map(r =>
          <button key={r} aria-pressed={radius === r} onClick={() => setRadius(r)}>{r >= 1000 ? `${r / 1000} km` : `${r} m`}</button>)}</div>
        {err && <ErrorBox message={err} />}
        {!around ? <Loading text="Finding nearby relief…" /> : around.items.length === 0
          ? <Empty title="Nothing within this radius" text="Widen the radius or pick another point." />
          : <ul className="plist">{around.items.map(p => <li key={p.id}><button onClick={() => setPoi(p)}>
            <i style={{ background: POI_COLOR[p.type] }} /><b>{p.name}</b><span>{p.type} · {dist(p.distance)}</span>
            <Badge kind="DEMO DATA" /></button></li>)}</ul>}
      </Card>
      <Card title="Relief network" tag="DEMO DATA">
        <div className="chips" role="group" aria-label="Type filter">{types.map(t =>
          <button key={t} aria-pressed={filter === t} onClick={() => setFilter(t)}>{t}</button>)}</div>
        <p className="muted">{shown.length} demo points. None are real facilities and none are verified.</p>
      </Card>
    </div>
    <div className="col map">
      <Gate>{plan => <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected}
        pois={shown} layers={layers} waypoints={[]} origin={node} destination={j.req.destination}
        closed={j.req.closed_relief} pick={pickMode} onNode={n => { setNode(n); setPickMode(false); }}
        onPOI={setPoi} highlight={poi?.id} />}</Gate>
      {poi && <PoiCard poi={poi} onClose={() => setPoi(null)} />}
    </div>
  </div>;
}

/* ---------------- Compare ---------------- */
export function ComparePage() {
  const j = useJ();
  return <Gate>{plan => {
    const rows: [string, (r: JRoute) => string][] = [
      ["Time", r => `${f(r.minutes)} min`], ["Distance", r => dist(r.distance)],
      ["Est. thermal exposure", r => `${f(r.load)} u`],
      ["vs fastest", r => (r.id === "fastest" ? "baseline" : `${sign(r.delta_vs_fastest.load_pct, 0)}% exposure · ${sign(r.delta_vs_fastest.minutes)} min`)],
      ["Est. shade", r => `${f(r.shade * 100, 0)}%`], ["Water on route", r => String(r.water_on_route)],
      ["Rest on route", r => String(r.rest_on_route)], ["Cooling on route", r => String(r.cooling_on_route)],
      ["Relief points", r => String(r.relief_count)], ["Detour", r => `${sign(r.detour_minutes)} min`],
      ["HIGH / ELEVATED segments", r => `${r.classes.HIGH} / ${r.classes.ELEVATED}`],
      ["Needs met", r => (j.req.needs.length ? j.req.needs.map(n => `${n.toLowerCase()} ${r.needs_coverage[n] ?? 0}`).join(", ") : "none chosen")],
      ["Confidence", () => "Low (uncalibrated)"],
    ];
    return <div className="stack">
      <span className="eyebrow">ROUTE COMPARISON</span><h1>Fastest vs RAHAT vs Relief Priority</h1>
      <div className="tablewrap"><table className="cmp">
        <thead><tr><th />{plan.routes.map(r => <th key={r.id} className={r.id === j.selected ? "sel" : ""}>
          <button aria-pressed={j.selected === r.id} onClick={() => j.select(r.id)}>{r.label}</button>
          {r.same_geometry_as && <small>same path as {r.same_geometry_as}</small>}</th>)}</tr></thead>
        <tbody>{rows.map(([label, fn]) => <tr key={label}><th scope="row">{label}</th>
          {plan.routes.map(r => <td key={r.id} className={r.id === j.selected ? "sel" : ""}>{fn(r)}</td>)}</tr>)}</tbody>
      </table></div>
      <Card title="In plain words"><p>{why(plan.routes, j.req.needs)}</p>
        <div className="row"><Badge kind="MODEL ESTIMATE" /><Badge kind="DEMO DATA" /><Badge kind="AI EXPLANATION" /></div>
        <p className="muted">This explanation is templated from engine numbers (deterministic). The AI badge appears only when a Bedrock adapter is enabled.</p></Card>
    </div>;
  }}</Gate>;
}

/* ---------------- Live journey ---------------- */
export function LivePage() {
  const j = useJ();
  const nav = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [layers, setLayers] = useLayers({ alternatives: false });
  const live = j.live;
  const pos = useMemo(() => {
    if (!live) return null;
    const s = live.route.segments[Math.min(live.seg, live.route.segments.length - 1)];
    const a = j.boot.map.nodes[s.a], b = j.boot.map.nodes[s.b];
    return { x: a.x + (b.x - a.x) * live.t, y: a.y + (b.y - a.y) * live.t };
  }, [live, j.boot.map.nodes]);
  if (!live) return <Empty title="No journey is active" text="Choose a route, then press START JOURNEY. This version runs a SIMULATED JOURNEY; real GPS is a future provider.">
    <div className="row"><button className="primary" onClick={() => nav("/journey/route")}>Choose a route</button></div></Empty>;
  const r = live.route;
  const s = r.segments[Math.min(live.seg, r.segments.length - 1)];
  const left = 1 - live.t;
  const remMin = r.segments.slice(live.seg).reduce((a, e, i) => a + e.minutes * (i === 0 ? left : 1), 0);
  const remDist = r.segments.slice(live.seg).reduce((a, e, i) => a + e.distance * (i === 0 ? left : 1), 0);
  const total = r.segments.reduce((a, e) => a + e.distance, 0);
  const progress = 1 - remDist / Math.max(total, 1);
  const ahead = r.corridor.stages.map(st => {
    const idx = r.nodes.indexOf(st.node);
    if (idx < live.seg + 1) return null;
    const d = r.segments.slice(live.seg, idx).reduce((a, e, i) => a + e.distance * (i === 0 ? left : 1), 0);
    const m = r.segments.slice(live.seg, idx).reduce((a, e, i) => a + e.minutes * (i === 0 ? left : 1), 0);
    const hot = r.segments.slice(live.seg, idx).filter(e => e.heat_class === "HIGH" || e.heat_class === "ELEVATED").length;
    return { st, d, m, hot, poi: j.boot.relief.find(p => p.id === st.poi) };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  const next = ahead.sort((a, b) => a.d - b.d)[0];
  const nearestOf = (k: string) => ahead.filter(a => a.st.kinds.includes(k)).sort((a, b) => a.d - b.d)[0];
  const tile = (key: string, title: string, value: string, sub?: string) =>
    <button key={key} className={`tile ${open === key ? "on" : ""}`} aria-expanded={open === key}
      onClick={() => setOpen(open === key ? null : key)}><small>{title}</small><b>{value}</b>{sub && <small>{sub}</small>}</button>;
  return <div className="split live">
    <div className="col map">
      <div className="livebar" role="status">
        <b>{live.arrived ? "ARRIVED" : "RAHAT JOURNEY ACTIVE"}</b> <Badge kind="SIMULATED JOURNEY" /> <Badge kind="DEMO DATA" />
        <span className="grow" />
        {!live.arrived && (live.running
          ? <button onClick={() => j.liveControl("pause")}>Pause</button>
          : <button className="primary" onClick={() => j.liveControl("resume")}>Resume</button>)}
        <button onClick={() => j.liveControl("speed")} aria-label="Change simulation speed">{live.speed}× speed</button>
        <button onClick={() => { j.liveControl("end"); nav("/journey/route"); }}>End</button>
      </div>
      <Toggles layers={layers} set={setLayers} />
      <JourneyMap map={j.boot.map} routes={[r]} selected={r.id} pois={j.boot.relief} layers={layers}
        waypoints={j.req.waypoints.map(w => w.node)} origin={r.nodes[0]} destination={j.req.destination}
        position={pos} closed={j.req.closed_relief} focusSegment={{ route: r.id, index: live.seg }}
        onSegment={(rt, i) => j.setSeg({ route: rt, index: i })} />
      <div className="progress" aria-label="Journey progress"><i style={{ width: `${progress * 100}%` }} /></div>
      <Timeline route={r} />
      <div className="tiles">
        {tile("heat", "HEAT", s.heat_class, `${f(s.shade * 100, 0)}% est. shade`)}
        {tile("exposure", "EXPOSURE", `${f(live.exposure)} u`, "so far")}
        {tile("water", "WATER", nearestOf("WATER") ? dist(nearestOf("WATER").d) : "none ahead")}
        {tile("shade", "SHADE", nearestOf("SHADE") ? dist(nearestOf("SHADE").d) : "none ahead")}
        {tile("rest", "REST", nearestOf("REST") ? dist(nearestOf("REST").d) : "none ahead")}
        {tile("relief", "RELIEF", String(ahead.length), "points ahead")}
        {tile("route", "ROUTE", `${f(remMin)} min`, dist(remDist))}
        <button className="tile need" onClick={() => j.openNeed()}><small>NOW</small><b>I NEED RAHAT</b></button>
      </div>
      {open && <Card title={open.toUpperCase()}>
        {open === "heat" && <p>{s.explanation}</p>}
        {open === "exposure" && <p>You have accumulated about {f(live.exposure)} estimated exposure units over {f(live.elapsed)} min of simulated riding. Remaining route estimate: {f(r.segments.slice(live.seg + 1).reduce((a, e) => a + e.load, 0))} u. <Badge kind="MODEL ESTIMATE" /></p>}
        {["water", "shade", "rest"].includes(open) && (nearestOf(open.toUpperCase())
          ? <p>Next {open} on route: {nearestOf(open.toUpperCase()).st.name}, {dist(nearestOf(open.toUpperCase()).d)} ahead, about {f(nearestOf(open.toUpperCase()).m)} min. <Badge kind="DEMO DATA" /></p>
          : <p>No {open} point remains on this route. Press I NEED RAHAT to look nearby.</p>)}
        {open === "relief" && <Corridor route={r} />}
        {open === "route" && <p>{r.label} route · {dist(total)} total · {r.segments.length} segments · {r.classes.HIGH} high-load.</p>}
      </Card>}
    </div>
    <div className="col">
      <span className="eyebrow">LIVE JOURNEY</span>
      <h1>{live.arrived ? "You have arrived" : `${f(remMin)} min to go`}</h1>
      <div className="stats">
        <Stat label="Remaining" value={dist(remDist)} /><Stat label="Elapsed" value={`${f(live.elapsed)} min`} />
        <Stat label="Now" value={<HeatChip cls={s.heat_class} />} />
      </div>
      {j.change && <WhatChanged change={j.change} onDismiss={() => j.setChange(null)} />}
      <Card title="NEXT STOP" tag="MODEL ESTIMATE">
        {next ? <>
          <h3>{next.st.name}</h3>
          <div className="stats">
            <Stat label="Type" value={next.st.kinds.join(" + ")} /><Stat label="Distance" value={dist(next.d)} />
            <Stat label="ETA" value={`${f(next.m)} min`} /><Stat label="Detour" value="0 min (on route)" />
            <Stat label="Availability" value={next.poi?.availability ?? "n/a"} /><Stat label="Confidence" value="Low (demo)" />
          </div>
          <h3>WHY RAHAT RECOMMENDS IT</h3>
          <p>It sits on your current path, so it costs no detour. {next.hot > 0
            ? `${next.hot} elevated or high-load segment${next.hot === 1 ? " lies" : "s lie"} before it, so it is the nearest point to recover from sun exposure.`
            : "The way there is low or moderate in estimated load."} {next.poi?.shade ? "It also offers estimated shade." : ""}</p>
        </> : <p>No relief point remains ahead on this route. I NEED RAHAT searches nearby.</p>}
      </Card>
      <Card title="Something changed?">
        <div className="chips">
          <button disabled={j.busy || live.arrived} onClick={() => j.proposePatch({ delay_min: Math.min(30, j.req.delay_min + 8) }, "Demo traffic delay increased by 8 min on a link of your route.")}>Traffic got worse</button>
          <button disabled={j.busy || live.arrived} onClick={() => j.proposePatch({ heatwave: true }, "Environmental scenario: temperature offset +4 °C.")}>It got hotter</button>
          <button disabled={j.busy || live.arrived || !ahead[0]} onClick={() => ahead[0] && j.proposePatch({ closed_relief: [...j.req.closed_relief, ahead[0].st.poi] }, `${ahead[0].st.name} reported unavailable (scenario).`)}>Next relief closed</button>
        </div>
        <p className="muted">The route is only proposed, never changed silently.</p>
      </Card>
      {live.arrived && <Card title="Journey summary"><p>Simulated journey complete: about {f(live.exposure)} estimated exposure units over {f(live.elapsed)} min.
        This is a model estimate, not a health measure.</p></Card>}
    </div>
  </div>;
}

/* ---------------- I NEED RAHAT dialog ---------------- */
export function NeedDialog() {
  const j = useJ();
  const { need } = j;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") j.closeNeed(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [j]);
  const res: NeedResult | null = need.result;
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Nearby relief">
    <div className="sheet">
      <header><h2>I NEED RAHAT</h2><button ref={closeRef} aria-label="Close relief" onClick={j.closeNeed}>×</button></header>
      <p className="muted">Nearest relief opportunities from {j.boot.map.nodes[need.node].name}. This is not a medical assessment; if you feel unwell, seek help.</p>
      {need.loading && <Loading text="Finding nearby relief…" />}
      {need.error && <ErrorBox message={need.error} />}
      {res && <>
        <div className="needgrid">{(["WATER", "SHADE", "REST", "COOLING"] as const).map(k => {
          const v = res.by_type[k];
          return <div key={k} className="needcell"><small>{NEED_ICON[k]} {k}</small>
            <b>{v ? dist(v.distance_m) : "none within 1 km"}</b>{v && <small>{v.name}</small>}</div>;
        })}</div>
        {res.items.length === 0 ? <Empty title="No relief within 1 km" text="Widen your search or move toward the destination." />
          : <ul className="plist ranked">{res.items.slice(0, 5).map((p, i) => <li key={p.id}>
            <div><b>{i + 1}. {p.name}</b><span>{p.type} · {dist(p.distance)} · +{f(p.detour_minutes)} min detour</span>
              <small>{p.why}</small><div className="row"><Badge kind="DEMO DATA" /><Badge kind="MODEL ESTIMATE" /></div></div>
            <button className="primary" disabled={j.busy} onClick={() => void j.proposeRelief(p)}>Route here</button></li>)}</ul>}
        <small className="muted">Ranked by network distance, detour and exposure on the way. {res.framing}</small>
      </>}
    </div>
  </div>;
}

/* ---------------- Scenario lab ---------------- */
export function ScenarioPage() {
  const j = useJ();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cur, setCur] = useState<null | { reason: string; before: ReturnType<typeof metricsOf>; now: ReturnType<typeof metricsOf>; geo: boolean; req: JReq }>(null);
  const run = async (change: string) => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ reason: string; before: JRoute; now: JRoute; geometry_changed: boolean; updated_request: JReq }>(
        "/journey/what-changed", { journey: j.req, change });
      setCur({ reason: r.reason, before: metricsOf(r.before), now: metricsOf(r.now), geo: r.geometry_changed, req: r.updated_request });
    } catch (e) { setErr(e instanceof Error ? e.message : "That scenario could not run."); }
    finally { setBusy(false); }
  };
  return <div className="stack">
    <span className="eyebrow">SCENARIO LAB</span><h1>What if conditions change?</h1>
    <p className="muted">Each scenario re-runs the same engines on changed inputs and shows BEFORE vs NOW. It never edits your route by itself.</p>
    <div className="chips">
      {[["traffic", "Traffic gets worse"], ["heatwave", "Heatwave (+4 °C)"], ["later", "Leave 2 h later"], ["relief-closed", "A relief point closes"]].map(([k, l]) =>
        <button key={k} disabled={busy} onClick={() => void run(k)}>{l}</button>)}
    </div>
    {busy && <Loading text="Checking alternatives…" />}
    {err && <ErrorBox message={err} />}
    {!cur && !busy && <Empty title="Pick a scenario" text="Results compare the RAHAT route before and after the change." />}
    {cur && <WhatChanged change={{
      reason: cur.reason, before: cur.before, after: cur.now, geometryChanged: cur.geo,
      apply: () => j.setReq({
        delay_min: cur.req.delay_min, heatwave: cur.req.heatwave,
        departure: cur.req.departure, closed_relief: cur.req.closed_relief,
      }),
    }} onDismiss={() => setCur(null)} />}
  </div>;
}

/* ---------------- Community ---------------- */
interface Report { id: string; node: number; kind: string; note: string; status: string; created_at: string; city?: string }
const KINDS = ["SHADE HERE", "WATER HERE", "COOLING HERE", "REST POINT", "NO WATER", "SHADE REMOVED", "STATION CLOSED"];
export function CommunityPage() {
  const j = useJ();
  const [items, setItems] = useState<Report[] | null>(null);
  const [kind, setKind] = useState(KINDS[1]);
  const [node, setNode] = useState(j.req.origin);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () => api<{ items: Report[] }>("/reports").then(r => setItems(r.items.filter(x => x.city === "delhi")))
    .catch(() => setErr("Reports could not be loaded."));
  useEffect(() => { void load(); }, []);
  const submit = async () => {
    setSaving(true); setErr("");
    try { await api("/reports", { node, kind, note: note.slice(0, 500), city: "delhi" }); setNote(""); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Report could not be saved."); }
    finally { setSaving(false); }
  };
  return <div className="split">
    <div className="col">
      <span className="eyebrow">COMMUNITY MAP</span><h1>Report what you see</h1>
      <Card title="New report" tag="COMMUNITY REPORT">
        <div className="form-row">
          <label>Type<select value={kind} onChange={e => setKind(e.target.value)}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
          <label>Where<select value={node} onChange={e => setNode(+e.target.value)}>
            {j.boot.map.nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        </div>
        <label>Note (optional)<textarea maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
        <button className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Saving…" : "Submit report"}</button>
        <p className="muted">Every report starts as UNVERIFIED and stays that way here. It never alters routes, scores or relief status.</p>
      </Card>
      {err && <ErrorBox message={err} />}
    </div>
    <div className="col">
      <Card title="Reports" tag="COMMUNITY REPORT">
        {!items ? <Loading text="Loading reports…" /> : items.length === 0
          ? <Empty title="No reports yet" text="Be the first to mark shade or water." />
          : <ul className="plist">{items.map(r => <li key={r.id}><div><b>{r.kind}</b>
            <span>{j.boot.map.nodes[r.node]?.name ?? `Node ${r.node}`}</span>{r.note && <small>{r.note}</small>}</div>
            <Badge kind={r.status} /></li>)}</ul>}
        <p className="muted">Statuses: UNVERIFIED, COMMUNITY VERIFIED and SYSTEM VERIFIED. Promotion requires a verification workflow that is not connected in demo mode.</p>
      </Card>
    </div>
  </div>;
}

/* ---------------- Evidence + Settings ---------------- */
export function EvidencePage() {
  const j = useJ();
  return <Gate>{plan => <div className="stack">
    <span className="eyebrow">EVIDENCE</span><h1>Where every number comes from</h1>
    <div className="evgrid">{plan.evidence.map(e => <Card key={e.source} title={e.source} tag={e.source}>
      <dl className="ev">
        <div><dt>Source</dt><dd>{e.source}</dd></div><div><dt>Timestamp</dt><dd>{e.timestamp ?? "n/a"}</dd></div>
        <div><dt>Coverage</dt><dd>{e.coverage}</dd></div><div><dt>Confidence</dt><dd>{e.confidence}</dd></div>
        <div><dt>Method</dt><dd>{e.method}</dd></div><div><dt>Limitations</dt><dd>{e.limitations}</dd></div>
      </dl></Card>)}</div>
    <Card title="Agent architecture">
      <p>Seven roles explain and validate. Engines produce every number.</p>
      <ul className="agents">{["Thermal Analysis", "Route Intelligence", "Relief Discovery", "Validator", "Journey Advisor", "Reassessment", "Evidence"].map(a => <li key={a}>{a}</li>)}</ul>
      <p className="muted">Explanations here are deterministic templates. Bedrock is an optional adapter for wording only (see Settings).</p>
    </Card>
    <Card title="Selected route"><p>{(j.route ?? plan.routes[0]).confidence}</p></Card>
  </div>}</Gate>;
}

export function SettingsPage() {
  const j = useJ();
  return <div className="stack">
    <span className="eyebrow">SETTINGS</span><h1>Provider architecture</h1>
    <Card title="Mode"><p><b>DEMO MODE</b> is active. Everything runs locally with no credentials. REAL MODE swaps provider
      implementations behind the same interfaces; the UI does not change.</p></Card>
    <Card title="Providers">
      <div className="tablewrap"><table className="cmp"><thead><tr><th>Provider</th><th>State</th><th>Detail</th></tr></thead>
        <tbody>{j.boot.providers.map(p => <tr key={p.name}><th scope="row">{p.name}</th>
          <td><Badge kind={p.state === "UNAVAILABLE" ? "UNAVAILABLE" : "DEMO DATA"} /> {p.state}</td><td>{p.detail}</td></tr>)}</tbody></table></div>
      <p className="muted">Future states: CONNECTED, UNAVAILABLE, ERROR. Secrets are never displayed or sent to the browser.</p>
    </Card>
    <Card title="AWS and Bedrock readiness">
      <p>Adapters exist for Amazon Location Service routes and Bedrock explanations; the SAM template defines API Gateway, Lambda, DynamoDB, S3, Step Functions and CloudWatch. None are called in demo mode.</p>
    </Card>
  </div>;
}
