import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useJ } from "./ctx";
import JourneyMap, { POI_COLOR, type MapLayers, type MapMarker } from "./UltraJourneyMap";
import type { JPOI, JReq, JRoute, NeedItem, NeedResult, Place } from "./jtypes";
import { HEAT_COLOR, metricsOf } from "./jtypes";
import {
  AnimNum, Badge, Btn, Empty, ErrorBox, HeatChip, HeatStrip, Ico, Loading, Metric, NEED_COLOR, NeedIco,
  PageHero, Stat, WhatChanged, applyPrefs, dist, f, loadPrefs, savePrefs, sign,
} from "./UltraUi";
import type { IcoName } from "./UltraUi";

const Rider3D = lazy(() => import("./Rider3D"));

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
const LAYER_ICON: Record<keyof MapLayers, IcoName> = { thermal: "heat", shade: "shade", relief: "water", alternatives: "route" };
function Toggles({ layers, set }: { layers: MapLayers; set: (l: MapLayers) => void }) {
  return <div className="layerbar" role="group" aria-label="Map layers">
    {(["thermal", "shade", "relief", "alternatives"] as const).map(k =>
      <button key={k} className="chip" aria-pressed={layers[k]} onClick={() => set({ ...layers, [k]: !layers[k] })}>
        <Ico n={LAYER_ICON[k]} size={15} />{k === "alternatives" ? "Other routes" : k[0].toUpperCase() + k.slice(1)}</button>)}
  </div>;
}
function Legend() {
  return <div className="legend2" aria-label="Thermal classes">
    <div className="ramp" aria-hidden="true">
      {(["LOW", "MODERATE", "ELEVATED", "HIGH"] as const).map(c => <i key={c} style={{ background: HEAT_COLOR[c] }} />)}
    </div>
    <div className="ramp-l">{(["LOW", "MODERATE", "ELEVATED", "HIGH"] as const).map(c => <span key={c}>{c}</span>)}</div>
    <small>Estimated thermal load · MODEL ESTIMATE</small>
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

function kindIcon(k: string): IcoName {
  return k === "WATER" ? "water" : k === "SHADE" ? "shade" : k === "REST" ? "rest" : k === "COOLING" ? "cooling" : "pin";
}
function Corridor({ route }: { route: JRoute }) {
  const j = useJ();
  const stages = route.corridor.stages;
  if (!stages.length) return <p className="muted">No relief points lie on this route.</p>;
  return <ol className="chain" aria-label="RAHAT relief corridor">
    {stages.map((s, i) => <li key={s.poi + i} style={{ animationDelay: `${i * 90}ms` }}>
      <span className="ck">{s.kinds.map(k => <Ico key={k} n={kindIcon(k)} size={15} />)}{s.kinds.join(" + ")}</span>
      <b>{s.name}</b>
      <small className="muted">{j.boot.map.nodes[s.node].name}</small>
    </li>)}
    <li className="dest"><span className="ck"><Ico n="flag" size={15} />DESTINATION</span></li>
  </ol>;
}

/** Visual explanation for one road segment: the four factors the engine actually reports. */
function WhySegment() {
  const { segment, seg, setSeg } = useJ();
  if (!segment || !seg) return <div className="whyseg idle">
    <Ico n="eye" size={22} />
    <div><b>Select a road</b><span>Tap a coloured segment on the map or the heat strip to see why its thermal load is what it is.</span></div>
  </div>;
  const bd = segment.breakdown;
  const pos = Object.values(bd).filter(v => v > 0).reduce((a, b) => a + b, 0) || 1;
  const ambient = bd["Ambient heat context"] ?? 0, traffic = bd["Traffic delay"] ?? 0;
  const hot = segment.heat_class === "HIGH" || segment.heat_class === "ELEVATED";
  const title = hot ? "WHY THIS SEGMENT IS HOT" : segment.heat_class === "MODERATE" ? "WHY THIS SEGMENT IS WARM" : "WHY THIS SEGMENT IS COOLER";
  const factors: { k: string; icon: IcoName; v: string; bar: number; note: string }[] = [
    { k: "Low shade", icon: "shade", v: `${f((1 - segment.shade) * 100, 0)}% unshaded`, bar: 1 - segment.shade, note: `${f(segment.shade * 100, 0)}% estimated shade` },
    { k: "High solar load", icon: "sun", v: f(segment.solar_exposure, 2), bar: Math.min(1, segment.solar_exposure), note: "solar exposure index" },
    { k: "Ambient heat context", icon: "heat", v: `${f(ambient)} u`, bar: Math.max(0, ambient) / pos, note: "share of this segment's load" },
    { k: "Traffic delay", icon: "clock", v: `${f(segment.delay_minutes)} min`, bar: Math.max(0, traffic) / pos, note: `${f(traffic)} u of load from waiting in the sun` },
  ];
  return <div className="whyseg" key={`${seg.route.id}-${seg.index}`}>
    <header><div><span className="eyebrow">SEGMENT {seg.index + 1} · {segment.heat_class}</span><h3>{title}</h3></div>
      <button className="icon-btn" aria-label="Close details" onClick={() => setSeg(null)}><Ico n="close" size={16} /></button></header>
    <p>{segment.explanation}</p>
    <ul className="factors">{factors.map(x => <li key={x.k}>
      <span className="fk"><Ico n={x.icon} size={16} />{x.k}</span><b>{x.v}</b>
      <i className="fbar" aria-hidden="true"><u style={{ width: `${Math.max(0.04, Math.min(1, x.bar)) * 100}%` }} /></i>
      <small>{x.note}</small></li>)}</ul>
    <dl>
      <div><dt>Thermal load</dt><dd>{f(segment.load)} u</dd></div>
      <div><dt>Duration</dt><dd>{f(segment.minutes)} min</dd></div>
      <div><dt>Nearby relief</dt><dd>{segment.nearby_relief ? `${segment.nearby_relief.name} · ${dist(segment.nearby_relief.distance_m)}` : "None"}</dd></div>
      <div><dt>Confidence</dt><dd>Low · uncalibrated</dd></div>
      <div><dt>Source · time</dt><dd>{segment.source} · {segment.timestamp.slice(11, 16)}</dd></div>
    </dl>
  </div>;
}

/** Compact route switcher used wherever the page is not primarily about route choice. */
function RouteTabs() {
  const j = useJ();
  if (!j.plan) return null;
  return <div className="rtabs" role="group" aria-label="Route">
    {j.plan.routes.filter(r => r.id !== "balanced" || !r.same_geometry_as).map(r =>
      <button key={r.id} className={`rtab ${r.id}`} aria-pressed={j.selected === r.id} onClick={() => j.select(r.id)}>
        <span className="eyebrow">{r.label}</span>
        <b>{f(r.minutes)}<small> min</small></b>
        <small>{f(r.load)} u · {f(r.shade * 100, 0)}% shade</small>
      </button>)}
  </div>;
}

function RouteHud({ route, label = "ROUTE PREVIEW" }: { route: JRoute | null; label?: string }) {
  if (!route) return null;
  return <div className="maphud">
    <span className="eyebrow">{label} · {route.label}</span>
    <div className="hud-row">
      <b>{f(route.minutes)}<small> min</small></b><b>{dist(route.distance)}</b>
      <b className="hot">{f(route.load)}<small> u</small></b>
    </div>
    <small>time · distance · estimated thermal exposure</small>
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
  return <div className="modal" role="dialog" aria-modal="true" aria-label={title}
    onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet">
      <header><div><span className="eyebrow">JOURNEY NODE</span><h2>{title}</h2></div>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><Ico n="close" size={18} /></button></header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "search"} onClick={() => setTab("search")}><Ico n="search" size={16} />SEARCH</button>
        <button role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}><Ico n="pin" size={16} />SELECT ON MAP</button>
      </div>
      {tab === "search" ? <>
        <div className="searchbox"><Ico n="search" size={18} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} maxLength={60}
            placeholder="Search any place in India…" aria-label="Search places" /></div>
        <p className="muted">Demo mode searches a small Delhi list. A real geocoder plugs in here for any Indian location. <Badge kind="DEMO DATA" /></p>
        {err && <ErrorBox message={err} />}
        {!items ? <Loading text="Searching…" /> : items.length === 0
          ? <Empty title="No demo match" text="Try India Gate, Connaught Place, Janpath, AIIMS or Mandi House." />
          : <ul className="results">{items.map(p => <li key={p.name}>
            <button disabled={!p.inside_demo_coverage}
              onClick={() => p.node !== null && commit(p.node, p.name)}>
              <span className="r-ico"><Ico n="pin" size={18} /></span>
              <span className="r-t"><b>{p.name}</b>
                <small>{p.inside_demo_coverage
                  ? `Snaps to ${j.boot.map.nodes[p.node as number].name}, ${dist(p.snapped_distance_m ?? 0)} away`
                  : p.note}</small></span>
              <Ico n="arrow" size={16} />
            </button></li>)}</ul>}
        <div className="chips">{["India Gate", "Connaught Place", "Janpath", "Mandi House"].map(s =>
          <button key={s} className="chip" aria-pressed={q === s} onClick={() => setQ(s)}><Ico n="pin" size={14} />{s}</button>)}</div>
      </> : <>
        <div className="pickmap">
          <JourneyMap map={j.boot.map} routes={j.plan?.routes ?? []} selected="rahat" pois={j.boot.relief}
            layers={{ thermal: true, shade: false, relief: true, alternatives: false }}
            waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination}
            pick onNode={setPicked} label="Select a point on the demo map" controls={false} />
        </div>
        {node ? <div className="ctxinfo">
          <b>{node.name}</b>
          <small>{node.lat.toFixed(5)}, {node.lon.toFixed(5)} · USER INPUT · demo junction</small>
          {near && <small>Nearest demo relief: {near.p.name}, about {dist(near.d)}.</small>}
          <Btn variant="primary" size="lg" arrow onClick={() => commit(node.id, node.name)}>Confirm this point</Btn>
        </div> : <p className="muted">Tap a dot on the map to see what is there.</p>}
      </>}
    </div>
  </div>;
}

const PREF_COPY: Record<string, string> = {
  WATER: "Prefer hydration access", SHADE: "Reduce solar exposure",
  REST: "Add recovery opportunity", COOLING: "Prioritize cooling access",
};

