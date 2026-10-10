import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "../api";
import { JourneyContext, type Ctx, type Live } from "./ctx";
import type {
  Change, JBoot, JPlan, JPOI, JReq, JRoute, JSegment, NeedResult, RouteId,
} from "./jtypes";
import { metricsOf } from "./jtypes";
import { Badge, ErrorBox, Loading, applyPrefs, loadPrefs } from "./UltraUi";
import "./journey.css";
import "./ultra-premium.css";

const Pages = {
  Landing: lazy(() => import("../overview/OverviewPage")),
  Start: lazy(() => import("./UltraPages").then(m => ({ default: m.StartPage }))),
  Choice: lazy(() => import("./UltraPages").then(m => ({ default: m.ChoicePage }))),
  Route: lazy(() => import("./UltraPages").then(m => ({ default: m.RoutePage }))),
  Thermal: lazy(() => import("./UltraPages").then(m => ({ default: m.ThermalPage }))),
  Exposure: lazy(() => import("./UltraPages").then(m => ({ default: m.ExposurePage }))),
  Relief: lazy(() => import("./UltraPages").then(m => ({ default: m.ReliefPage }))),
  Compare: lazy(() => import("./UltraPages").then(m => ({ default: m.ComparePage }))),
  Live: lazy(() => import("./UltraPages").then(m => ({ default: m.LivePage }))),
  Scenario: lazy(() => import("./UltraPages").then(m => ({ default: m.ScenarioPage }))),
  Community: lazy(() => import("./UltraPages").then(m => ({ default: m.CommunityPage }))),
  Evidence: lazy(() => import("./UltraPages").then(m => ({ default: m.EvidencePage }))),
  Settings: lazy(() => import("./UltraPages").then(m => ({ default: m.SettingsPage }))),
  Real: lazy(() => import("../real/RealJourneyPage")),
  RahatLive: lazy(() => import("../live/RealLiveMapPage")),
  NeedDialog: lazy(() => import("./UltraPages").then(m => ({ default: m.NeedDialog }))),
};

const NAV: [string, string][] = [
  ["/", "Overview"], ["/journey/start", "Start journey"], ["/journey/route", "Route planner"],
  ["/journey/thermal", "Thermal map"], ["/journey/exposure", "Exposure"],
  ["/journey/relief", "Relief network"], ["/journey/compare", "Route comparison"],
  ["/journey/live", "Live journey"], ["/journey/scenario", "Scenario lab"],
  ["/journey/community", "Community map"], ["/journey/evidence", "Evidence"],
  ["/journey/rahat-live", "RAHAT LIVE (real map + GPS)"], ["/journey/real", "Real-data journey (classic)"], ["/journey/settings", "Settings"],
];
const SIM_MIN_PER_SEC = 0.2;

function remaining(live: Live) {
  const segs = live.route.segments.slice(live.seg);
  const first = segs[0];
  const left = first ? 1 - live.t : 0;
  return {
    minutes: segs.reduce((s, e, i) => s + e.minutes * (i === 0 ? left : 1), 0),
    distance: segs.reduce((s, e, i) => s + e.distance * (i === 0 ? left : 1), 0),
  };
}
export { remaining };

