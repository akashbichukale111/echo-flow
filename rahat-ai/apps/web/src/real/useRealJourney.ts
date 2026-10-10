import { useCallback, useEffect, useRef, useState } from "react";
import { getFix, watchFixes } from "./gps";
import type { Fix } from "./gps";
import { realAnalyze, realExplain, realReassess, realReverse, realStatus } from "./realApi";
import type { Status } from "./realApi";
import { sunAt } from "./sun";
import type { Analysis, Exposure, LatLon, Place, Reassess, RealRoute, Relief, RouteId } from "./types";

/** Demo start used ONLY when GPS is unavailable/denied; always labelled DEMO. */
export const DEMO_START: LatLon = { lat: 28.6315, lon: 77.2167 };
export type Origin = { point: LatLon; kind: "LIVE GPS" | "DEMO START"; label: string; accuracy?: number };
const MIN_REASSESS_MS = 6000;

export function useRealJourney() {
  const [status, setStatus] = useState<Status | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [gpsMsg, setGpsMsg] = useState("");
  const [dest, setDest] = useState<Place | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<RouteId>("rahat");
  const [explain, setExplain] = useState<{ text: string; source: string } | null>(null);
  const [live, setLive] = useState<{ fix: Fix | null; mode: "LIVE GPS" | "DEMO JOURNEY"; exposure: Exposure;
    last: Reassess | null; triggers: string[]; stopMsg: string } | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const lastAt = useRef(0);
  const lastTemp = useRef<number | undefined>(undefined);
  const demoIdx = useRef(0);
  const demoTimer = useRef<number | null>(null);
  const routeRef = useRef<RealRoute | null>(null);
  const reliefRef = useRef<Relief[]>([]);

  useEffect(() => { realStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => () => { stopWatch.current?.(); if (demoTimer.current) window.clearInterval(demoTimer.current); }, []);

  const acquire = useCallback(async () => {
    setGpsMsg("Requesting location…");
    try {
      const fix = await getFix();
      const p = { lat: fix.lat, lon: fix.lon };
      let label = `${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)}`;
      try { label = (await realReverse(p)).label || label; } catch { /* keep coordinates */ }
      setOrigin({ point: p, kind: "LIVE GPS", label, accuracy: fix.accuracy });
      setGpsMsg("");
    } catch (e) {
      setGpsMsg(e instanceof Error ? e.message : "Location unavailable.");
    }
  }, []);

  const useDemoStart = useCallback(() => {
    setOrigin({ point: DEMO_START, kind: "DEMO START", label: "Connaught Place, New Delhi (demo start)" });
    setGpsMsg("");
  }, []);

  const analyze = useCallback(async (o: Origin, d: Place) => {
    setBusy(true); setError(""); setExplain(null);
    try {
      const sun = sunAt(o.point.lat, o.point.lon);
      const a = await realAnalyze(o.point, { lat: d.lat, lon: d.lon }, sun);
      if (!a.ok) { setAnalysis(null); setError(a.error ?? "No route available."); return; }
      setAnalysis(a); lastTemp.current = a.weather.temperatureC;
      realExplain(o.point, { lat: d.lat, lon: d.lon }, sun).then(setExplain).catch(() => setExplain(null));
    } catch (e) {
      setAnalysis(null); setError(e instanceof Error ? e.message : "Routes could not be calculated.");
    } finally { setBusy(false); }
  }, []);

  const chooseDest = useCallback((d: Place) => { setDest(d); if (origin) void analyze(origin, d); }, [origin, analyze]);
  useEffect(() => { if (origin && dest && !analysis && !busy && !error) void analyze(origin, dest); },
    [origin, dest, analysis, busy, error, analyze]);

  const route = analysis?.routes.find(r => r.id === chosen) ?? null;
  routeRef.current = route;
  reliefRef.current = analysis?.relief ?? [];

  const assess = useCallback(async (p: LatLon, force = false, needRahat = false) => {
    const r = routeRef.current;
    const now = Date.now();
    if (!r || (!force && now - lastAt.current < MIN_REASSESS_MS)) return;
    const elapsed = lastAt.current ? Math.min(30, (now - lastAt.current) / 60000) : 0.1;
    lastAt.current = now;
    try {
      const res = await realReassess(r, p, liveStateRef.current, {
        elapsedMin: elapsed, needRahat, relief: reliefRef.current, weatherTempC: lastTemp.current,
        lastWeatherTempC: lastTemp.current });
      liveStateRef.current = res.state;
      setLive(l => l && ({ ...l, last: res, exposure: res.state, triggers: res.triggers }));
    } catch { setLive(l => l && ({ ...l, stopMsg: "Reassessment unavailable; showing last known state." })); }
  }, []);
  const liveStateRef = useRef<Exposure | Record<string, never>>({});

  const startLive = useCallback(() => {
    if (!route || !origin) return;
    stopWatch.current?.(); if (demoTimer.current) window.clearInterval(demoTimer.current);
    liveStateRef.current = {}; lastAt.current = 0;
    const useGps = origin.kind === "LIVE GPS";
    setLive({ fix: null, mode: useGps ? "LIVE GPS" : "DEMO JOURNEY", exposure: { cumulative: 0, history: [] },
      last: null, triggers: [], stopMsg: "" });
    if (useGps) {
      stopWatch.current = watchFixes(
        f => { setLive(l => l && ({ ...l, fix: f })); void assess({ lat: f.lat, lon: f.lon }); },
        m => setLive(l => l && ({ ...l, stopMsg: m })));
    } else {
      demoIdx.current = 0;
      demoTimer.current = window.setInterval(() => {
        const r = routeRef.current; if (!r) return;
        demoIdx.current = Math.min(r.coords.length - 1, demoIdx.current + 1);
        const [lat, lon] = r.coords[demoIdx.current];
        setLive(l => l && ({ ...l, fix: { lat, lon, accuracy: 0, speed: null, heading: null, timestamp: Date.now() } }));
        void assess({ lat, lon }, true);
        if (demoIdx.current >= r.coords.length - 1 && demoTimer.current) window.clearInterval(demoTimer.current);
      }, 2500);
    }
  }, [route, origin, assess]);

  const stopLive = useCallback(() => {
    stopWatch.current?.(); stopWatch.current = null;
    if (demoTimer.current) window.clearInterval(demoTimer.current);
    setLive(null);
  }, []);

  const needRahat = useCallback(async () => {
    const p = live?.fix ?? (origin ? { ...origin.point, accuracy: 0, speed: null, heading: null, timestamp: Date.now() } : null);
    if (p) await assess({ lat: p.lat, lon: p.lon }, true, true);
  }, [live, origin, assess]);

  /** User-confirmed relief detour: re-plan current position -> relief, then relief -> destination. */
  const takeRelief = useCallback(async (item: Relief) => {
    if (!origin || !dest) return;
    const here = live?.fix ? { lat: live.fix.lat, lon: live.fix.lon } : origin.point;
    setBusy(true); setError("");
    try {
      const sun = sunAt(here.lat, here.lon);
      const a = await realAnalyze(here, { lat: item.latitude, lon: item.longitude }, sun);
      const b = await realAnalyze({ lat: item.latitude, lon: item.longitude }, { lat: dest.lat, lon: dest.lon }, sun);
      if (!a.ok || !b.ok) { setError("Relief detour could not be planned."); return; }
      const pickR = (x: Analysis) => x.routes.find(r => r.id === "rahat") ?? x.routes[0];
      const ra = pickR(a), rb = pickR(b);
      const merged: RealRoute = { ...rb, coords: [...ra.coords, ...rb.coords.slice(1)],
        segments: [...ra.segments, ...rb.segments], minutes: ra.minutes + rb.minutes,
        distanceM: ra.distanceM + rb.distanceM, thermalLoad: ra.thermalLoad + rb.thermalLoad,
        id: "rahat", label: "RAHAT (via relief)", providerRouteId: `${ra.providerRouteId}+${rb.providerRouteId}` };
      setAnalysis(prev => prev && ({ ...prev, routes: prev.routes.map(r => (r.id === "rahat" ? merged : r)), relief: b.relief }));
      setChosen("rahat"); liveStateRef.current = { ...(liveStateRef.current as Exposure) };
    } catch (e) { setError(e instanceof Error ? e.message : "Relief detour failed."); } finally { setBusy(false); }
  }, [origin, dest, live]);

  return { status, origin, gpsMsg, dest, analysis, busy, error, chosen, setChosen, route, explain, live,
    acquire, useDemoStart, chooseDest, startLive, stopLive, needRahat, takeRelief,
    retry: () => { if (origin && dest) void analyze(origin, dest); } };
}