export function StartPage() {
  const j = useJ();
  const nav = useNavigate();
  const [target, setTarget] = useState<Target | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [leaving, setLeaving] = useState<number | null>(null);
  const name = (n: number) => labels[n] ?? j.boot.map.nodes[n]?.name ?? `Node ${n}`;
  const swap = () => j.setReq({ origin: j.req.destination, destination: j.req.origin });
  const move = (i: number, d: -1 | 1) => {
    const w = [...j.req.waypoints]; const k = i + d;
    if (k < 0 || k >= w.length) return;
    [w[i], w[k]] = [w[k], w[i]]; j.setReq({ waypoints: w });
  };
  const remove = (i: number) => {
    setLeaving(i);
    setTimeout(() => { j.setReq({ waypoints: j.req.waypoints.filter((_, k) => k !== i) }); setLeaving(null); }, 240);
  };
  const toggleNeed = (n: string) => j.setReq({
    needs: j.req.needs.includes(n) ? j.req.needs.filter(x => x !== n) : [...j.req.needs, n],
  });
  const same = j.req.origin === j.req.destination;
  const r = j.route;
  return <div className="start">
    <div className="start-main">
      <PageHero eyebrow="START JOURNEY" title={<>YOUR <em>JOURNEY</em></>}
        sub={<>Choose where you&apos;re going.<br />RAHAT will find the better way through the heat.</>} />
      <section className="jline" aria-label="Journey">
        <ol className="nodes">
          <li className="jnode start"><span className="jn-dot"><Ico n="locate" size={18} /></span>
            <div className="jn-body"><small>CURRENT LOCATION</small><b>{name(j.req.origin)}</b></div>
            <div className="jn-acts"><button className="icon-btn" onClick={() => setTarget("origin")} aria-label="Edit start"><Ico n="edit" size={16} /></button></div></li>
          {j.req.waypoints.map((w, i) => <li key={`${w.node}-${i}`} className={`jnode wp ${leaving === i ? "leaving" : ""}`}>
            <span className="jn-dot">{i + 1}</span>
            <div className="jn-body"><small>STOP {i + 1}</small><b>{name(w.node)}</b></div>
            <div className="jn-acts">
              <button className="icon-btn" aria-label="Move stop up" disabled={i === 0} onClick={() => move(i, -1)}><Ico n="up" size={16} /></button>
              <button className="icon-btn" aria-label="Move stop down" disabled={i === j.req.waypoints.length - 1} onClick={() => move(i, 1)}><Ico n="down" size={16} /></button>
              <button className="icon-btn" aria-label={`Edit stop ${i + 1}`} onClick={() => setTarget(i)}><Ico n="edit" size={16} /></button>
              <button className="icon-btn danger" aria-label={`Remove stop ${i + 1}`} onClick={() => remove(i)}><Ico n="trash" size={16} /></button>
            </div></li>)}
          <li className="jnode dest"><span className="jn-dot"><Ico n="flag" size={18} /></span>
            <div className="jn-body"><small>DESTINATION</small><b>{name(j.req.destination)}</b></div>
            <div className="jn-acts"><button className="icon-btn" onClick={() => setTarget("destination")} aria-label="Edit destination"><Ico n="edit" size={16} /></button></div></li>
        </ol>
        {r && <div className="jsum"><Ico n="route" size={16} /><b>{dist(r.distance)}</b><span>·</span><b>{f(r.minutes)} min</b><span>via {r.label}</span></div>}
        <div className="row">
          <Btn className="addstop" icon="plus" disabled={j.req.waypoints.length >= 5} onClick={() => setTarget("add")}>ADD NEXT STOP</Btn>
          <Btn variant="ghost" icon="swap" onClick={swap}>Swap start and destination</Btn>
        </div>
        {same && <ErrorBox message="Start and destination are the same place. Pick a different destination." />}
      </section>
      <section className="prefs-wrap">
        <div className="sec-head"><h2>WHAT DO YOU NEED ON THE WAY?</h2><Badge kind="USER INPUT" /></div>
        <div className="prefs" role="group" aria-label="Needs on the way">
          {j.boot.needs.map(n => <button key={n} className="pref" style={{ ["--pc" as string]: NEED_COLOR[n] ?? "#7df0c0" }}
            aria-pressed={j.req.needs.includes(n)} onClick={() => toggleNeed(n)}>
            <span className="pf-ico"><NeedIco k={n} size={22} /></span>
            <span className="pf-t"><b>{n}</b><small>{PREF_COPY[n] ?? `Prefer ${n.toLowerCase()} on the way`}</small></span>
            <span className="pf-check" aria-hidden="true"><Ico n="check" size={14} /></span>
          </button>)}
        </div>
        <p className="muted">Needs are soft preferences. They raise the score of routes passing matching relief points and change the RELIEF PRIORITY path.</p>
      </section>
      <section className="how2">
        <div className="sec-head"><h2>HOW YOU TRAVEL</h2></div>
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
      </section>
      <div className="cta-dock">
        <Btn variant="primary" size="xl" arrow disabled={same || !j.plan} loading={j.loading && !!j.plan} onClick={() => nav("/journey/choice")}>
          SEE THE HEAT CHOICE</Btn>
        <Btn disabled={same || !j.plan} onClick={() => nav("/journey/route")}>Go to route planner</Btn>
      </div>
    </div>
    <div className="start-map">
      <Gate>{plan => <>
        <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected} pois={j.boot.relief}
          layers={{ thermal: true, shade: true, relief: true, alternatives: true }}
          waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination} />
        <RouteHud route={j.route} />
      </>}</Gate>
    </div>
    {target !== null && <AddStopDialog target={target} onClose={() => setTarget(null)}
      label={(n, l) => setLabels(s => ({ ...s, [n]: l }))} />}
  </div>;
}

/* ---------------- Heat choice ---------------- */
function HotArt() {
  return <svg className="art hot-art" viewBox="0 0 600 400" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
    <defs><linearGradient id="hz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffb25c" stopOpacity="0" /><stop offset="1" stopColor="#ff7a2e" stopOpacity=".55" /></linearGradient></defs>
    <circle cx="90" cy="60" r="120" fill="#ffd9a0" opacity=".22" /><circle cx="90" cy="60" r="46" fill="#fff0cf" opacity=".6" />
    <g fill="#1c1411" opacity=".82">
      <rect x="20" y="210" width="90" height="190" /><rect x="120" y="150" width="70" height="250" /><rect x="200" y="245" width="110" height="155" />
      <rect x="320" y="190" width="80" height="210" /><rect x="410" y="260" width="120" height="140" />
    </g>
    <g stroke="#ffb25c" strokeOpacity=".28">{[0, 1, 2, 3, 4, 5, 6].map(i => <path key={i} className="shimmer" style={{ animationDelay: `${i * 0.35}s` }}
      d={`M0 ${250 + i * 22} q 40 -10 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0`} fill="none" strokeWidth="2" />)}</g>
    <rect x="0" y="230" width="600" height="170" fill="url(#hz)" />
  </svg>;
}
function CoolArt() {
  const trees = [[60, 330, 70], [170, 345, 56], [290, 335, 80], [410, 350, 60], [520, 330, 74]];
  return <svg className="art cool-art" viewBox="0 0 600 400" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7df0c0" stopOpacity="0" /><stop offset="1" stopColor="#1fa070" stopOpacity=".5" /></linearGradient></defs>
    <rect x="0" y="200" width="600" height="200" fill="url(#cg)" />
    {trees.map(([x, y, r], i) => <g key={i} className="sway" style={{ animationDelay: `${i * 0.6}s`, transformOrigin: `${x}px ${y}px` }}>
      <rect x={x - 5} y={y - 8} width="10" height={r * 0.9} fill="#0c2a1e" />
      <circle cx={x} cy={y - r * 0.45} r={r * 0.62} fill="#1a6b4a" opacity=".85" /><circle cx={x - r * 0.3} cy={y - r * 0.2} r={r * 0.4} fill="#25885e" opacity=".8" />
      <circle cx={x + r * 0.32} cy={y - r * 0.25} r={r * 0.38} fill="#2fa171" opacity=".75" /></g>)}
    <g fill="none" stroke="#6fd8ff" strokeOpacity=".5">{[0, 1, 2].map(i => <ellipse key={i} className="ripple" style={{ animationDelay: `${i * 0.9}s` }} cx="330" cy="385" rx="30" ry="7" strokeWidth="2" />)}</g>
  </svg>;
}

function WorldMetrics({ r, other, tone }: { r: JRoute; other: JRoute; tone: "hot" | "cool" }) {
  const hi = r.classes.HIGH + r.classes.ELEVATED;
  const maxLoad = Math.max(r.load, other.load, 0.01);
  return <div className="wm">
    <div className="wm-big">
      <Metric tone={tone === "hot" ? "hot" : "cool"} icon="heat" label="ESTIMATED THERMAL EXPOSURE" value={f(r.load)} unit=" u"
        sub={tone === "cool" ? `${sign(r.delta_vs_fastest.load_pct, 0)}% vs fastest` : "baseline · fastest route"} bar={r.load / maxLoad} />
      <Metric tone={tone === "hot" ? "hot" : "cool"} icon="shade" label="ESTIMATED SHADE" value={f(r.shade * 100, 0)} unit="%"
        sub="of the route" bar={r.shade} />
    </div>
    <ul className="wm-pills">
      <li><Ico n="alert" size={16} /><b>{hi}</b><span>of {r.segments.length}</span><small>high exposure segments</small></li>
      <li><Ico n="water" size={16} /><b>{r.water_on_route}</b><small>water points</small></li>
      <li><Ico n="rest" size={16} /><b>{r.relief_count}</b><small>relief points</small></li>
    </ul>
  </div>;
}