/** Retired Pune-era URLs -> their unified Delhi journey equivalents. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/journey": "/journey/start", "/planner": "/journey/route", "/thermal-map": "/journey/thermal",
  "/thermal": "/journey/thermal", "/exposure": "/journey/exposure", "/relief": "/journey/relief",
  "/compare": "/journey/compare", "/live-trip": "/journey/live", "/live": "/journey/live",
  "/scenario": "/journey/scenario", "/community": "/journey/community",
  "/evidence": "/journey/evidence", "/settings": "/journey/settings", "/start": "/journey/start",
};

export function JourneyRoutes() {
  return <Routes>
    <Route path="/" element={<Pages.Landing />} />
    <Route path="/journey/start" element={<Pages.Start />} />
    <Route path="/journey/choice" element={<Pages.Choice />} />
    <Route path="/journey/route" element={<Pages.Route />} />
    <Route path="/journey/thermal" element={<Pages.Thermal />} />
    <Route path="/journey/exposure" element={<Pages.Exposure />} />
    <Route path="/journey/relief" element={<Pages.Relief />} />
    <Route path="/journey/compare" element={<Pages.Compare />} />
    <Route path="/journey/live" element={<Pages.Live />} />
    <Route path="/journey/scenario" element={<Pages.Scenario />} />
    <Route path="/journey/community" element={<Pages.Community />} />
    <Route path="/journey/evidence" element={<Pages.Evidence />} />
    <Route path="/journey/real" element={<Pages.Real />} />
    <Route path="/journey/rahat-live" element={<Pages.RahatLive />} />
    <Route path="/journey/settings" element={<Pages.Settings />} />
    {Object.entries(LEGACY_REDIRECTS).map(([from, to]) =>
      <Route key={from} path={from} element={<Navigate to={to} replace />} />)}
    <Route path="*" element={<div className="empty"><h3>That page does not exist</h3>
      <NavLink to="/">Back to overview</NavLink></div>} />
  </Routes>;
}

export default function JourneyRoot() {
  const [boot, setBoot] = useState<JBoot | null>(null);
  const [fatal, setFatal] = useState("");
  const load = useCallback(() => {
    setFatal("");
    api<JBoot>("/journey/bootstrap").then(setBoot).catch(e =>
      setFatal(e instanceof Error ? e.message
        : "RAHAT could not reach its demo engine. Is the backend running on port 8000?"));
  }, []);
  useEffect(load, [load]);
  if (!boot) return <main className="startup">
    <h1>RAHAT<span>AI</span></h1>
    {fatal ? <ErrorBox message={`${fatal} Start the backend with ./run-backend.sh, then retry.`} retry={load} />
      : <Loading text="Waking the deterministic demo engine…" />}
  </main>;
  return <Provider boot={boot} />;
}

function Provider({ boot }: { boot: JBoot }) {
  const [req, setReqState] = useState<JReq>(boot.defaults);
  const [plan, setPlan] = useState<JPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, select] = useState<RouteId>("rahat");
  const [seg, setSeg] = useState<{ route: JRoute; index: number } | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);
  const [need, setNeed] = useState<Ctx["need"]>({
    open: false, loading: false, result: null, error: "", node: boot.defaults.origin,
  });
  const location = useLocation();
  useEffect(() => { applyPrefs(loadPrefs()); }, []);
  const resumeAfterNeed = useRef(false);

  const setReq = useCallback((patch: Partial<JReq>) => setReqState(r => ({ ...r, ...patch })), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<JPlan>("/journey/plan", req, controller.signal).then(p => {
        setPlan(p); setError("");
      }).catch(e => {
        if (e.name !== "AbortError") {
          setError(e instanceof Error ? e.message : "Routes could not be calculated.");
        }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [req, tick]);

  const route = useMemo(
    () => plan?.routes.find(r => r.id === selected) ?? plan?.routes[0] ?? null, [plan, selected]);
  const segment: JSegment | null = seg ? seg.route.segments[seg.index] ?? null : null;

  // Simulated journey ticker. No GPS is read; position is interpolated along engine segments.
  useEffect(() => {
    if (!live?.running) return;
    const id = setInterval(() => setLive(l => {
      if (!l || !l.running) return l;
      const s = l.route.segments[l.seg];
      if (!s) return { ...l, running: false, arrived: true };
      const dMin = 0.1 * SIM_MIN_PER_SEC * l.speed;
      const dt = Math.min(1 - l.t, dMin / Math.max(s.minutes, 0.01));
      const t = l.t + dt;
      const next = { ...l, t, exposure: l.exposure + s.load * dt, elapsed: l.elapsed + dt * s.minutes };
      if (t >= 0.999) {
        const i = l.seg + 1;
        if (i >= l.route.segments.length) return { ...next, seg: l.seg, t: 1, running: false, arrived: true };
        return { ...next, seg: i, t: 0 };
      }
      return next;
    }), 100);
    return () => clearInterval(id);
  }, [live?.running]);

  const startLive = useCallback(() => {
    if (!route) return;
    setLive({ route, seg: 0, t: 0, running: true, speed: 1, exposure: 0, elapsed: 0,
      arrived: false, startedAt: Date.now() });
    setNotice("SIMULATED JOURNEY. No GPS is read; position is simulated along the planned route.");
  }, [route]);

  const liveControl = useCallback((a: "pause" | "resume" | "end" | "speed") => {
    setLive(l => {
      if (!l) return l;
      if (a === "end") return null;
      if (a === "pause") return { ...l, running: false };
      if (a === "resume") return l.arrived ? l : { ...l, running: true };
      return { ...l, speed: l.speed === 1 ? 4 : l.speed === 4 ? 10 : 1 };
    });
  }, []);

  const currentNode = useCallback(() => (
    live ? live.route.segments[Math.min(live.seg, live.route.segments.length - 1)].b : req.origin
  ), [live, req.origin]);

  const openNeed = useCallback((node?: number) => {
    const n = node ?? currentNode();
    resumeAfterNeed.current = !!live?.running;
    setLive(l => (l ? { ...l, running: false } : l));
    setNeed({ open: true, loading: true, result: null, error: "", node: n });
    api<NeedResult>("/journey/need-rahat", {
      journey: req, node: n, radius_m: 1000, destination: req.destination,
    }).then(result => setNeed(s => ({ ...s, loading: false, result })))
      .catch(e => setNeed(s => ({
        ...s, loading: false,
        error: e instanceof Error ? e.message : "Nearby relief could not be found right now.",
      })));
  }, [currentNode, req, live?.running]);

  const closeNeed = useCallback(() => {
    setNeed(s => ({ ...s, open: false }));
    if (resumeAfterNeed.current) setLive(l => (l && !l.arrived ? { ...l, running: true } : l));
  }, []);

  const remainingMetrics = useCallback(() => {
    if (live) {
      const segs = live.route.segments.slice(live.seg + 1);
      const rel = new Set(live.route.relief_ids);
      return {
        minutes: segs.reduce((s, e) => s + e.minutes, 0), distance: segs.reduce((s, e) => s + e.distance, 0),
        load: segs.reduce((s, e) => s + e.load, 0), relief: rel.size,
        shade: segs.reduce((s, e) => s + e.shade * e.distance, 0)
          / Math.max(1, segs.reduce((s, e) => s + e.distance, 0)),
      };
    }
    return route ? metricsOf(route) : { minutes: 0, distance: 0, load: 0, relief: 0, shade: 0 };
  }, [live, route]);

  const propose = useCallback(async (nextReq: JReq, reason: string, apply: () => void) => {
    setBusy(true);
    try {
      const p = await api<JPlan>("/journey/plan", nextReq);
      const after = p.routes.find(r => r.id === "rahat");
      if (!after) throw new Error("No alternative route was produced.");
      const before = remainingMetrics();
      const oldNodes = live ? live.route.nodes.slice(live.seg + 1) : (route?.nodes ?? []);
      setChange({
        reason, before, after: metricsOf(after),
        geometryChanged: JSON.stringify(after.nodes.slice(1)) !== JSON.stringify(oldNodes.slice(1)),
        apply: () => {
          apply();
          if (live) {
            setLive(l => (l ? {
              ...l, route: after, seg: 0, t: 0, running: true, arrived: false,
            } : l));
          }
        },
      });
      setNeed(s => ({ ...s, open: false }));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That alternative could not be calculated.");
    } finally { setBusy(false); }
  }, [live, remainingMetrics, route]);

  const proposeRelief = useCallback(async (poi: JPOI) => {
    const cur = need.node;
    if (cur === req.destination) { setNotice("You are already at the destination."); return; }
    const wp = poi.node !== cur && poi.node !== req.destination ? [{ node: poi.node }] : [];
    const next = { ...req, origin: cur, waypoints: wp };
    await propose(next, `You asked for relief: detour via ${poi.name}. The engine recomputed the rest of the trip.`,
      () => { if (!live) setReq({ waypoints: wp.length ? wp : req.waypoints }); });
  }, [need.node, propose, req, live, setReq]);

  const proposePatch = useCallback(async (patch: Partial<JReq>, reason: string) => {
    const cur = currentNode();
    if (cur === req.destination) { setNotice("You are about to arrive; nothing left to reroute."); return; }
    await propose({ ...req, ...patch, origin: live ? cur : req.origin, waypoints: live ? [] : req.waypoints },
      reason, () => setReq(patch));
  }, [currentNode, live, propose, req, setReq]);

  const ctx: Ctx = {
    boot, req, setReq, plan, loading, error, retry: () => setTick(t => t + 1),
    selected, select, route, seg, setSeg, segment, live, startLive, liveControl,
    need, openNeed, closeNeed, change, setChange, proposeRelief, proposePatch,
    busy, notice, setNotice,
  };
  const landing = location.pathname === "/";
  const liveMap = location.pathname === "/journey/rahat-live";
  const heat = plan?.heatwave.active;
  return <JourneyContext.Provider value={ctx}>
    <div className={`jshell ${landing ? "landing" : "jx"}`}>
      <a className="skip" href="#main">Skip to content</a>
      <nav className="jrail" aria-label="Main">
        <NavLink to="/" className="jbrand" end>RAHAT<span>AI</span>
          <small>THERMAL MOBILITY<br />&amp; RELIEF INTELLIGENCE</small></NavLink>
        <div className="jlinks">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}
            className={({ isActive }) => (isActive ? "on" : "")}>{label}</NavLink>)}
        </div>
        <div className="jrail-foot">
          <Badge kind="DEMO DATA" />
          <small>Delhi demo city. Schematic geometry.</small>
        </div>
      </nav>
      <main id="main" className="jmain">
        {heat && <div className="heatbanner" role="status">
          <b>HEATWAVE MODE</b> Scenario temperature {plan?.heatwave.temperature_c.toFixed(1)} °C is at or above the demo
          threshold. High-load roads, relief and I NEED RAHAT are emphasised. {plan?.heatwave.note}
        </div>}
        {notice && <div className="notice" role="status">{notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
        <Suspense fallback={<Loading text="Loading…" />}>
          {landing || liveMap ? <JourneyRoutes />
            : <div key={location.pathname} className="page-enter"><JourneyRoutes /></div>}
          {need.open && <Pages.NeedDialog />}
        </Suspense>
      </main>
    </div>
  </JourneyContext.Provider>;
}
