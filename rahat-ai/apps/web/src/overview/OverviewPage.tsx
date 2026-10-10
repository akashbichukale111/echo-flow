import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useJ } from "../journey/ctx";
import type { Place } from "../journey/jtypes";
import { why } from "../journey/pages";
import { Badge, Card, ErrorBox, Loading, f } from "../journey/ui";
import HeroHUD from "./HeroHUD";
import { ArrowIcon, PinIcon, SunIcon } from "./icons";
import JourneySearch from "./JourneySearch";
import type { PickedPlace } from "./JourneySearch";
import {
  CHIPS, RELIEF_LABEL, classWord, distLabel, landmarkNode, meanClass, nearestRelief, routePair, shadeLabel, solarLabel,
} from "./overviewData";
import type { Chip, ReliefKind, SceneMode } from "./overviewData";
import SceneFallback from "./SceneFallback";
import SceneLoader from "./SceneLoader";
import { hasWebGL, useReducedMotion, useStages, useVisible } from "./useOverviewState";
import "./overview.css";

const OverviewScene = lazy(() => import("./scene/OverviewScene"));

class Boundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function OverviewPage() {
  const j = useJ();
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const visible = useVisible(root);
  const [gl] = useState(hasWebGL);
  const [failed, setFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [hoverKind, setHoverKind] = useState<ReliefKind | null>(null);
  const [selKind, setSelKind] = useState<ReliefKind | null>(null);
  const [thermalOn, setThermalOn] = useState(false);
  const [needHover, setNeedHover] = useState(false);
  const [startHover, setStartHover] = useState(false);
  const [chipHover, setChipHover] = useState(false);

  const use3D = gl && !failed;
  const planReady = !!j.plan || !!j.error;
  const ready = (use3D ? sceneReady : true) && planReady;
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 9000);
    return () => clearTimeout(t);
  }, []);
  const go = ready || timedOut;
  const stage = useStages(go, reduced);

  const origin = j.boot.map.nodes[j.req.origin];
  const nearest = useMemo(() => nearestRelief(j.boot.relief, origin), [j.boot.relief, origin]);
  const pair = routePair(j.plan?.routes);
  const exposure = pair ? meanClass(pair.fast.classes) : null;
  const tease = pair ? {
    fastMin: Math.round(pair.fast.minutes), rahatMin: Math.round(pair.rahat.minutes),
    lowerPct: Math.round(-pair.rahat.delta_vs_fastest.load_pct), same: pair.rahat.same_geometry_as === "fastest",
  } : null;
  const destName = picked ?? j.boot.map.nodes[j.req.destination]?.name ?? "";
  const activeKind = hoverKind ?? selKind;
  const mode: SceneMode = starting ? "starting" : (j.need.open || activeKind || needHover) ? "relief"
    : picked ? "destination" : "idle";

  const pick = useCallback((p: PickedPlace) => {
    if (p.node === j.req.origin) { j.setNotice("That is the demo start point. Choose a different destination."); return; }
    j.setReq({ destination: p.node });
    setPicked(p.name);
  }, [j]);
  const outside = useCallback((name: string) => {
    j.setNotice(`${name} is outside the schematic Delhi demo area (DEMO DATA). A real geocoder and router would handle it; the current route is unchanged.`);
  }, [j]);
  const chip = useCallback(async (c: Chip) => {
    const lm = c.landmark ? landmarkNode(j.boot.map.nodes, c.landmark) : null;
    if (lm != null) { pick({ name: c.label, node: lm }); return; }
    try {
      const r = await api<{ items: Place[] }>(`/journey/search?q=${encodeURIComponent(c.query)}`);
      const hit = r.items[0];
      if (hit?.node != null) pick({ name: c.label, node: hit.node });
      else outside(c.label);
    } catch { j.setNotice("Search is unavailable right now."); }
  }, [j, pick, outside]);

  const start = () => {
    if (starting) return;
    if (reduced) { nav("/journey/start"); return; }
    setStarting(true);
    window.setTimeout(() => nav("/journey/start"), 1150);
  };

  const steps = [
    { label: "Environment", done: use3D ? sceneReady : true },
    { label: "Mobility", done: use3D ? sceneReady : true },
    { label: "Relief intelligence", done: planReady },
  ];
  const sel = selKind ? nearest[selKind] : null;
  const tempC = j.plan?.weather.temperature_c ?? null;
  const shade = pair ? pair.fast.shade : null;
  const solar = j.plan ? solarLabel(j.plan.sun.elevation) : null;

  return <>
    <section ref={root} className={`ov ${Array.from({ length: stage }, (_, i) => `s${i + 1}`).join(" ")} ${startHover ? "bright" : ""} ${starting ? "launch" : ""}`}
      aria-label="RAHAT AI overview">
      <div className="ov-scene" aria-hidden={!use3D ? undefined : true}>
        {use3D ? <Boundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <OverviewScene mode={mode} nearest={nearest} tease={tease} reduced={reduced} active={visible}
              highlight={{ kind: activeKind, thermal: thermalOn, all: needHover }}
              destination={picked} chipHover={chipHover}
              entrance={{ world: stage >= 1 ? 1 : 0, rider: stage >= 2 ? 1 : 0 }}
              onReady={() => setSceneReady(true)} onFail={() => setFailed(true)}
              onHoverRelief={setHoverKind} onSelectRelief={k => setSelKind(s => (s === k ? null : k))} />
          </Suspense>
        </Boundary> : <SceneFallback />}
      </div>
      <div className="ov-shade" aria-hidden="true" />

      <header className="ov-top">
        <div className="ov-top-mid t-top">
          <JourneySearch originName={origin?.name ?? "Demo start"} destinationName={destName} onPick={pick} onOutside={outside}
            onFocusChange={() => undefined} />
          <div className="ov-chips" role="group" aria-label="Quick destinations">
            {CHIPS.map(c => <button type="button" key={c.label} className={`ov-chip ${picked === c.label ? "on" : ""}`}
              aria-pressed={picked === c.label} onClick={() => void chip(c)}
              onPointerEnter={() => setChipHover(true)} onPointerLeave={() => setChipHover(false)}
              onFocus={() => setChipHover(true)} onBlur={() => setChipHover(false)}>
              <PinIcon size={13} />{c.label}</button>)}
          </div>
        </div>
        <aside className="ov-thermal t-ctx" aria-label="Thermal context. Demo data, model estimate.">
          <div className="ov-temp"><SunIcon size={20} /><b>{tempC != null ? `${Math.round(tempC)}°C` : "—"}</b>
            <span>{exposure ? `${classWord(exposure)} thermal exposure` : "Thermal context"}</span></div>
          <dl>
            <div><dt>Solar load</dt><dd>{solar ?? "—"}</dd></div>
            <div><dt>Shade coverage</dt><dd>{shade != null ? `${shadeLabel(shade)} · ${f(shade * 100, 0)}%` : "—"}</dd></div>
          </dl>
          <div className="ov-badges"><Badge kind="MODEL ESTIMATE" /><Badge kind="DEMO DATA" /></div>
        </aside>
      </header>

      <div className="ov-hero">
        <p className="ov-eyebrow t-head">HUMAN-CENTRIC THERMAL-SAFE NAVIGATION</p>
        <h1 className="t-head">
          <span>DON'T JUST</span><span>NAVIGATE THE CITY.</span><span>NAVIGATE</span><span className="hot">THROUGH ITS HEAT.</span>
        </h1>
        <p className="ov-sub t-head">Smarter routes. Cooler journeys. A more livable city.</p>
        <div className="ov-cta t-cta">
          <button type="button" className="ov-btn primary" onClick={start} disabled={starting}
            onPointerEnter={() => setStartHover(true)} onPointerLeave={() => setStartHover(false)}
            onFocus={() => setStartHover(true)} onBlur={() => setStartHover(false)}>
            START YOUR JOURNEY <ArrowIcon size={18} />
          </button>
          <button type="button" className="ov-btn ghost gps" onClick={() => nav("/journey/rahat-live")}>
            USE LIVE GPS
          </button>
          <button type="button" className="ov-btn ghost" onClick={() => j.openNeed()}
            onPointerEnter={() => setNeedHover(true)} onPointerLeave={() => setNeedHover(false)}
            onFocus={() => setNeedHover(true)} onBlur={() => setNeedHover(false)}>
            I NEED RAHAT
          </button>
        </div>
        <div className="ov-badges t-cta"><Badge kind="DEMO DATA" /><Badge kind="MODEL ESTIMATE" /><Badge kind="SIMULATED JOURNEY" /></div>
      </div>

      {sel && selKind && <aside className="ov-detail" role="status">
        <div><small>{RELIEF_LABEL[selKind].toUpperCase()}</small>
          <b>{sel.poi.name} · {distLabel(sel.meters)}</b>
          <span>Straight-line distance from the demo start. Estimated relief opportunity. DEMO DATA.</span></div>
        <Link to="/journey/relief">Open relief network <ArrowIcon size={14} /></Link>
        <button type="button" aria-label="Close relief details" onClick={() => setSelKind(null)}>×</button>
      </aside>}

      <div className="t-hud">
        <HeroHUD tempC={tempC} exposure={exposure} nearest={nearest} active={activeKind} thermalOn={thermalOn}
          onThermal={setThermalOn} onHover={setHoverKind} onSelect={k => setSelKind(s => (s === k ? null : k))} />
      </div>
      <div className="ov-fadeout" aria-hidden="true" />
      <SceneLoader steps={steps} hiding={stage >= 1} />
    </section>

    <section className="overview">
      <h2>Why a hotter route can be the wrong route</h2>
      <p className="lead">Navigation apps optimise distance and time. RAHAT adds estimated thermal exposure, shade, water,
        rest, cooling and relief, then shows you the trade-off. It never claims anything about your body.</p>
      {j.plan && pair ? <div className="ov-grid">
        <Card title="Default demo: Connaught Place → India Gate" tag="DEMO DATA">
          <div className="duel">
            <div><span className="eyebrow">FASTEST WAY</span><b>{f(pair.fast.minutes)} min</b><small>{f(pair.fast.load)} u estimated exposure</small></div>
            <span className="vs">vs</span>
            <div className="g"><span className="eyebrow">RAHAT WAY</span><b>{f(pair.rahat.minutes)} min</b><small>{f(pair.rahat.load)} u estimated exposure</small></div>
          </div>
          <p>{why(j.plan.routes, j.req.needs)}</p>
          <Link to="/journey/route" className="linkbtn">Open route planner ›</Link>
        </Card>
        <Card title="How RAHAT decides">
          <ol className="how">
            <li><b>Engines calculate.</b> Solar position, sampled shade, ambient index, traffic delay and routing are deterministic.</li>
            <li><b>Agents explain.</b> Seven roles reason over validated numbers. Nothing invents a distance or a score.</li>
            <li><b>You choose.</b> A route never changes silently. Changes arrive as a proposal.</li>
          </ol>
        </Card>
      </div> : j.error ? <ErrorBox message={j.error} retry={j.retry} /> : <Loading text="Finding routes…" />}
    </section>
  </>;
}