export function ChoicePage() {
  const nav = useNavigate();
  const j = useJ();
  const [going, setGoing] = useState(false);
  return <Gate>{plan => {
    const fast = plan.routes.find(r => r.id === "fastest")!, rahat = plan.routes.find(r => r.id === "rahat")!;
    const d = rahat.delta_vs_fastest;
    const same = rahat.same_geometry_as === "fastest";
    return <section className={`choice2 ${going ? "going" : ""}`}>
      <div className="choice-stage"><Stage scene="choice" /></div>
      <div className="world hot" aria-hidden="true"><HotArt /></div>
      <div className="world cool" aria-hidden="true"><CoolArt /></div>
      <div className="choice-kicker"><span className="eyebrow">SAME JOURNEY · TWO POSSIBLE EXPERIENCES</span>
        <span className="eyebrow">{plan.weather.temperature_c.toFixed(0)}°C · {j.boot.map.city.toUpperCase()}</span></div>
      <aside className="ew hot">
        <h2>HIGH HEAT / HIGH EXPOSURE</h2>
        <p>Sun-exposed concrete, traffic, less shade, limited relief. The fastest way.</p>
        <WorldMetrics r={fast} other={rahat} tone="hot" />
      </aside>
      <div className="decision">
        <div className="dec-row">
          <div><span className="eyebrow">FASTEST WAY</span><b>{f(fast.minutes)}<small> min</small></b><small>{dist(fast.distance)}</small></div>
          <span className="vs">VS</span>
          <div className="g"><span className="eyebrow">RAHAT WAY</span><b>{f(rahat.minutes)}<small> min</small></b><small>{dist(rahat.distance)}</small></div>
        </div>
        {same ? <div className="dec-delta"><span className="neutral">Same path for these inputs</span></div> :
          <div className="dec-delta">
            <span className="plus">{sign(d.minutes)} min</span>
            <span className="minus"><b>{sign(d.load_pct, 0)}%</b><small>estimated thermal exposure</small></span>
          </div>}
      </div>
      <aside className="ew cool">
        <h2>RAHAT CORRIDOR</h2>
        <p>Trees, building shadow, water, rest and cooling where the engine found them.</p>
        <WorldMetrics r={rahat} other={fast} tone="cool" />
      </aside>
      <div className="choice-foot">
        <p>{why(plan.routes, j.req.needs)}</p>
        <div className="foot-row">
          <div className="row"><Badge kind="DEMO DATA" /><Badge kind="MODEL ESTIMATE" /></div>
          <div className="foot-cta">
            <Btn onClick={() => nav("/journey/compare")}>COMPARE ALL ROUTES</Btn>
            <Btn variant="primary" size="xl" arrow loading={going}
              onClick={() => { setGoing(true); j.select("rahat"); setTimeout(() => nav("/journey/route"), 380); }}>
              CHOOSE THE RAHAT WAY</Btn>
          </div>
        </div>
      </div>
    </section>;
  }}</Gate>;
}

/* ---------------- Route planner: command center ---------------- */
function RouteOption({ r }: { r: JRoute }) {
  const j = useJ();
  const on = j.selected === r.id;
  return <button className={`ropt ${r.id} ${on ? "sel" : ""}`} aria-pressed={on} onClick={() => j.select(r.id)}>
    <span className="eyebrow">{r.label}{r.same_geometry_as ? ` · same path as ${r.same_geometry_as}` : ""}</span>
    <span className="ropt-top"><b>{f(r.minutes)}<small> min</small></b><span className="ropt-d">{dist(r.distance)} · {sign(r.detour_minutes)} min detour</span>
      {on && <span className="sel-badge"><Ico n="check" size={12} />SELECTED</span>}</span>
    <HeatStrip route={r} />
    <span className="ropt-stats">
      <span><small>Est. thermal exposure</small><b>{f(r.load)} u</b></span>
      <span><small>Est. shade</small><b>{f(r.shade * 100, 0)}%</b></span>
      <span><small>Water · rest · cooling</small><b>{r.water_on_route} · {r.rest_on_route} · {r.cooling_on_route}</b></span>
      <span><small>Relief on route</small><b>{r.relief_count}</b></span>
    </span>
    <small className="muted">MODEL ESTIMATE · confidence low</small>
  </button>;
}

export function RoutePage() {
  const j = useJ();
  const nav = useNavigate();
  const [layers, setLayers] = useLayers();
  const [poi, setPoi] = useState<JPOI | null>(null);
  const [starting, setStarting] = useState(false);
  return <Gate>{plan => {
    const r = j.route ?? plan.routes[0];
    return <div className="cmd">
      <div className="cmd-head">
        <PageHero eyebrow="ROUTE PLANNER" title={<>ROUTE <em>COMMAND CENTER</em></>}
          sub="Three ways through the heat. Pick one, read the corridor, then go." />
        <Toggles layers={layers} set={setLayers} />
      </div>
      <div className="cmd-stage">
        <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected} pois={j.boot.relief} layers={layers}
          waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination}
          closed={j.req.closed_relief} highlight={poi?.id}
          focusSegment={j.seg ? { route: j.seg.route.id, index: j.seg.index } : null}
          onSegment={(rt, i) => j.setSeg({ route: rt, index: i })} onPOI={setPoi} />
        <aside className="float left routes-panel" aria-label="Route options">
          {plan.routes.filter(x => x.id !== "balanced" || !x.same_geometry_as).map(x => <RouteOption key={x.id} r={x} />)}
        </aside>
        <aside className="float right">
          <WhySegment />
          {poi && <PoiCard poi={poi} onClose={() => setPoi(null)} />}
        </aside>
        <div className="float bottom">
          <div className="corr-wrap"><span className="eyebrow">RAHAT RELIEF CORRIDOR · <Badge kind="MODEL ESTIMATE" /></span><Corridor route={r} /></div>
          <div className="cmd-cta">
            <Btn icon="bolt" onClick={() => j.openNeed(j.req.origin)}>I NEED RAHAT</Btn>
            <Btn variant="primary" size="xl" arrow loading={starting}
              onClick={() => { setStarting(true); j.startLive(); setTimeout(() => nav("/journey/live"), 260); }}>START JOURNEY</Btn>
          </div>
        </div>
      </div>
      <div className="cmd-foot"><Legend /><p className="muted">{why(plan.routes, j.req.needs)}</p></div>
    </div>;
  }}</Gate>;
}
function PoiCard({ poi, onClose, distance }: { poi: JPOI; onClose: () => void; distance?: number }) {
  const j = useJ();
  const c = POI_COLOR[poi.type] ?? "#7df0c0";
  return <div className="poicard" role="dialog" aria-label={poi.name} style={{ ["--pc" as string]: c }}>
    <header><span className="pc-ico"><NeedIco k={poi.type} size={20} /></span>
      <div><span className="eyebrow">{poi.type}</span><b>{poi.name}</b></div>
      <button className="icon-btn" aria-label="Close" onClick={onClose}><Ico n="close" size={16} /></button></header>
    {distance !== undefined && <div className="pc-dist"><b>{dist(distance)}</b><small>from your point</small></div>}
    <div className="row"><Badge kind={poi.source} /><Badge kind="UNVERIFIED" /></div>
    <dl>
      <div><dt>Status</dt><dd>{poi.status} · {poi.availability}</dd></div>
      <div><dt>Offers</dt><dd>{poi.tags.join(", ").toLowerCase()}</dd></div>
      <div><dt>Confidence</dt><dd>{poi.confidence}</dd></div>
      <div><dt>Verification</dt><dd>{poi.verification}</dd></div>
      <div><dt>Coordinates</dt><dd>{poi.lat.toFixed(5)}, {poi.lon.toFixed(5)}</dd></div>
    </dl>
    <Btn variant="primary" arrow onClick={() => j.openNeed(poi.node)}>GO TO RELIEF</Btn>
  </div>;
}

/* ---------------- Thermal map ---------------- */
export function ThermalPage() {
  const j = useJ();
  const [layers, setLayers] = useLayers();
  return <Gate>{plan => {
    const r = j.route ?? plan.routes[0];
    return <div className="cmd">
      <div className="cmd-head">
        <PageHero eyebrow="THERMAL MAP" title={<>WHERE IS THE <em className="hot">CITY HOT?</em></>}
          sub="Every road segment is LOW, MODERATE, ELEVATED or HIGH estimated thermal load: thresholds on a model index, not temperatures people feel." />
        <Toggles layers={layers} set={setLayers} />
      </div>
      <div className="cmd-stage">
        <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected} pois={j.boot.relief} layers={layers}
          waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination}
          focusSegment={j.seg ? { route: j.seg.route.id, index: j.seg.index } : null}
          onSegment={(rt, i) => j.setSeg({ route: rt, index: i })} />
        <aside className="float left cond">
          <div className="temp"><b>{f(plan.weather.temperature_c, 0)}<small>°C</small></b>
            <span><Badge kind="DEMO DATA" /><small>{plan.weather.source}</small></span></div>
          <div className="cond-row"><span><Ico n="sun" size={15} />Sun elevation<b>{f(plan.sun.elevation, 0)}°</b></span>
            <span>Azimuth<b>{f(plan.sun.azimuth, 0)}°</b></span></div>
          <button role="switch" aria-checked={j.req.heatwave} className={`switch2 ${j.req.heatwave ? "on" : ""}`}
            onClick={() => j.setReq({ heatwave: !j.req.heatwave })}>
            <i aria-hidden="true" /><span><b>HEATWAVE MODE</b>
              <small>scenario · +4 °C demo offset; threshold {plan.heatwave.threshold_c} °C is illustrative</small></span></button>
          <div className="classes2" aria-label="Selected route classes">{(["LOW", "MODERATE", "ELEVATED", "HIGH"] as const).map(c =>
            <div key={c}><b style={{ color: HEAT_COLOR[c] }}>{r.classes[c]}</b><i style={{ background: HEAT_COLOR[c] }} /><small>{c}</small></div>)}</div>
          <RouteTabs />
        </aside>
        <aside className="float right"><WhySegment /></aside>
        <div className="float bottom thin"><Legend /></div>
      </div>
    </div>;
  }}</Gate>;
}

/* ---------------- Exposure ---------------- */
function Timeline({ route }: { route: JRoute }) {
  const j = useJ();
  const active = j.seg && j.seg.route.id === route.id ? j.seg.index : null;
  return <div>
    <HeatStrip route={route} tall active={active} onPick={i => j.setSeg({ route, index: i })} />
    <div className="tl-ends"><span>START</span><span>DESTINATION</span></div>
  </div>;
}

/** The journey as a story: start, heat stretches, relief stops, destination. */
function storyOf(route: JRoute) {
  const items: { key: string; label: string; tone: string }[] = [{ key: "s", label: "START", tone: "edge" }];
  let lastCls = "";
  route.segments.forEach((s, i) => {
    if (s.heat_class !== lastCls) {
      lastCls = s.heat_class;
      items.push({ key: `h${i}`, tone: s.heat_class,
        label: s.heat_class === "HIGH" || s.heat_class === "ELEVATED" ? "HIGH HEAT" : s.heat_class === "MODERATE" ? "WARM" : "COOLER STRETCH" });
    }
    route.corridor.stages.filter(st => st.node === s.b).forEach(st =>
      items.push({ key: `r${i}${st.poi}`, tone: "relief", label: st.kinds.join(" + ") }));
  });
  items.push({ key: "d", label: "DESTINATION", tone: "edge" });
  return items;
}

function ExposureChart({ route }: { route: JRoute }) {
  const j = useJ();
  const W = 800, H = 210, P = 18;
  const total = route.segments.reduce((a, s) => a + s.minutes, 0) || 1;
  const sum = route.segments.reduce((a, s) => a + s.load, 0) || 1;
  const maxRate = Math.max(...route.segments.map(s => s.rate), 0.01);
  let tAcc = 0, lAcc = 0;
  const pts: { x: number; y: number }[] = [{ x: P, y: H - 52 }];
  const rects = route.segments.map((s, i) => {
    const x0 = P + (tAcc / total) * (W - P * 2);
    tAcc += s.minutes; lAcc += s.load;
    const x1 = P + (tAcc / total) * (W - P * 2);
    pts.push({ x: x1, y: H - 52 - (lAcc / sum) * (H - 80) });
    return { i, s, x0, x1, bar: (s.rate / maxRate) * 34 };
  });
  const line = pts.map(p => `${p.x},${p.y}`).join(" ");
  const nodeX = (n: number) => { const idx = route.nodes.indexOf(n); return idx <= 0 ? P : (pts[Math.min(idx, pts.length - 1)]?.x ?? P); };
  const active = j.seg && j.seg.route.id === route.id ? j.seg.index : null;
  return <svg className="expchart" viewBox={`0 0 ${W} ${H}`} role="img"
    aria-label={`Cumulative estimated thermal exposure along ${route.label}, ending at ${f(route.load)} units`}>
    <defs>
      <linearGradient id="expfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffab5c" stopOpacity=".42" /><stop offset="1" stopColor="#ffab5c" stopOpacity="0" /></linearGradient>
      <linearGradient id="expline" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#7df0c0" /><stop offset="1" stopColor="#ffab5c" /></linearGradient>
    </defs>
    {[0.25, 0.5, 0.75, 1].map(g => <line key={g} x1={P} x2={W - P} y1={H - 52 - g * (H - 80)} y2={H - 52 - g * (H - 80)} stroke="#fff" strokeOpacity=".06" />)}
    <polygon points={`${P},${H - 52} ${line} ${pts[pts.length - 1].x},${H - 52}`} fill="url(#expfill)" />
    <polyline className="expdraw" points={line} fill="none" stroke="url(#expline)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    {rects.map(({ i, s, x0, x1, bar }) => <g key={i}>
      <rect x={x0 + 1} y={H - 40 - bar + 22} width={Math.max(2, x1 - x0 - 2)} height={bar} rx="3" fill={HEAT_COLOR[s.heat_class]} opacity={active === null || active === i ? 0.95 : 0.35} />
      <rect className="hit" x={x0} y={8} width={Math.max(2, x1 - x0)} height={H - 16} fill="transparent" tabIndex={0} role="button"
        aria-label={`Segment ${i + 1}: ${s.heat_class}`} onClick={() => j.setSeg({ route, index: i })}
        onKeyDown={e => { if (e.key === "Enter") j.setSeg({ route, index: i }); }} />
    </g>)}
    {route.corridor.stages.map(st => <g key={st.poi} transform={`translate(${nodeX(st.node)},${H - 52})`} pointerEvents="none">
      <line y1="0" y2={-(H - 80)} stroke="#6fd8ff" strokeOpacity=".28" strokeDasharray="3 5" />
      <circle r="6" fill="#06120f" stroke="#6fd8ff" strokeWidth="2.5" />
    </g>)}
    <text x={P} y={H - 2} fontSize="10" fill="#a9bdb5" letterSpacing="1.4">START</text>
    <text x={W - P} y={H - 2} fontSize="10" fill="#a9bdb5" textAnchor="end" letterSpacing="1.4">DESTINATION · {f(total)} MIN</text>
  </svg>;
}

export function ExposurePage() {
  const j = useJ();
  return <Gate>{plan => {
    const r = j.route ?? plan.routes[0];
    const keys = Object.keys(r.breakdown);
    const maxAbs = Math.max(...plan.routes.flatMap(x => Object.values(x.breakdown).map(Math.abs)), 1);
    const fast = plan.routes.find(x => x.id === "fastest");
    const hi = r.classes.HIGH + r.classes.ELEVATED;
    return <div className="expo">
      <PageHero eyebrow="EXPOSURE" title={<>THERMAL JOURNEY <em>INTELLIGENCE</em></>}
        sub={<>Estimated thermal exposure in illustrative units. Not body temperature, not a health prediction. <Badge kind="MODEL ESTIMATE" /></>} />
      <RouteTabs />
      <section className="expo-hero">
        <div className="score">
          <span className="eyebrow">THERMAL EXPOSURE · {r.label}</span>
          <b><AnimNum value={r.load} /><small> u</small></b>
          <span className={`ctx ${r.delta_vs_fastest.load_pct < 0 ? "good" : ""}`}>{r.id === "fastest" || !fast ? "BASELINE · FASTEST ROUTE"
            : `${sign(r.delta_vs_fastest.load_pct, 0)}% ESTIMATED THERMAL LOAD VS FASTEST`}</span>
        </div>
        <div className="score-side">
          <Metric icon="shade" label="ESTIMATED SHADE" value={f(r.shade * 100, 0)} unit="%" bar={r.shade} tone="cool" />
          <Metric icon="alert" label="HIGH EXPOSURE SEGMENTS" value={hi} unit={` of ${r.segments.length}`} bar={hi / Math.max(1, r.segments.length)} tone="hot" />
          <Metric icon="rest" label="RELIEF INTERVENTIONS" value={r.relief_count} sub={`${r.water_on_route} water · ${r.rest_on_route} rest · ${r.cooling_on_route} cooling`} tone="blue" />
        </div>
      </section>
      <section className="story" aria-label="Journey story">
        {storyOf(r).map((it, i, a) => <span key={it.key} className="story-item">
          <span className={`story-node ${it.tone}`} style={it.tone in HEAT_COLOR ? { borderColor: HEAT_COLOR[it.tone as keyof typeof HEAT_COLOR], color: HEAT_COLOR[it.tone as keyof typeof HEAT_COLOR] } : undefined}>{it.label}</span>
          {i < a.length - 1 && <i className="story-link" aria-hidden="true" />}
        </span>)}
      </section>
      <section className="viz">
        <div className="sec-head"><h2>{r.label}: EXPOSURE ALONG THE JOURNEY</h2><small className="muted">rises where the sun bites, flattens where relief helps</small></div>
        <ExposureChart route={r} />
        <Timeline route={r} />
        <WhySegment />
      </section>
      <section className="viz">
        <div className="sec-head"><h2>WHERE THE EXPOSURE COMES FROM</h2></div>
        {keys.map(k => <div key={k} className="bars"><span>{k}</span>
          <div>{plan.routes.filter(x => x.id !== "balanced").map(x => {
            const v = x.breakdown[k] ?? 0;
            return <div key={x.id} className="bar"><em>{x.label}</em>
              <u><i className={v < 0 ? "neg" : ""} style={{ width: `${Math.abs(v) / maxAbs * 100}%` }} /></u>
              <b>{sign(v)} u</b></div>;
          })}</div></div>)}
        <p className="muted">Components reconcile to the route total (validator checks this on every plan).</p>
      </section>
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
  const [poi, setPoi] = useState<(JPOI & { distance?: number }) | null>(null);
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
  return <div className="cmd">
    <div className="cmd-head">
      <PageHero eyebrow="RELIEF NETWORK" title={<>RAHAT&apos;S HIDDEN <em>RELIEF NETWORK</em></>}
        sub={<>Shade, water, rest and cooling the city already has. Showing relief around <b>{j.boot.map.nodes[node].name}</b>.</>}>
        <div className="row">
          <Btn variant="primary" icon="bolt" onClick={() => j.openNeed(node)}>I NEED RAHAT</Btn>
          <Btn icon="locate" onClick={locate}>Use my location</Btn>
          <Btn icon="pin" aria-pressed={pickMode} className={pickMode ? "active" : ""} onClick={() => setPickMode(!pickMode)}>Select on map</Btn>
        </div>
      </PageHero>
      <div className="filterbar" role="group" aria-label="Type filter">{types.map(t =>
        <button key={t} className="chip" aria-pressed={filter === t} onClick={() => setFilter(t)}>
          {t !== "ALL" && <NeedIco k={t} size={15} />}{t}</button>)}</div>
    </div>
    <div className="cmd-stage">
      <Gate>{plan => <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected}
        pois={shown} layers={layers} waypoints={[]} origin={node} destination={j.req.destination}
        closed={j.req.closed_relief} pick={pickMode} onNode={n => { setNode(n); setPickMode(false); }}
        onPOI={setPoi} highlight={poi?.id} />}</Gate>
      <aside className="float left around">
        <div className="sec-head"><h2>AROUND ME</h2>
          <div className="chips" role="group" aria-label="Radius">{[250, 500, 1000, 2000].map(r =>
            <button key={r} className="chip sm" aria-pressed={radius === r} onClick={() => setRadius(r)}>{r >= 1000 ? `${r / 1000} km` : `${r} m`}</button>)}</div></div>
        {err && <ErrorBox message={err} />}
        {!around ? <Loading text="Finding nearby relief…" /> : around.items.length === 0
          ? <Empty title="Nothing within this radius" text="Widen the radius or pick another point." />
          : <ul className="rlist">{around.items.map(p => <li key={p.id}>
            <button className={poi?.id === p.id ? "on" : ""} style={{ ["--pc" as string]: POI_COLOR[p.type] ?? "#7df0c0" }} onClick={() => setPoi(p)}>
              <span className="pc-ico"><NeedIco k={p.type} size={18} /></span>
              <span className="r-t"><b>{p.name}</b><small>{p.type} · <Badge kind="DEMO DATA" /></small></span>
              <span className="r-d"><b>{dist(p.distance)}</b><small>{p.status}</small></span>
            </button></li>)}</ul>}
        <p className="muted tiny">{shown.length} demo points. None are real facilities and none are verified. Location is only read when you press the button and is never stored.</p>
      </aside>
      {poi && <aside className="float right"><PoiCard poi={poi} distance={poi.distance} onClose={() => setPoi(null)} /></aside>}
    </div>
  </div>;
}

/* ---------------- Compare ---------------- */
function BarRow({ label, value, frac, tone }: { label: string; value: string; frac: number; tone: "hot" | "cool" | "blue" }) {
  return <div className={`brow ${tone}`}><span>{label}</span><b>{value}</b>
    <i aria-hidden="true"><u style={{ width: `${Math.max(0.03, Math.min(1, frac)) * 100}%` }} /></i></div>;
}
export function ComparePage() {
  const j = useJ();
  const nav = useNavigate();
  const [pop, setPop] = useState(0);
  return <Gate>{plan => {
    const three = (["fastest", "rahat", "relief-priority"] as const)
      .map(id => plan.routes.find(r => r.id === id)).filter((r): r is JRoute => !!r);
    const maxLoad = Math.max(...three.map(r => r.load), 0.01);
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
    const cur = plan.routes.find(r => r.id === j.selected) ?? plan.routes[0];
    return <div className="cmp2">
      <PageHero eyebrow="ROUTE COMPARISON" title={<>WHICH WAY SHOULD <em>YOU TAKE?</em></>}
        sub="Fastest, RAHAT and Relief Priority, side by side. The recommended route stands out." />
      <div className="rv3">
        {three.map(r => {
          const rec = r.id === "rahat", sel = j.selected === r.id;
          return <section key={r.id} role="group" aria-label={`${r.label} route`} className={`rv ${r.id} ${rec ? "rec" : ""} ${sel ? "sel" : ""}`}
            data-pop={sel ? pop : undefined}>
            {rec && <span className="rec-badge"><Ico n="spark" size={13} />RECOMMENDED</span>}
            {sel && <span className="sel-badge"><Ico n="check" size={12} />SELECTED</span>}
            <span className="eyebrow">{r.label}{r.same_geometry_as ? ` · same path as ${r.same_geometry_as}` : ""}</span>
            <b className="eta">{f(r.minutes)}<small> min</small></b>
            <span className="rv-sub">{dist(r.distance)} · {sign(r.detour_minutes)} min detour</span>
            <HeatStrip route={r} />
            <div className="rv-bars">
              <BarRow label="Thermal exposure" value={`${f(r.load)} u`} frac={r.load / maxLoad} tone="hot" />
              <BarRow label="Estimated shade" value={`${f(r.shade * 100, 0)}%`} frac={r.shade} tone="cool" />
            </div>
            <ul className="rv-relief">
              <li><Ico n="water" size={16} /><b>{r.water_on_route}</b><small>water</small></li>
              <li><Ico n="rest" size={16} /><b>{r.rest_on_route}</b><small>rest</small></li>
              <li><Ico n="cooling" size={16} /><b>{r.cooling_on_route}</b><small>cooling</small></li>
            </ul>
            <Btn variant={sel ? "primary" : "secondary"} size="lg" success={sel} aria-pressed={sel}
              icon={sel ? "check" : undefined} onClick={() => { j.select(r.id); setPop(p => p + 1); }}>
              {sel ? (rec ? "RAHAT ROUTE SELECTED ✓" : `${r.label} ROUTE SELECTED ✓`) : "SELECT ROUTE"}</Btn>
          </section>;
        })}
      </div>
      <section className="cmp-map">
        <JourneyMap map={j.boot.map} routes={plan.routes} selected={j.selected} pois={j.boot.relief}
          layers={{ thermal: true, shade: true, relief: true, alternatives: true }}
          waypoints={j.req.waypoints.map(w => w.node)} origin={j.req.origin} destination={j.req.destination} />
        <div className="cmp-dock">
          <div><span className="eyebrow">{cur.label} ROUTE SELECTED</span>
            <b>{f(cur.minutes)} min · {dist(cur.distance)} · {f(cur.load)} u</b></div>
          <Btn variant="primary" size="xl" arrow onClick={() => { j.startLive(); nav("/journey/live"); }}>CONTINUE TO JOURNEY</Btn>
        </div>
      </section>
      <section className="plain"><span className="eyebrow">IN PLAIN WORDS</span><p>{why(plan.routes, j.req.needs)}</p>
        <div className="row"><Badge kind="MODEL ESTIMATE" /><Badge kind="DEMO DATA" /><Badge kind="AI EXPLANATION" /></div>
        <p className="muted">This explanation is templated from engine numbers (deterministic). The AI badge appears only when a Bedrock adapter is enabled.</p></section>
      <details className="fulltable"><summary>Full comparison table</summary>
        <div className="tablewrap"><table className="cmp">
          <thead><tr><th />{plan.routes.map(r => <th key={r.id} className={r.id === j.selected ? "sel" : ""}>{r.label}
            {r.same_geometry_as && <small>same path as {r.same_geometry_as}</small>}</th>)}</tr></thead>
          <tbody>{rows.map(([label, fn]) => <tr key={label}><th scope="row">{label}</th>
            {plan.routes.map(r => <td key={r.id} className={r.id === j.selected ? "sel" : ""}>{fn(r)}</td>)}</tr>)}</tbody>
        </table></div></details>
    </div>;
  }}</Gate>;
}

/* ---------------- Live journey ---------------- */
export function LivePage() {
  const j = useJ();
  const nav = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [layers, setLayers] = useLayers({ alternatives: false });
  const live = j.live;
  const pos = useMemo(() => {
    if (!live) return null;
    const s = live.route.segments[Math.min(live.seg, live.route.segments.length - 1)];
    const a = j.boot.map.nodes[s.a], b = j.boot.map.nodes[s.b];
    return { x: a.x + (b.x - a.x) * live.t, y: a.y + (b.y - a.y) * live.t };
  }, [live, j.boot.map.nodes]);
  if (!live) return <div className="live-empty"><Empty title="No journey is active" text="Choose a route, then press START JOURNEY. This version runs a SIMULATED JOURNEY; real GPS is a future provider.">
    <div className="row"><Btn variant="primary" size="lg" arrow onClick={() => nav("/journey/route")}>Choose a route</Btn></div></Empty></div>;
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
  const next = [...ahead].sort((a, b) => a.d - b.d)[0];
  const nearestOf = (k: string) => ahead.filter(a => a.st.kinds.includes(k)).sort((a, b) => a.d - b.d)[0];
  const stat = (key: string, title: string, value: ReactNode, sub?: string) =>
    <button key={key} className={`lstat ${open === key ? "on" : ""}`} aria-expanded={open === key}
      onClick={() => setOpen(open === key ? null : key)}><small>{title}</small><b>{value}</b>{sub && <small>{sub}</small>}</button>;
  const ntile = (k: "SHADE" | "WATER" | "REST" | "COOLING") => {
    const n = nearestOf(k);
    return <button key={k} className={`ntile ${open === k.toLowerCase() ? "on" : ""}`} style={{ ["--pc" as string]: NEED_COLOR[k] }}
      aria-expanded={open === k.toLowerCase()} onClick={() => setOpen(open === k.toLowerCase() ? null : k.toLowerCase())}>
      <span className="pc-ico"><NeedIco k={k} size={20} /></span>
      <span className="nt-t"><small>NEXT {k}</small><b>{n ? dist(n.d) : "none ahead"}</b>{n && <small>{f(n.m)} min · on route</small>}</span>
    </button>;
  };
  return <div className="live2">
    <PageHero eyebrow="LIVE JOURNEY" title={live.arrived ? "You have arrived" : <>{f(remMin)} <em>min to go</em></>}
      sub={<>{dist(remDist)} remaining · {f(live.elapsed)} min elapsed · now <HeatChip cls={s.heat_class} /></>} />
    <div className="live-stage">
      <JourneyMap map={j.boot.map} routes={[r]} selected={r.id} pois={j.boot.relief} layers={layers}
        waypoints={j.req.waypoints.map(w => w.node)} origin={r.nodes[0]} destination={j.req.destination}
        position={pos} follow={follow} closed={j.req.closed_relief} focusSegment={{ route: r.id, index: live.seg }}
        onSegment={(rt, i) => j.setSeg({ route: rt, index: i })} />
      <div className="float top livebar" role="status">
        <b className={`livepill ${live.running ? "run" : ""}`}><i />{live.arrived ? "ARRIVED" : "RAHAT JOURNEY ACTIVE"}</b>
        <Badge kind="SIMULATED JOURNEY" /><Badge kind="DEMO DATA" />
        <span className="grow" />
        {!live.arrived && (live.running
          ? <Btn icon="pause" onClick={() => j.liveControl("pause")}>Pause</Btn>
          : <Btn variant="primary" icon="play" onClick={() => j.liveControl("resume")}>Resume</Btn>)}
        <Btn onClick={() => j.liveControl("speed")} aria-label="Change simulation speed">{live.speed}× speed</Btn>
        <Btn icon="locate" aria-pressed={follow} className={follow ? "active" : ""} onClick={() => setFollow(!follow)}>Follow rider</Btn>
        <Btn variant="danger" onClick={() => { j.liveControl("end"); nav("/journey/route"); }}>End</Btn>
      </div>
      <div className="float bottom live-dock">
        <div className="prail" role="progressbar" aria-label="Journey progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <i style={{ width: `${progress * 100}%` }} /><span className="rdot" style={{ left: `${progress * 100}%` }} />
        </div>
        <Timeline route={r} />
        <div className="ntiles">
          {ntile("SHADE")}{ntile("WATER")}{ntile("REST")}{ntile("COOLING")}
          <button className="need-cta" onClick={() => j.openNeed()}><Ico n="bolt" size={22} />
            <span><small>NOW</small><b>I NEED RAHAT</b></span></button>
        </div>
      </div>
    </div>
    <Toggles layers={layers} set={setLayers} />
    <div className="lstats">
      {stat("heat", "HEAT", s.heat_class, `${f(s.shade * 100, 0)}% est. shade`)}
      {stat("exposure", "EXPOSURE", `${f(live.exposure)} u`, "so far")}
      {stat("relief", "RELIEF", String(ahead.length), "points ahead")}
      {stat("route", "ROUTE", `${f(remMin)} min`, dist(remDist))}
    </div>
    {open && <section className="ldetail">
      <span className="eyebrow">{open.toUpperCase()}</span>
      {open === "heat" && <p>{s.explanation}</p>}
      {open === "exposure" && <p>You have accumulated about {f(live.exposure)} estimated exposure units over {f(live.elapsed)} min of simulated riding. Remaining route estimate: {f(r.segments.slice(live.seg + 1).reduce((a, e) => a + e.load, 0))} u. <Badge kind="MODEL ESTIMATE" /></p>}
      {["water", "shade", "rest", "cooling"].includes(open) && (nearestOf(open.toUpperCase())
        ? <p>Next {open} on route: {nearestOf(open.toUpperCase()).st.name}, {dist(nearestOf(open.toUpperCase()).d)} ahead, about {f(nearestOf(open.toUpperCase()).m)} min. <Badge kind="DEMO DATA" /></p>
        : <p>No {open} point remains on this route. Press I NEED RAHAT to look nearby.</p>)}
      {open === "relief" && <Corridor route={r} />}
      {open === "route" && <p>{r.label} route · {dist(total)} total · {r.segments.length} segments · {r.classes.HIGH} high-load.</p>}
    </section>}
    {j.change && <WhatChanged change={j.change} onDismiss={() => j.setChange(null)} />}
    <div className="live-cols">
      <section className="nextstop">
        <div className="sec-head"><h2>NEXT STOP</h2><Badge kind="MODEL ESTIMATE" /></div>
        {next ? <>
          <h3>{next.st.name}</h3>
          <div className="stats">
            <Stat label="Type" value={next.st.kinds.join(" + ")} /><Stat label="Distance" value={dist(next.d)} />
            <Stat label="ETA" value={`${f(next.m)} min`} /><Stat label="Detour" value="0 min (on route)" />
            <Stat label="Availability" value={next.poi?.availability ?? "n/a"} /><Stat label="Confidence" value="Low (demo)" />
          </div>
          <h4>WHY RAHAT RECOMMENDS IT</h4>
          <p>It sits on your current path, so it costs no detour. {next.hot > 0
            ? `${next.hot} elevated or high-load segment${next.hot === 1 ? " lies" : "s lie"} before it, so it is the nearest point to recover from sun exposure.`
            : "The way there is low or moderate in estimated load."} {next.poi?.shade ? "It also offers estimated shade." : ""}</p>
        </> : <p>No relief point remains ahead on this route. I NEED RAHAT searches nearby.</p>}
      </section>
      <section className="changed">
        <div className="sec-head"><h2>SOMETHING CHANGED?</h2></div>
        <div className="chips">
          <Btn disabled={live.arrived} loading={j.busy} onClick={() => j.proposePatch({ delay_min: Math.min(30, j.req.delay_min + 8) }, "Demo traffic delay increased by 8 min on a link of your route.")}>Traffic got worse</Btn>
          <Btn disabled={live.arrived} loading={j.busy} onClick={() => j.proposePatch({ heatwave: true }, "Environmental scenario: temperature offset +4 °C.")}>It got hotter</Btn>
          <Btn disabled={live.arrived || !ahead[0]} loading={j.busy} onClick={() => ahead[0] && j.proposePatch({ closed_relief: [...j.req.closed_relief, ahead[0].st.poi] }, `${ahead[0].st.name} reported unavailable (scenario).`)}>Next relief closed</Btn>
        </div>
        <p className="muted">The route is only proposed, never changed silently.</p>
        {live.arrived && <p className="summary">Simulated journey complete: about {f(live.exposure)} estimated exposure units over {f(live.elapsed)} min.
          This is a model estimate, not a health measure.</p>}
      </section>
    </div>
  </div>;
}

/* ---------------- I NEED RAHAT dialog ---------------- */
const NEED_KINDS = ["WATER", "SHADE", "REST", "COOLING"] as const;
const flagOf = (p: JPOI, k: string) => (k === "WATER" ? p.water : k === "SHADE" ? p.shade : k === "REST" ? p.rest : p.cooling);
export function NeedDialog() {
  const j = useJ();
  const { need } = j;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [kind, setKind] = useState<string>("WATER");
  const [pickId, setPickId] = useState<string | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") j.closeNeed(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [j]);
  const res: NeedResult | null = need.result;
  const options: NeedItem[] = res ? res.items.filter(p => flagOf(p, kind)).slice(0, 3) : [];
  const chosen = options.find(o => o.id === pickId) ?? options[0] ?? null;
  const origin = j.boot.map.nodes[need.node];
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Nearby relief"
    onMouseDown={e => { if (e.target === e.currentTarget) j.closeNeed(); }}>
    <div className="sheet need-sheet">
      <header><div><span className="eyebrow">I NEED RAHAT</span><h2>WHAT DO YOU NEED RIGHT NOW?</h2></div>
        <button ref={closeRef} className="icon-btn" aria-label="Close relief" onClick={j.closeNeed}><Ico n="close" size={18} /></button></header>
      <p className="muted">Nearest relief opportunities from {origin.name}. This is not a medical assessment; if you feel unwell, seek help.</p>
      {need.loading && <Loading text="Finding nearby relief…" />}
      {need.error && <ErrorBox message={need.error} />}
      {res && <>
        <div className="needgrid" role="group" aria-label="What you need">{NEED_KINDS.map(k => {
          const v = res.by_type[k];
          const p = v ? j.boot.relief.find(x => x.id === v.id) : null;
          return <button key={k} className={`needopt ${kind === k ? "on" : ""}`} style={{ ["--pc" as string]: NEED_COLOR[k] }}
            aria-pressed={kind === k} disabled={!v} onClick={() => { setKind(k); setPickId(null); }}>
            <span className="pc-ico"><NeedIco k={k} size={22} /></span>
            <b>{k}</b>
            {v ? <><span className="no-d">{dist(v.distance_m)}</span>
              <small>+{f(v.detour_minutes)} min detour</small>
              <small className="avail"><i />{p ? `${p.status} · ${p.availability}` : "listed"}</small></>
              : <small>none within 1 km</small>}
          </button>;
        })}</div>
        {options.length === 0 ? <Empty title={`No ${kind.toLowerCase()} within 1 km`} text="Pick another need, or move toward the destination." />
          : <>
            <ul className="opts" aria-label={`${kind} options`}>{options.map((p, i) => <li key={p.id}>
              <button className={chosen?.id === p.id ? "on" : ""} aria-pressed={chosen?.id === p.id} onClick={() => setPickId(p.id)}>
                <span className="rank">{i + 1}</span>
                <span className="r-t"><b>{p.name}</b><small>{p.why}</small></span>
                <span className="r-d"><b>{dist(p.distance)}</b><small>+{f(p.detour_minutes)} min</small></span>
              </button></li>)}</ul>
            {chosen && <div className="routepreview" key={chosen.id}>
              <svg viewBox="0 0 320 78" className="mini-route" role="img" aria-label={`Route to ${chosen.name}`}>
                <path d="M26 54 C110 6 210 6 292 50" fill="none" stroke="#7df0c0" strokeOpacity=".2" strokeWidth="9" strokeLinecap="round" />
                <path className="draw2" pathLength={1} d="M26 54 C110 6 210 6 292 50" fill="none" stroke="#7df0c0" strokeWidth="4" strokeLinecap="round" />
                <circle cx="26" cy="54" r="8" fill="#f3f8f5" stroke="#06120f" strokeWidth="3" />
                <circle className="pop-end" cx="292" cy="50" r="12" fill="#06120f" stroke={NEED_COLOR[kind]} strokeWidth="3.5" />
              </svg>
              <div className="rp-meta"><b>{chosen.name}</b>
                <span>{dist(chosen.distance)} · +{f(chosen.detour_minutes)} min detour · {f(chosen.minutes)} min away</span>
                <div className="row"><Badge kind="DEMO DATA" /><Badge kind="MODEL ESTIMATE" /></div></div>
            </div>}
            <div className="row need-actions">
              <Btn onClick={j.closeNeed}>Not now</Btn>
              <Btn variant="primary" size="xl" arrow loading={j.busy} disabled={!chosen} onClick={() => chosen && void j.proposeRelief(chosen)}>UPDATE MY JOURNEY</Btn>
            </div>
          </>}
        <details className="allnear"><summary>All nearby relief ({res.items.length})</summary>
          {res.items.length === 0 ? <p className="muted">No relief within 1 km.</p>
            : <ul className="plist ranked">{res.items.slice(0, 5).map((p, i) => <li key={p.id}>
              <div><b>{i + 1}. {p.name}</b><span>{p.type} · {dist(p.distance)} · +{f(p.detour_minutes)} min detour</span>
                <small>{p.why}</small><div className="row"><Badge kind="DEMO DATA" /><Badge kind="MODEL ESTIMATE" /></div></div>
              <Btn variant="primary" disabled={j.busy} onClick={() => void j.proposeRelief(p)}>Route here</Btn></li>)}</ul>}
        </details>
        <small className="muted">Ranked by network distance, detour and exposure on the way. {res.framing}</small>
      </>}
    </div>
  </div>;
}

/* ---------------- Scenario lab ---------------- */
type Sc = { key: string; label: string; vs: string; icon: IcoName; group: "act" | "cond" };
const SCENARIOS: Sc[] = [
  { key: "none", label: "NO INTERVENTION", vs: "WITHOUT INTERVENTION", icon: "route", group: "act" },
  { key: "shade", label: "SHADE STOP", vs: "WITH SHADE STOP", icon: "shade", group: "act" },
  { key: "water", label: "WATER STOP", vs: "WITH WATER STOP", icon: "water", group: "act" },
  { key: "cooling", label: "COOLING STOP", vs: "WITH COOLING STOP", icon: "cooling", group: "act" },
  { key: "alt", label: "ALTERNATIVE ROUTE", vs: "WITH RELIEF-PRIORITY ROUTE", icon: "layers", group: "act" },
  { key: "traffic", label: "Traffic gets worse", vs: "AFTER TRAFFIC WORSENS", icon: "clock", group: "cond" },
  { key: "heatwave", label: "Heatwave (+4 °C)", vs: "DURING A HEATWAVE", icon: "sun", group: "cond" },
  { key: "later", label: "Leave 2 h later", vs: "LEAVING 2 H LATER", icon: "clock", group: "cond" },
  { key: "relief-closed", label: "A relief point closes", vs: "WITH A RELIEF POINT CLOSED", icon: "alert", group: "cond" },
];
interface ScResult {
  key: string; vs: string; reason: string; before: ReturnType<typeof metricsOf>; now: ReturnType<typeof metricsOf>;
  geo: boolean; apply: () => void; plan?: NonNullable<ReturnType<typeof useJ>["plan"]>; show?: JRoute["id"];
}
function VsRow({ label, icon, a, b, d, fmt, lowerIsBetter }: {
  label: string; icon: IcoName; a: number; b: number; d: number; fmt: (v: number) => string; lowerIsBetter: boolean;
}) {
  const diff = b - a;
  const tone = Math.abs(diff) < 1e-9 ? "" : (lowerIsBetter ? diff < 0 : diff > 0) ? "good" : "bad";
  const unit = (v: number) => { void d; return fmt(v); };
  return <div className={`vsrow ${tone}`}>
    <span className="vl"><Ico n={icon} size={15} />{label}</span>
    <b className="va">{unit(a)}</b>
    <span className="varrow" aria-hidden="true"><Ico n="arrow" size={16} /></span>
    <b className="vb"><AnimNum value={b} digits={label === "RELIEF POINTS" ? 0 : 1} prefix="" /></b>
    <span className="vd">{Math.abs(diff) < 1e-9 ? "no change" : fmt(diff).replace(/^-/, "−")}</span>
  </div>;
}
export function ScenarioPage() {
  const j = useJ();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [cur, setCur] = useState<ScResult | null>(null);
  const base = j.plan?.routes.find(r => r.id === "rahat") ?? j.route;
  const run = async (sc: Sc) => {
    setBusy(sc.key); setErr("");
    try {
      if (!base || !j.plan) throw new Error("Routes are still loading. Try again in a moment.");
      const b = metricsOf(base);
      if (sc.key === "none") {
        setCur({ key: sc.key, vs: sc.vs, reason: "With no intervention the RAHAT route stays exactly as planned.", before: b, now: b, geo: false, apply: () => {}, plan: j.plan, show: "rahat" });
      } else if (sc.key === "alt") {
        const alt = j.plan.routes.find(r => r.id === "relief-priority");
        if (!alt) throw new Error("No relief-priority alternative was produced for these inputs.");
        setCur({ key: sc.key, vs: sc.vs, reason: "The relief-priority route trades some time for more relief points along the way.",
          before: b, now: metricsOf(alt), geo: JSON.stringify(alt.nodes) !== JSON.stringify(base.nodes),
          apply: () => j.select("relief-priority"), plan: j.plan, show: "relief-priority" });
      } else if (sc.key === "shade" || sc.key === "water" || sc.key === "cooling") {
        const nodes = j.boot.map.nodes, o = nodes[j.req.origin], d = nodes[j.req.destination];
        const used = new Set([j.req.origin, j.req.destination, ...j.req.waypoints.map(w => w.node)]);
        const cands = j.boot.relief.filter(p => p.status === "OPEN" && !used.has(p.node) && !j.req.closed_relief.includes(p.id) && flagOf(p, sc.key.toUpperCase()));
        if (!cands.length) throw new Error(`No open ${sc.key} point exists in the demo data.`);
        const cost = (p: JPOI) => Math.hypot(nodes[p.node].x - o.x, nodes[p.node].y - o.y) + Math.hypot(nodes[p.node].x - d.x, nodes[p.node].y - d.y);
        const poi = [...cands].sort((x, y) => cost(x) - cost(y))[0];
        const nextReq: JReq = { ...j.req, waypoints: [...j.req.waypoints, { node: poi.node }] };
        const p = await api<NonNullable<ReturnType<typeof useJ>["plan"]>>("/journey/plan", nextReq);
        const after = p.routes.find(r => r.id === "rahat");
        if (!after) throw new Error("No alternative route was produced.");
        setCur({ key: sc.key, vs: sc.vs, reason: `A ${sc.key} stop at ${poi.name} was added to the journey and the engine re-planned the RAHAT route.`,
          before: b, now: metricsOf(after), geo: JSON.stringify(after.nodes) !== JSON.stringify(base.nodes),
          apply: () => j.setReq({ waypoints: nextReq.waypoints }), plan: p, show: "rahat" });
      } else {
        const r = await api<{ reason: string; before: JRoute; now: JRoute; geometry_changed: boolean; updated_request: JReq }>(
          "/journey/what-changed", { journey: j.req, change: sc.key });
        setCur({ key: sc.key, vs: sc.vs, reason: r.reason, before: metricsOf(r.before), now: metricsOf(r.now), geo: r.geometry_changed,
          apply: () => j.setReq({ delay_min: r.updated_request.delay_min, heatwave: r.updated_request.heatwave,
            departure: r.updated_request.departure, closed_relief: r.updated_request.closed_relief }) });
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "That scenario could not run."); }
    finally { setBusy(null); }
  };
  const Opt = (sc: Sc) => <button key={sc.key} className={`scopt ${cur?.key === sc.key ? "on" : ""}`} aria-pressed={cur?.key === sc.key}
    disabled={!!busy || !j.plan} aria-busy={busy === sc.key || undefined} onClick={() => void run(sc)}>
    {busy === sc.key ? <span className="spin" aria-hidden="true" /> : <Ico n={sc.icon} size={18} />}<span>{sc.label}</span></button>;
  return <div className="lab">
    <PageHero eyebrow="SCENARIO LAB" title={<>WHAT <em>IF?</em></>}
      sub="Change one thing and watch the cause become the effect. Each scenario re-runs the same engines and never edits your route by itself." />
    <div className="sc-groups">
      <div><span className="eyebrow">INTERVENTIONS</span><div className="scrow">{SCENARIOS.filter(s => s.group === "act").map(Opt)}</div></div>
      <div><span className="eyebrow">CONDITIONS</span><div className="scrow">{SCENARIOS.filter(s => s.group === "cond").map(Opt)}</div></div>
    </div>
    {busy && <Loading text="Checking alternatives…" />}
    {err && <ErrorBox message={err} />}
    {!cur && !busy && <Empty title="Pick a scenario" text="Results compare the RAHAT route before and after the change." />}
    {cur && <section className="versus" key={cur.key + cur.reason}>
      <div className="vs-head"><span className="eyebrow vs-a">WITHOUT INTERVENTION</span><span className="vs-mid">CAUSE → EFFECT</span><span className="eyebrow vs-b">{cur.vs}</span></div>
      <div className="vs-body">
        <VsRow label="ETA" icon="clock" a={cur.before.minutes} b={cur.now.minutes} d={1} lowerIsBetter fmt={v => `${f(v)} min`} />
        <VsRow label="THERMAL EXPOSURE" icon="heat" a={cur.before.load} b={cur.now.load} d={1} lowerIsBetter fmt={v => `${f(v)} u`} />
        <VsRow label="SHADE" icon="shade" a={cur.before.shade * 100} b={cur.now.shade * 100} d={1} lowerIsBetter={false} fmt={v => `${f(v, 0)}%`} />
        <VsRow label="RELIEF POINTS" icon="water" a={cur.before.relief} b={cur.now.relief} d={0} lowerIsBetter={false} fmt={v => String(Math.round(v))} />
      </div>
      <p className="vs-why">{cur.reason}</p>
      {cur.plan && <div className="vs-map"><JourneyMap map={j.boot.map} routes={cur.plan.routes} selected={cur.show ?? "rahat"} pois={j.boot.relief}
        layers={{ thermal: true, shade: true, relief: true, alternatives: false }} waypoints={[]} origin={j.req.origin} destination={j.req.destination} controls={false} /></div>}
    </section>}
    {cur && <WhatChanged change={{ reason: cur.reason, before: cur.before, after: cur.now, geometryChanged: cur.geo, apply: cur.apply }} onDismiss={() => setCur(null)} />}
  </div>;
}

/* ---------------- Community ---------------- */
interface Report { id: string; node: number; kind: string; note: string; status: string; created_at: string; city?: string }
const KINDS: { k: string; color: string; glyph: string; icon: IcoName }[] = [
  { k: "SHADE HERE", color: "#7fe3a4", glyph: "S", icon: "shade" },
  { k: "WATER HERE", color: "#6fd8ff", glyph: "W", icon: "water" },
  { k: "COOLING HERE", color: "#a8e6ff", glyph: "C", icon: "cooling" },
  { k: "REST POINT", color: "#c9b2f5", glyph: "R", icon: "rest" },
  { k: "NO WATER", color: "#ff9a7a", glyph: "×", icon: "alert" },
  { k: "SHADE REMOVED", color: "#f0b27a", glyph: "−", icon: "sun" },
  { k: "STATION CLOSED", color: "#ee5438", glyph: "!", icon: "alert" },
];
export function CommunityPage() {
  const j = useJ();
  const [items, setItems] = useState<Report[] | null>(null);
  const [kind, setKind] = useState(KINDS[1].k);
  const [node, setNode] = useState(j.req.origin);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [place, setPlace] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const load = () => api<{ items: Report[] }>("/reports").then(r => setItems(r.items.filter(x => x.city === "delhi")))
    .catch(() => setErr("Reports could not be loaded."));
  useEffect(() => { void load(); }, []);
  const submit = async () => {
    setSaving(true); setErr(""); setSaved(false);
    try { await api("/reports", { node, kind, note: note.slice(0, 500), city: "delhi" }); setNote(""); await load(); setSaved(true); setTimeout(() => setSaved(false), 2200); }
    catch (e) { setErr(e instanceof Error ? e.message : "Report could not be saved."); }
    finally { setSaving(false); }
  };
  const kmeta = (k: string) => KINDS.find(x => x.k === k) ?? KINDS[0];
  const visible = (items ?? []).filter(r => filter === "ALL" || r.kind === filter);
  const markers: MapMarker[] = visible.map(r => ({ id: r.id, node: r.node, color: kmeta(r.kind).color, glyph: kmeta(r.kind).glyph,
    label: `${r.kind} at ${j.boot.map.nodes[r.node]?.name ?? r.node}, ${r.status}`, dim: !!sel && sel !== r.id }));
  return <div className="cmd">
    <div className="cmd-head">
      <PageHero eyebrow="COMMUNITY MAP" title={<>CITIZEN HEAT &amp; <em>RELIEF INTELLIGENCE</em></>}
        sub="What people see on the street, as a live layer. Every report starts as UNVERIFIED and never alters routes, scores or relief status." />
      <div className="filterbar" role="group" aria-label="Report filter">
        {["ALL", ...KINDS.map(x => x.k)].map(k => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{k}</button>)}</div>
    </div>
    <div className="cmd-stage">
      <JourneyMap map={j.boot.map} routes={j.plan?.routes ?? []} selected="rahat" pois={[]}
        layers={{ thermal: true, shade: true, relief: false, alternatives: false }} waypoints={[]} origin={node} destination={j.req.destination}
        markers={markers} onMarker={m => setSel(m.id === sel ? null : m.id)} pick={place} onNode={n => { setNode(n); setPlace(false); }}
        label="Community reports on the demo map" badge="COMMUNITY REPORT · UNVERIFIED" />
      <aside className="float left composer">
        <div className="sec-head"><h2>NEW REPORT</h2><Badge kind="COMMUNITY REPORT" /></div>
        <div className="kinds" role="group" aria-label="Report type">{KINDS.map(x =>
          <button key={x.k} className="kind" style={{ ["--pc" as string]: x.color }} aria-pressed={kind === x.k} onClick={() => setKind(x.k)}>
            <Ico n={x.icon} size={16} />{x.k}</button>)}</div>
        <label>Where<select value={node} onChange={e => setNode(+e.target.value)}>
          {j.boot.map.nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <Btn icon="pin" aria-pressed={place} className={place ? "active" : ""} onClick={() => setPlace(!place)}>{place ? "Tap a dot on the map…" : "Place on map"}</Btn>
        <label>Note (optional)<textarea maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
        <Btn variant="primary" size="lg" arrow loading={saving} success={saved} onClick={() => void submit()}>{saved ? "Report saved ✓" : "Submit report"}</Btn>
        {err && <ErrorBox message={err} />}
      </aside>
      <aside className="float right feed">
        <div className="sec-head"><h2>REPORTS</h2><small className="muted">{visible.length} shown</small></div>
        {!items ? <Loading text="Loading reports…" /> : visible.length === 0
          ? <Empty title="No reports yet" text="Be the first to mark shade or water." />
          : <ul className="rlist">{visible.map(r => {
            const m = kmeta(r.kind);
            return <li key={r.id}><button className={sel === r.id ? "on" : ""} style={{ ["--pc" as string]: m.color }} onClick={() => setSel(sel === r.id ? null : r.id)}>
              <span className="pc-ico"><Ico n={m.icon} size={17} /></span>
              <span className="r-t"><b>{r.kind}</b><small>{j.boot.map.nodes[r.node]?.name ?? `Node ${r.node}`}{r.note ? ` · ${r.note}` : ""}</small></span>
              <Badge kind={r.status} /></button></li>;
          })}</ul>}
        <p className="muted tiny">Statuses: UNVERIFIED, COMMUNITY VERIFIED and SYSTEM VERIFIED. Promotion requires a verification workflow that is not connected in demo mode.</p>
      </aside>
    </div>
  </div>;
}

/* ---------------- Evidence + Settings ---------------- */
const confLevel = (c: string) => { const s = c.toLowerCase(); return /n\/a/.test(s) ? 0 : /high/.test(s) ? 3 : /medium|moderate/.test(s) ? 2 : 1; };
export function EvidencePage() {
  const j = useJ();
  return <Gate>{plan => {
    const r = j.route ?? plan.routes[0];
    const chain: { icon: IcoName; k: string; v: string; s: string }[] = [
      { icon: "sun", k: "ENVIRONMENT", v: `${f(plan.weather.temperature_c, 0)}°C`, s: `${plan.weather.source} · sun ${f(plan.sun.elevation, 0)}°` },
      { icon: "route", k: "ROUTE", v: `${f(r.minutes)} min`, s: `${dist(r.distance)} · ${r.label}` },
      { icon: "shade", k: "SHADE", v: `${f(r.shade * 100, 0)}%`, s: "estimated shade on route" },
      { icon: "water", k: "RELIEF", v: String(r.relief_count), s: `${r.water_on_route} water · ${r.rest_on_route} rest · ${r.cooling_on_route} cooling` },
      { icon: "layers", k: "MODEL ESTIMATE", v: `${f(r.load)} u`, s: r.confidence.split(":")[0] },
      { icon: "check", k: "RECOMMENDATION", v: r.label, s: r.id === "fastest" ? "baseline route" : `${sign(r.delta_vs_fastest.load_pct, 0)}% exposure vs fastest` },
    ];
    return <div className="evi">
      <PageHero eyebrow="EVIDENCE" title={<>WHY SHOULD I <em>TRUST THIS?</em></>}
        sub="Every number comes from an engine, with its source, time, coverage and limits shown. Nothing here is a live measurement." />
      <section className="why-hero">
        <span className="eyebrow">WHY RAHAT RECOMMENDED THIS ROUTE</span>
        <p>{why(plan.routes, j.req.needs) || r.confidence}</p>
        <div className="row"><Badge kind="MODEL ESTIMATE" /><Badge kind="DEMO DATA" /></div>
      </section>
      <ol className="echain" aria-label="Evidence chain">{chain.map((c, i) => <li key={c.k} style={{ animationDelay: `${i * 80}ms` }}>
        <span className="ec-ico"><Ico n={c.icon} size={20} /></span><small>{c.k}</small><b>{c.v}</b><span>{c.s}</span></li>)}</ol>
      <div className="sec-head"><h2>SOURCES AND PROVENANCE</h2></div>
      <ul className="prov">{plan.evidence.map(e => {
        const lv = confLevel(e.confidence);
        return <li key={e.source}>
          <div className="pv-head"><Badge kind={e.source} /><b>{e.source}</b>
            <span className="meter" aria-label={`Confidence: ${e.confidence}`}>{[1, 2, 3].map(n => <i key={n} className={n <= lv ? "on" : ""} />)}<small>{e.confidence}</small></span></div>
          <dl>
            <div><dt>Timestamp</dt><dd>{e.timestamp ?? "n/a"}</dd></div><div><dt>Coverage</dt><dd>{e.coverage}</dd></div>
            <div><dt>Method</dt><dd>{e.method}</dd></div><div><dt>Limitations</dt><dd>{e.limitations}</dd></div>
          </dl></li>;
      })}</ul>
      <div className="sec-head"><h2>AGENT ARCHITECTURE</h2></div>
      <p>Seven roles explain and validate. Engines produce every number.</p>
      <ul className="agents">{["Thermal Analysis", "Route Intelligence", "Relief Discovery", "Validator", "Journey Advisor", "Reassessment", "Evidence"].map(a => <li key={a}>{a}</li>)}</ul>
      <p className="muted">Explanations here are deterministic templates. Bedrock is an optional adapter for wording only (see Settings).</p>
    </div>;
  }}</Gate>;
}

function Switch2({ on, onChange, title, desc }: { on: boolean; onChange: (v: boolean) => void; title: string; desc: string }) {
  return <button role="switch" aria-checked={on} className={`switch2 ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
    <i aria-hidden="true" /><span><b>{title}</b><small>{desc}</small></span></button>;
}
export function SettingsPage() {
  const j = useJ();
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => { applyPrefs(prefs); }, [prefs]);
  const set = (p: Partial<typeof prefs>) => { const n = { ...prefs, ...p }; setPrefs(n); savePrefs(n); };
  const osReduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const live = j.boot.providers.filter(p => p.state !== "UNAVAILABLE").length;
  const Row = ({ n, title, children }: { n: string; title: string; children: ReactNode }) =>
    <section className="ctl"><div className="ctl-l"><span className="eyebrow">{n}</span><h2>{title}</h2></div><div className="ctl-r">{children}</div></section>;
  return <div className="settings">
    <PageHero eyebrow="SETTINGS" title={<>RAHAT <em>SYSTEM CONTROL</em></>}
      sub="Mode, data, providers and how RAHAT feels to use. Switches here take effect immediately." />
    <Row n="01" title="MODE">
      <div className="modes"><span className="mode on"><Ico n="check" size={16} /><b>DEMO MODE</b><small>active · local deterministic engines, no credentials</small></span>
        <span className="mode off"><b>REAL MODE</b><small>not connected · swaps provider implementations behind the same interfaces</small></span></div>
    </Row>
    <Row n="02" title="LOCATION">
      <p>Delhi demo city with schematic geometry. Your location is only read when you press a locate button, is matched to the demo map and is never stored.</p>
      <div className="row"><Badge kind="DEMO DATA" /><Badge kind="USER INPUT" /></div>
    </Row>
    <Row n="03" title="DATA SOURCES">
      {j.plan ? <ul className="srcs">{j.plan.evidence.map(e => <li key={e.source}><Badge kind={e.source} /><span>{e.coverage}</span></li>)}</ul>
        : <p className="muted">Sources appear once routes are calculated.</p>}
    </Row>
    <Row n="04" title="PROVIDERS">
      <ul className="provs">{j.boot.providers.map(p => <li key={p.name}><b>{p.name}</b>
        <Badge kind={p.state === "UNAVAILABLE" ? "UNAVAILABLE" : "DEMO DATA"} /><span>{p.state}</span><small>{p.detail}</small></li>)}</ul>
      <p className="muted">Future states: CONNECTED, UNAVAILABLE, ERROR. Secrets are never displayed or sent to the browser.</p>
    </Row>
    <Row n="05" title="ACCESSIBILITY">
      <Switch2 on={prefs.contrast} onChange={v => set({ contrast: v })} title="High contrast" desc="Brighter text and stronger borders on every page after Overview." />
      <p className="muted">Keyboard navigation, visible focus rings and screen-reader labels are always on.</p>
    </Row>
    <Row n="06" title="MOTION">
      <Switch2 on={prefs.motion} onChange={v => set({ motion: v })} title="Reduce motion" desc="Turns off route drawing, transitions and pulses." />
      <p className="muted">Operating-system setting detected: {osReduced ? "reduce motion is ON, so motion is already minimal." : "no reduced-motion preference."}</p>
    </Row>
    <Row n="07" title="UNITS">
      <div className="unitchips"><span>km / m</span><span>°C</span><span>minutes</span><span>thermal units (u)</span></div>
      <p className="muted">Units are fixed in this demo. Thermal units are an illustrative model index, not a temperature.</p>
    </Row>
    <Row n="08" title="SYSTEM STATUS">
      <div className="sysgrid">
        <Metric label="PROVIDERS WITH DATA" value={live} unit={` of ${j.boot.providers.length}`} tone="cool" />
        <Metric label="HEATWAVE THRESHOLD" value={j.boot.heatwave_threshold_c} unit="°C" sub="illustrative" tone="hot" />
        <Metric label="ENGINE" value="Online" sub="demo engine reachable" tone="blue" />
      </div>
      <p className="muted">Adapters exist for Amazon Location Service routes and Bedrock explanations; the SAM template defines API Gateway, Lambda, DynamoDB, S3, Step Functions and CloudWatch. None are called in demo mode.</p>
    </Row>
  </div>;
}
