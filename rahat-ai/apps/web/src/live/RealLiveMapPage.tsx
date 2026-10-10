import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../api";
import { getFix, moved, watchFixes } from "../real/gps";
import type { Fix, GpsError } from "../real/gps";
import { realAnalyze, realReverse, realSearch } from "../real/realApi";
import { sunAt } from "../real/sun";
import type { Analysis, LatLon, Place, RealRoute, Relief, RouteId, Weather } from "../real/types";
import { kmLabel, minLabel, snap } from "./liveGeo";
import "./live.css";

type Tab = "explore" | "route" | "heat" | "relief";
type Dest = LatLon & { name: string };
const CLS_COLOR: Record<string, string> = { LOW: "#4ade80", MODERATE: "#facc15", ELEVATED: "#fb923c", HIGH: "#ef4444" };
const KIND_COLOR: Record<string, string> = { WATER: "#6fd8ff", SHADE: "#4ade80", REST: "#c4b5fd", COOLING: "#93c5fd", HOSPITAL: "#f87171", TRANSIT: "#fbbf24" };
const KIND_ICON: Record<string, string> = { WATER: "💧", SHADE: "🌳", REST: "🪑", COOLING: "❄", HOSPITAL: "🏥", TRANSIT: "🚉" };
const NEEDS: [string, string][] = [["WATER", "Water"], ["SHADE", "Shade"], ["REST", "Rest"], ["COOLING", "Cooling"], ["HOSPITAL", "Medical"]];
const ROUTE_ICON: Record<RouteId, string> = { fastest: "⚡", balanced: "🌿", rahat: "🟢" };
const MSG = {
  route: "Couldn't calculate a route.", map: "Map couldn't load.", search: "Couldn't find places right now.",
  weather: "Weather data is temporarily unavailable.", satellite: "Satellite data isn't available for this area right now.",
  relief: "Relief data is temporarily unavailable.", gps: "Couldn't access your location.",
  gpsNeed: "Location access is needed for Live GPS navigation.", noPlaces: "No places found.",
  noRelief: "No mapped relief points nearby.", noSat: "Satellite context unavailable for this area.",
};
const UNAVAILABLE = MSG.route;
const SPEC_UNAVAILABLE: Record<string, string> = {
  weather: MSG.weather, vegetation: MSG.satellite, surfaceTemperature: MSG.satellite,
  relief: MSG.relief, buildings: "Shade model data is unavailable for this area.", route: MSG.route,
};
const heatLabel = (c: string) => `${c} HEAT LOAD`;
const ACQ_MS = 1400;

interface ReliefResp { items: Relief[]; available: boolean }
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const lineOf = (c: [number, number][]): GeoJSON.Feature => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c.map(p => [p[1], p[0]]) } });

async function loadStyle(): Promise<maplibregl.StyleSpecification> {
  const base = import.meta.env.VITE_API_BASE ?? "/rahat";
  const r = await fetch(`${base}/api/live/map/style?theme=Dark`);
  if (!r.ok) throw new Error(MSG.map);
  return JSON.parse((await r.text()).split("__RAHAT_MAP__").join(`${window.location.origin}${base}/api/live/map`));
}
const pin = (cls: string, label: string) => {
  const el = document.createElement("div");
  el.className = `lv-pin ${cls}`;
  el.innerHTML = `<i></i><b>${label}</b>`;
  return el;
};

/** Only states a benefit that the calculated deltas actually support. */
function valueLine(routes: RealRoute[]): string {
  const r = routes.find(x => x.id === "rahat");
  if (!r || r.sameAs.includes("fastest") || r.deltaVsFastest.thermalLoadPct >= -0.5) return "";
  const add = r.deltaVsFastest.minutes;
  return add >= 0.5 ? `RAHAT WAY adds ${Math.round(add)} min but reduces estimated thermal exposure.` : "RAHAT WAY reduces estimated thermal exposure at about the same travel time.";
}

export default function RealLiveMapPage() {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMk = useRef<maplibregl.Marker | null>(null);
  const destMk = useRef<maplibregl.Marker | null>(null);
  const pickMk = useRef<maplibregl.Marker | null>(null);
  const clickRef = useRef<(p: LatLon) => void>(() => undefined);
  const centered = useRef(false);
  const reqId = useRef(0);
  const offCount = useRef(0);
  const wxAt = useRef<{ at: number; p: LatLon } | null>(null);
  const reliefAt = useRef<LatLon | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const stopGps = useRef<() => void>(() => undefined);
  const acqTimer = useRef(0);

  const [mapReady, setMapReady] = useState(false);
  const [mapErr, setMapErr] = useState("");
  const [mapKey, setMapKey] = useState(0);
  const [gps, setGps] = useState<"locating" | "acquired" | "live" | "error" | "manual">("locating");
  const [gpsDenied, setGpsDenied] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const [searchTick, setSearchTick] = useState(0);
  const [suggOpen, setSuggOpen] = useState(true);
  const [fix, setFix] = useState<Fix | null>(null);
  const [follow, setFollow] = useState(true);
  const [toast, setToast] = useState("");
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<(Place & { dist: number | null })[]>([]);
  const [suggState, setSuggState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [hi, setHi] = useState(-1);
  const [picked, setPicked] = useState<(LatLon & { label: string }) | null>(null);
  const [dest, setDest] = useState<Dest | null>(null);
  const [an, setAn] = useState<Analysis | null>(null);
  const [anErr, setAnErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<RouteId>("rahat");
  const [tab, setTab] = useState<Tab>("explore");
  const [open, setOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState({ thermal: true, shade: false, greenery: false, relief: true, surface: false });
  const [weather, setWeather] = useState<Weather | null>(null);
  const [wxErr, setWxErr] = useState("");
  const [wxTick, setWxTick] = useState(0);
  const [near, setNear] = useState<ReliefResp | null>(null);
  const [journey, setJourney] = useState(false);
  const [off, setOff] = useState(false);
  const [needOpen, setNeedOpen] = useState(false);
  const [needKind, setNeedKind] = useState<string | null>(null);

  const [sosOpen, setSosOpen] = useState(false);
  const [sosReason, setSosReason] = useState("");
  const [sosContact, setSosContact] = useState(() => localStorage.getItem('rahat_emergency_contact') || "");
  const [sosStatus, setSosStatus] = useState<"idle" | "processing" | "success" | "simulated" | "error" | "partial">("idle");
  const [sosDetails, setSosDetails] = useState<{sms?: string, voice?: string}>({});

  // ---------------------------------------------------------------- map
  useEffect(() => {
    let dead = false;
    loadStyle().then(style => {
      if (dead || !box.current) return;
      const map = new maplibregl.Map({ container: box.current, style, center: [78.9, 21], zoom: 3.4, attributionControl: { compact: true } });
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("alt", { type: "geojson", data: fc([]) });
        map.addSource("sel", { type: "geojson", data: fc([]) });
        map.addSource("seg", { type: "geojson", data: fc([]) });
        map.addSource("relief", { type: "geojson", data: fc([]) });
        map.addLayer({ id: "alt", type: "line", source: "alt", layout: { "line-cap": "round" }, paint: { "line-color": "#8aa0a8", "line-width": 4, "line-opacity": .55, "line-dasharray": [2, 1.5] } });
        map.addLayer({ id: "sel-case", type: "line", source: "sel", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#03140f", "line-width": 11, "line-opacity": .85 } });
        map.addLayer({ id: "sel", type: "line", source: "sel", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#7df0c0", "line-width": 6 } });
        map.addLayer({ id: "seg", type: "line", source: "seg", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 6 } });
        map.addLayer({ id: "relief", type: "circle", source: "relief", paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": "#06100d", "circle-stroke-width": 2.5 } });
        map.on("click", "relief", e => {
          const f = e.features?.[0];
          if (!f) return;
          const el = document.createElement("div");
          const title = document.createElement("b"); title.textContent = `${f.properties?.icon ?? ""} ${f.properties?.name ?? "Relief point"}`;
          const sub = document.createElement("small"); sub.textContent = `${f.properties?.kind ?? ""} · MAPPED · availability unknown`;
          el.append(title, document.createElement("br"), sub);
          new maplibregl.Popup({ offset: 12, className: "lv-pop" }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
        });
        map.on("mouseenter", "relief", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "relief", () => { map.getCanvas().style.cursor = ""; });
        setMapReady(true);
      });
      map.on("click", e => {
        if (map.queryRenderedFeatures(e.point, { layers: ["relief"] }).length) return;
        clickRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      });
      map.on("dragstart", () => setFollow(false));
    }).catch(() => setMapErr(MSG.map));
    return () => {
      dead = true;
      // Markers belong to the map being destroyed; drop the refs so a remount (StrictMode / retry) recreates them.
      userMk.current = null; destMk.current = null; pickMk.current = null; centered.current = false;
      mapRef.current?.remove(); mapRef.current = null; setMapReady(false);
    };
  }, [mapKey]);

  // ---------------------------------------------------------------- GPS (real, never simulated)
  const startGps = useCallback(() => {
    stopGps.current();
    window.clearTimeout(acqTimer.current);
    setGps("locating"); setGpsDenied(false);
    let cancelled = false;
    getFix().then(f => {
      if (cancelled) return;
      setFix(f); setGps("acquired");
      acqTimer.current = window.setTimeout(() => setGps(g => (g === "acquired" ? "live" : g)), ACQ_MS);
    }).catch(e => { if (!cancelled) { setGpsDenied((e as GpsError).code === 1); setGps(g => (g === "live" || g === "acquired" ? g : "error")); } });
    const stopWatch = watchFixes(
      f => { setFix(f); setGps(g => (g === "error" || g === "manual" ? "live" : g)); },
      (_m, code) => { if (code === 1) setGpsDenied(true); setGps(g => (g === "live" || g === "acquired" || g === "manual" ? g : "error")); });
    stopGps.current = () => { cancelled = true; stopWatch(); };
  }, []);
  useEffect(() => { startGps(); return () => { stopGps.current(); window.clearTimeout(acqTimer.current); }; }, [startGps]);
  const startManual = () => { setManualPending(true); setQ(""); setSugg([]); setSuggOpen(true); window.setTimeout(() => searchBox.current?.focus(), 0); };
  const setStart = useCallback((d: Dest) => {
    const f: Fix = { lat: d.lat, lon: d.lon, accuracy: 0, speed: null, heading: null, timestamp: Date.now() };
    setFix(f); setGps("manual"); setManualPending(false); setQ(""); setSugg([]); setPicked(null);
    pickMk.current?.remove(); pickMk.current = null; setToast("START POINT SET"); window.setTimeout(() => setToast(""), 2400);
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!fix || !map || !mapReady) return;
    if (!userMk.current) userMk.current = new maplibregl.Marker({ element: pin("me", "YOU ARE HERE"), anchor: "center" }).setLngLat([fix.lon, fix.lat]).addTo(map);
    else userMk.current.setLngLat([fix.lon, fix.lat]);
    if (!centered.current) {
      centered.current = true;
      map.easeTo({ center: [fix.lon, fix.lat], zoom: 15.5, duration: 1400 });
      setToast("YOU ARE HERE"); window.setTimeout(() => setToast(""), 2600);
    } else if (follow && !dest) map.easeTo({ center: [fix.lon, fix.lat], duration: 600 });
    else if (follow && journey) map.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(map.getZoom(), 16), duration: 600 });
  }, [fix, mapReady, follow, dest, journey]);

  // ---------------------------------------------------------------- weather + nearby relief (cached, not per tick)
  useEffect(() => {
    if (!fix) return;
    const last = wxAt.current;
    if (!last || Date.now() - last.at > 600000 || moved(last.p, fix) > 3000) {
      wxAt.current = { at: Date.now(), p: { lat: fix.lat, lon: fix.lon } };
      api<{ weather: Weather }>(`/real/weather?lat=${fix.lat}&lon=${fix.lon}`)
        .then(r => { if (r.weather.sourceType === "DEMO_DATA") { setWeather(null); setWxErr(MSG.weather); } else { setWeather(r.weather); setWxErr(""); } })
        .catch(() => { setWeather(null); setWxErr(MSG.weather); });
    }
    if (!reliefAt.current || moved(reliefAt.current, fix) > 400) {
      reliefAt.current = { lat: fix.lat, lon: fix.lon };
      api<ReliefResp>(`/live/relief?lat=${fix.lat}&lon=${fix.lon}&radius_m=1200`).then(setNear).catch(() => setNear({ items: [], available: false }));
    }
  }, [fix, wxTick]);

  // ---------------------------------------------------------------- search (debounced, cancellable)
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setSugg([]); setSuggState("idle"); return; }
    const ctl = new AbortController();
    setSuggState("loading");
    const t = window.setTimeout(() => {
      realSearch(text, fix ? { lat: fix.lat, lon: fix.lon } : undefined, ctl.signal).then(r => {
        const real = r.items.filter(p => p.sourceType !== "DEMO_DATA");
        if (!real.length && r.items.length) { setSugg([]); setSuggState("error"); return; }
        setSugg(real.map(p => ({ ...p, dist: fix ? moved(fix, p) : null })));
        setSuggState(real.length ? "idle" : "empty"); setHi(-1);
      }).catch(e => { if ((e as Error).name !== "AbortError") { setSugg([]); setSuggState("error"); } });
    }, 260);
    return () => { window.clearTimeout(t); ctl.abort(); };
  }, [q, fix, searchTick]);

  // ---------------------------------------------------------------- analysis
  const analyse = useCallback(async (d: Dest, from: Fix) => {
    const id = ++reqId.current;
    setBusy(true); setAnErr(""); setOff(false); offCount.current = 0;
    try {
      const a = await realAnalyze(from, d, sunAt(from.lat, from.lon), "rider");
      if (id !== reqId.current) return;
      if (!a.ok || !a.routes?.length || a.routes.some(r => r.sourceType === "DEMO_DATA")) { setAn(null); setAnErr(UNAVAILABLE); }
      else { setAn(a); setSel("rahat"); setTab("route"); setOpen(true); }
    } catch { if (id === reqId.current) { setAn(null); setAnErr(UNAVAILABLE); } }
    finally { if (id === reqId.current) setBusy(false); }
  }, []);

  const choose = useCallback((d: Dest) => {
    if (manualPending) { setStart(d); return; }
    setDest(d); setQ(d.name); setSugg([]); setSuggOpen(false); setPicked(null); setJourney(false); setAn(null);
    pickMk.current?.remove(); pickMk.current = null;
    if (!fix) { setAnErr(MSG.gpsNeed); return; }
    void analyse(d, fix);
  }, [fix, analyse, manualPending, setStart]);

  const submitSearch = useCallback(async () => {
    const pick = hi >= 0 ? sugg[hi] : sugg[0];
    if (pick) { choose({ lat: pick.lat, lon: pick.lon, name: pick.name }); return; }
    if (q.trim().length < 2) return;
    setSuggState("loading");
    try {
      const r = await realSearch(q.trim(), fix ? { lat: fix.lat, lon: fix.lon } : undefined);
      const p = r.items.find(i => i.sourceType !== "DEMO_DATA");
      if (p) choose({ lat: p.lat, lon: p.lon, name: p.name }); else { setSuggOpen(true); setSuggState(r.items.length ? "error" : "empty"); }
    } catch { setSuggOpen(true); setSuggState("error"); }
  }, [hi, sugg, q, fix, choose]);

  // ---------------------------------------------------------------- map-click destination
  clickRef.current = (p: LatLon) => {
    const map = mapRef.current;
    if (!map) return;
    setPicked({ ...p, label: "FINDING ADDRESS…" });
    pickMk.current?.remove();
    pickMk.current = new maplibregl.Marker({ element: pin("pick", "SELECTED"), anchor: "bottom" }).setLngLat([p.lon, p.lat]).addTo(map);
    realReverse(p).then(r => setPicked(c => (c && c.lat === p.lat ? { ...c, label: r.source === "Coordinates" ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : r.label } : c)))
      .catch(() => setPicked(c => (c && c.lat === p.lat ? { ...c, label: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` } : c)));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Enter" && picked && !/INPUT|BUTTON|TEXTAREA/.test(t.tagName)) { choose({ lat: picked.lat, lon: picked.lon, name: picked.label }); }
      if (e.key === "Escape") { setPicked(null); pickMk.current?.remove(); pickMk.current = null; setNeedOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, choose]);

  // ---------------------------------------------------------------- draw route + layers + markers
  const route = an?.routes.find(r => r.id === sel) ?? an?.routes[0] ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource;
    const alts = an ? an.routes.filter(r => r.id !== route?.id && !(route && r.sameAs.includes(route.id))) : [];
    src("alt").setData(fc(alts.map(r => lineOf(r.coords))));
    src("sel").setData(fc(route ? [lineOf(route.coords)] : []));
    const colorOf = (s: { class: string; shade: number }) => layers.shade ? (s.shade >= .5 ? "#2dd4bf" : s.shade >= .2 ? "#7dd3fc" : "#64748b") : CLS_COLOR[s.class];
    const showSeg = !!route && (layers.thermal || layers.shade);
    src("seg").setData(fc(showSeg ? route.segments.map(s => ({ type: "Feature" as const, properties: { color: colorOf(s) },
      geometry: { type: "LineString" as const, coordinates: [[s.start[1], s.start[0]], [s.end[1], s.end[0]]] } })) : []));
    const pts = layers.relief && (an || needOpen || tab === "relief") ? [...(an?.relief ?? []), ...(near?.items ?? [])].filter(r => r.sourceType !== "DEMO_DATA") : [];
    const seen = new Set<string>();
    src("relief").setData(fc(pts.filter(r => !seen.has(r.id) && seen.add(r.id)).slice(0, 80).map(r => ({ type: "Feature" as const,
      properties: { color: KIND_COLOR[r.type] ?? "#fff", name: r.name, kind: r.type, icon: KIND_ICON[r.type] ?? "" },
      geometry: { type: "Point" as const, coordinates: [r.longitude, r.latitude] } }))));
  }, [an, route, layers, near, mapReady, needOpen, tab]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    destMk.current?.remove(); destMk.current = null;
    if (dest) destMk.current = new maplibregl.Marker({ element: pin("dest", "🏁 DESTINATION"), anchor: "bottom" }).setLngLat([dest.lon, dest.lat]).addTo(map);
  }, [dest, mapReady]);

  useEffect(() => { // fit camera to origin + destination + route once a real route exists
    const map = mapRef.current;
    if (!map || !an || !route || journey) return;
    const b = new maplibregl.LngLatBounds();
    route.coords.forEach(c => b.extend([c[1], c[0]]));
    if (fix) b.extend([fix.lon, fix.lat]);
    const narrow = window.innerWidth < 760;
    map.fitBounds(b, { padding: { top: 130, bottom: narrow ? 340 : 120, left: narrow ? 40 : 460, right: 80 }, duration: 1100, maxZoom: 17 });
    setFollow(false);
  }, [an]);

  // ---------------------------------------------------------------- live navigation
  const prog = useMemo(() => (journey && fix && route ? snap(route.coords, fix) : null), [journey, fix, route]);
  useEffect(() => {
    if (!prog || !fix || !dest) return;
    if (prog.distM > Math.max(70, fix.accuracy * 2)) { offCount.current += 1; if (offCount.current >= 2) setOff(true); } else { offCount.current = 0; setOff(false); }
  }, [prog, fix, dest]);
  const ahead = useMemo(() => {
    if (!journey || !route || !fix) return null;
    let bi = 0, bd = Infinity;
    route.segments.forEach((s, i) => { const d = moved(fix, { lat: s.start[0], lon: s.start[1] }); if (d < bd) { bd = d; bi = i; } });
    let acc = 0;
    for (let i = bi; i < route.segments.length && acc < 600; i++) { if (route.segments[i].class === "HIGH") return { inM: acc }; acc += route.segments[i].lengthM; }
    return null;
  }, [journey, route, fix]);
  const cooler = an?.routes.find(r => r.id === "rahat" && route && r.id !== route.id && r.thermalLoad < route.thermalLoad);
  const remainM = prog ? prog.remainM : route?.distanceM ?? 0;
  const remainMin = route && prog ? route.minutes * (prog.remainM / Math.max(1, prog.totalM)) : route?.minutes ?? 0;
  const arrived = !!prog && prog.remainM < 30;

  const startJourney = () => { if (!route) return; setJourney(true); setFollow(true); setTab("route"); mapRef.current?.easeTo({ zoom: 16.5, duration: 900 }); };
  const locate = () => { setFollow(true); if (fix) mapRef.current?.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(mapRef.current.getZoom(), 15.5), duration: 700 }); };
  const kindList = (k: string) => [...(near?.items ?? []), ...(an?.relief ?? [])].filter(r => r.type === k && r.sourceType !== "DEMO_DATA")
    .map(r => ({ ...r, d: fix ? moved(fix, { lat: r.latitude, lon: r.longitude }) : 0 })).sort((a, b) => a.d - b.d);
  const goRelief = (r: Relief) => { setNeedOpen(false); choose({ lat: r.latitude, lon: r.longitude, name: r.name }); };
  const evBad = (k: string) => !!an?.evidence[k] && an.evidence[k].sourceType === "DEMO_DATA";

  // ---------------------------------------------------------------- UI
  const listOpen = suggOpen && q.trim().length >= 2 && (sugg.length > 0 || suggState !== "idle");
  const wx = weather;
  const sun = fix ? sunAt(fix.lat, fix.lon) : null;
  const sat = an?.satelliteContext;
  const hhmm = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
  const title = journey ? "RAHAT LIVE" : an ? "CHOOSE YOUR ROUTE" : dest ? "YOUR DESTINATION" : "WHERE DO YOU WANT TO GO?";

  return <div className="lv" role="application" aria-label="RAHAT LIVE real-world map">
    <div ref={box} className="lv-map" />
    {mapErr && <div className="lv-fatal" role="alert"><b>{mapErr}</b><p>Check your connection and try again. The demo journey is still available from the overview.</p>
      <button className="lv-btn primary" onClick={() => { setMapErr(""); setMapKey(k => k + 1); }}>Try again</button><Link to="/" className="lv-btn">Back to overview</Link></div>}

    <header className="lv-top">
      <Link to="/" className="lv-back" aria-label="Back to overview">←</Link>
      <div className="lv-search">
        <input ref={searchBox} value={q} type="text" role="combobox" aria-label="Search destination" aria-autocomplete="list" autoComplete="off"
          aria-expanded={listOpen} aria-controls="lv-sugg" aria-activedescendant={hi >= 0 ? `lv-opt-${hi}` : undefined}
          placeholder={manualPending ? "Enter your starting location" : "Where do you want to go?"}
          onChange={e => { setQ(e.target.value); setHi(-1); setSuggOpen(true); }}
          onFocus={() => setSuggOpen(true)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSuggOpen(true); setHi(h => Math.min(sugg.length - 1, h + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(-1, h - 1)); }
            else if (e.key === "Escape") { e.preventDefault(); setSuggOpen(false); setHi(-1); }
            else if (e.key === "Enter") { e.preventDefault(); void submitSearch(); }
          }} />
        {q && <button className="lv-x" aria-label="Clear search" title="Clear" onClick={() => { setQ(""); setSugg([]); setSuggState("idle"); searchBox.current?.focus(); }}>×</button>}
        <button className="lv-go" onClick={() => void submitSearch()} aria-label="Search" title="Search">SEARCH ↵</button>
        {listOpen && <ul id="lv-sugg" className="lv-sugg" role="listbox" aria-label="Place suggestions">
          {suggState === "loading" && !sugg.length && <li className="note">SEARCHING PLACES…</li>}
          {suggState === "empty" && <li className="note">{MSG.noPlaces}</li>}
          {suggState === "error" && <li className="note warn">{MSG.search} <button className="lv-link" onClick={() => setSearchTick(t => t + 1)}>Retry</button></li>}
          {sugg.map((p, i) => <li key={`${p.id ?? p.name}-${i}`} id={`lv-opt-${i}`} role="option" aria-selected={i === hi} className={i === hi ? "on" : ""}>
            <button tabIndex={-1} onMouseEnter={() => setHi(i)} onClick={() => choose({ lat: p.lat, lon: p.lon, name: p.name })}>
              <span className="pi" aria-hidden="true">📍</span><span><b>{p.name}</b>{p.label !== p.name && <small>{p.label}</small>}</span>
              {p.dist != null && <em>{kmLabel(p.dist)}</em>}</button></li>)}
        </ul>}
      </div>
    </header>

    <div className={`lv-status ${gps}`} role="status" aria-live="polite">
      {gps === "locating" && <>◌ LOCATING YOU… <small>ALLOW LOCATION ACCESS</small></>}
      {gps === "acquired" && <>✓ YOU ARE HERE</>}
      {gps === "live" && fix && <><i /> LIVE · GPS ±{Math.round(fix.accuracy)} m</>}
      {gps === "manual" && <>📍 MANUAL START · NOT LIVE GPS</>}
      {gps === "error" && <>⚠ NO LIVE GPS</>}
    </div>
    {gps === "error" && !manualPending && <div className="lv-alert bad lv-gpsmsg" role="alert"><b>{MSG.gps}</b>
      <span>{MSG.gpsNeed}{gpsDenied ? " Allow location for this site in your browser settings, then try again." : ""}</span>
      <div><button className="lv-btn primary" onClick={startGps}>TRY AGAIN</button><button className="lv-btn" onClick={startManual}>ENTER LOCATION MANUALLY</button></div></div>}
    {manualPending && <div className="lv-alert lv-gpsmsg" role="status"><b>CHOOSE YOUR START POINT</b>
      <span>Search for a place or tap the map, then press USE THIS LOCATION. This is not live GPS.</span>
      <div><button className="lv-btn" onClick={() => { setManualPending(false); setPicked(null); pickMk.current?.remove(); pickMk.current = null; }}>Cancel</button></div></div>}
    {toast && <div className="lv-toast">🔵 {toast}</div>}

    <div className="lv-ctl">
      <button aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>＋</button>
      <button aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>－</button>
      <button aria-label="Reset north" title="Reset north (rotate with right-drag or two fingers)" onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0 })}>🧭</button>
      <button aria-label="Locate me" title="Locate me" className={follow ? "on" : ""} onClick={locate}>◎</button>
      <button aria-label="Map layers" title="Map layers" aria-expanded={layersOpen} className={layersOpen ? "on" : ""} onClick={() => setLayersOpen(o => !o)}>▤</button>
      {layersOpen && <div className="lv-layers" role="group" aria-label="Map layers"><b>DATA LAYERS</b>
        {([["thermal", "Thermal"], ["shade", "Estimated Shade"], ["greenery", "Greenery"], ["relief", "Relief"], ["surface", "Surface Temperature"]] as const).map(([k, l]) =>
          <label key={k}><input type="checkbox" checked={layers[k]} onChange={e => setLayers(s => ({ ...s, [k]: e.target.checked }))} />{l}</label>)}
        <small>Shade is a MODEL ESTIMATE. Greenery and surface temperature are satellite context, not street-level shade.</small></div>}
    </div>

    {(layers.greenery || layers.surface) && an && <div className="lv-chips">
      {layers.greenery && <span>{sat?.sentinel2 ? `🌿 VEGETATION CONTEXT · NDVI ${sat.sentinel2.meanNdvi?.toFixed(2) ?? "—"} · Sentinel-2 · ${sat.sentinel2.acquisitionDate}` : MSG.noSat}</span>}
      {layers.surface && <span>{sat?.landsat?.surfaceTemperatureC != null ? `🛰 OBSERVED SURFACE TEMPERATURE ${sat.landsat.surfaceTemperatureC.toFixed(0)}°C · Landsat · ${sat.landsat.acquisitionDate}` : MSG.noSat}</span>}
    </div>}

    {picked && <div className="lv-pick" role="dialog" aria-label="Select destination">
      <small>{manualPending ? "SELECT START POINT" : "SELECT DESTINATION"}</small><b>{picked.label}</b><span>{picked.lat.toFixed(5)}, {picked.lon.toFixed(5)}</span>
      <div><button className="lv-btn primary" onClick={() => choose({ lat: picked.lat, lon: picked.lon, name: picked.label })}>Use this location ↵</button>
        <button className="lv-btn" onClick={() => { setPicked(null); pickMk.current?.remove(); pickMk.current = null; }}>Cancel</button></div></div>}

    {off && <div className="lv-alert bad" role="alert"><b>You're off the planned route.</b><span>Recalculate from your current GPS position.</span>
      <button className="lv-btn primary" disabled={busy || !fix || !dest} onClick={() => fix && dest && void analyse(dest, fix)}>RECALCULATE</button></div>}
    {!off && ahead && <div className="lv-alert heat" role="status"><b>HEAT EXPOSURE AHEAD</b>
      <span>High estimated solar exposure in {kmLabel(ahead.inM)}.{cooler ? " A cooler alternative is available." : ""}</span>
      {cooler && <button className="lv-btn" onClick={() => setSel("rahat")}>SHOW COOLER ROUTE</button>}</div>}

    {(!needOpen && !sosOpen) && <button className="lv-sos lv-sos-emergency" aria-label="Emergency SOS" onClick={() => {
      if (!fix) {
        setToast("Waiting for GPS signal...");
        return;
      }
      setSosOpen(true);
      setSosStatus("idle");
      setSosDetails({});
    }}>🆘 EXTREME EMERGENCY SOS</button>}

    {sosOpen && <div className="lv-need" role="dialog" aria-label="Emergency SOS" style={{ bottom: "calc(76px + env(safe-area-inset-bottom) + 64px)", zIndex: 10 }}>
      <div className="lv-need-h"><b style={{color: "#ff6a4d"}}>🚨 EXTREME EMERGENCY</b><button aria-label="Close" title="Close" onClick={() => setSosOpen(false)}>×</button></div>
      {sosStatus === "idle" && <>
        <span>Are you in an emergency? Choose how to alert your emergency contact.</span>
           <div style={{ display: "grid", gap: "8px" }}>
             <small>Emergency Contact is securely routed via AWS.</small>
             <input type="text" placeholder="Reason (Optional)" value={sosReason} onChange={e => setSosReason(e.target.value)} style={{ padding: "12px", borderRadius: "8px", border: "1px solid #444", background: "#111", color: "#fff", marginBottom: "8px" }} />
             {[
               { id: "sms", label: "SEND EMERGENCY SMS" },
               { id: "voice", label: "CALL EMERGENCY CONTACT" },
               { id: "both", label: "SEND SMS + CALL" }
             ].map(opt => (
               <button key={opt.id} className="lv-btn danger" style={opt.id === "both" ? { background: "#d32f2f", color: "white", borderColor: "#b71c1c" } : {}} onClick={async () => {
                 if (!window.confirm(`TRIGGER ${opt.label}?\n\nThis will immediately notify the emergency contact with your live GPS location. Use only in critical situations.`)) return;
                 setSosStatus("processing");
                 try {
                   const res = await api<{ incident_id: string; notification_status: any; details: any }>("/emergency/sos", {
                     idempotency_key: crypto.randomUUID(),
                     latitude: fix!.lat,
                     longitude: fix!.lon,
                     reason: sosReason || undefined,
                     action: opt.id,
                     contact_number: undefined
                   });
                   setSosStatus(res.notification_status);
                   setSosDetails(res.details || {});
                 } catch (err) {
                   setSosStatus("error");
                 }
               }}>{opt.label}</button>
             ))}
           </div>
      </>}
      {sosStatus === "processing" && <span style={{ padding: "20px 0", textAlign: "center", fontWeight: "bold" }}>DISPATCHING SOS...</span>}
      {(sosStatus === "success" || sosStatus === "simulated" || sosStatus === "error" || sosStatus === "partial") && (
        <div style={{ display: "grid", gap: "8px" }}>
          <b>STATUS: {sosStatus.toUpperCase()}</b>
          {sosStatus === "simulated" && <span className="warn" style={{ padding: "8px", background: "rgba(255, 171, 92, 0.1)", borderRadius: "8px", border: "1px solid #ffab5c" }}>DEMO ONLY — NO REAL MESSAGE OR CALL SENT</span>}
          <div style={{ display: "flex", gap: "12px", fontSize: "14px" }}>
            {sosDetails.sms && <span><b style={{color: "#aaa"}}>SMS:</b> {sosDetails.sms.toUpperCase()}</span>}
            {sosDetails.voice && <span><b style={{color: "#aaa"}}>VOICE:</b> {sosDetails.voice.toUpperCase()}</span>}
          </div>
          <button className="lv-btn" onClick={() => { setSosStatus("idle"); setSosDetails({}); }}>RETRY / BACK</button>
        </div>
      )}
    </div>}
    <button className="lv-sos" aria-label="I need RAHAT: find water, shade, rest, cooling or medical help" onClick={() => setNeedOpen(true)}>🆘 I NEED RAHAT</button>
    {needOpen && <div className="lv-need" role="dialog" aria-label="I need RAHAT">
      <div className="lv-need-h"><b>WHAT DO YOU NEED?</b><button aria-label="Close" title="Close" onClick={() => { setNeedOpen(false); setNeedKind(null); }}>×</button></div>
      <div className="lv-kinds">{NEEDS.map(([k, l]) => <button key={k} className={needKind === k ? "on" : ""} onClick={() => setNeedKind(k)}>{KIND_ICON[k]} {l}</button>)}</div>
      {needKind && (() => { const l = kindList(needKind).slice(0, 3);
        if (!fix) return <p className="warn">{MSG.gpsNeed}</p>;
        if (near && !near.available && !l.length) return <p className="warn">{MSG.relief} <button className="lv-link" onClick={() => { reliefAt.current = null; setWxTick(t => t + 1); }}>Retry</button></p>;
        if (!l.length) return <p className="muted">{MSG.noRelief}</p>;
        return <ul>{l.map(r => <li key={r.id}><span><b>{r.name}</b><small>{kmLabel(r.d)} · MAPPED · Availability unknown</small></span>
          <button className="lv-btn primary" onClick={() => goRelief(r)}>NAVIGATE THERE</button></li>)}</ul>; })()}
    </div>}

    <section className={`lv-sheet ${open ? "" : "min"}`} aria-label="Journey panel">
      <button className="lv-grip" aria-label={open ? "Collapse panel" : "Expand panel"} onClick={() => setOpen(o => !o)}><i /></button>
      <div className="lv-sheet-h"><h2>{title}</h2>{busy && <span className="lv-spin" role="status">CALCULATING ROUTE… ANALYZING THERMAL CONDITIONS…</span>}</div>
      {open && <div className="lv-body">
        {anErr && <div className="lv-err" role="alert"><b>{anErr}</b>{anErr === UNAVAILABLE && dest && fix && <button className="lv-btn" disabled={busy} onClick={() => void analyse(dest, fix)}>Retry</button>}</div>}

        {tab === "explore" && <>
          {!dest && <p className="muted"><b className="lv-lead">Use your live location to find a cooler route.</b><br />Search a place above, or tap anywhere on the map to choose a destination.</p>}
          {dest && <div className="lv-dest">🏁 <b>{dest.name}</b></div>}
          {wx && <div className="lv-wx"><b>{Math.round(wx.temperatureC)}°C</b><span>Feels like {Math.round(wx.feelsLikeC)}°C · {wx.condition}</span><small>WEATHER · WeatherAPI · {wx.freshness}</small>
            <button className="lv-link" onClick={() => setTab("heat")}>Weather details</button></div>}
          {wxErr && <div className="lv-err" role="alert"><b>{wxErr}</b><button className="lv-btn" onClick={() => { wxAt.current = null; setWxTick(t => t + 1); }}>Retry</button></div>}
        </>}

        {tab === "route" && <>
          {an && !journey && <ul className="lv-routes">{an.routes.map(r => <li key={r.id}><button aria-pressed={sel === r.id} className={`${sel === r.id ? "on" : ""} ${r.id}`} onClick={() => setSel(r.id)}>
            <span className="rn">{ROUTE_ICON[r.id]} {r.label}</span>
            <span className="rm"><b>{kmLabel(r.distanceM)}</b> · <b>{minLabel(r.minutes)}</b></span>
            <span className="rs">{heatLabel(r.heatContext)}{r.id === "rahat" && <> · {Math.round(r.estimatedShade * 100)}% estimated shade <i className="lv-badge">MODEL ESTIMATE</i></>}</span>
            {r.id === "rahat" && r.reliefCount > 0 && <span className="rs">{r.reliefCount} relief point{r.reliefCount === 1 ? "" : "s"} nearby</span>}
            {r.id !== "fastest" && r.deltaVsFastest.thermalLoadPct < -0.5 && <span className="rd">~{Math.abs(r.deltaVsFastest.thermalLoadPct).toFixed(0)}% lower estimated thermal load{r.deltaVsFastest.minutes >= 0.5 ? ` · adds ${Math.round(r.deltaVsFastest.minutes)} min` : ""}</span>}
            {r.sameAs.length > 0 && <span className="rs">Same road as {r.sameAs.map(id => an.routes.find(x => x.id === id)?.label ?? id).join(", ")}</span>}
          </button></li>)}</ul>}
          {an && !journey && valueLine(an.routes) && <p className="lv-value">{valueLine(an.routes)}</p>}
          {an && !journey && route && <><div className="lv-tags"><span>MODEL ESTIMATE</span><span>LIVE ROUTE</span></div>
            <button className="lv-btn primary wide" onClick={startJourney}>START JOURNEY</button></>}
          {journey && route && <div className="lv-nav">
            {arrived ? <b className="ok">YOU HAVE ARRIVED</b> : <><div className="lv-big"><b>{kmLabel(remainM)} left</b><span>{minLabel(remainMin)} · ETA {new Date(Date.now() + remainMin * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
              <small>🏁 {dest?.name} · {route.label} · {Math.round(route.estimatedShade * 100)}% estimated shade · {heatLabel(route.heatContext)}</small>
              {(() => { const n = kindList("WATER")[0] ?? kindList("SHADE")[0]; return n ? <small>Next relief: {KIND_ICON[n.type]} {n.name} · {kmLabel(n.d)}</small> : null; })()}</>}
            <button className="lv-btn danger" onClick={() => { setJourney(false); setFollow(false); }}>END JOURNEY</button></div>}
          {!an && !anErr && <p className="muted">Choose a destination to see FASTEST, BALANCED and RAHAT WAY routes.</p>}
        </>}

        {tab === "heat" && <div className="lv-heat">
          <h3>WEATHER DETAILS</h3>
          {wx ? <dl><div><dt>Air temperature</dt><dd>{Math.round(wx.temperatureC)}°C (feels {Math.round(wx.feelsLikeC)}°)</dd></div><div><dt>Humidity · wind</dt><dd>{wx.humidityPct}% · {Math.round(wx.windKph)} km/h</dd></div>
            <div><dt>UV · cloud</dt><dd>{wx.uvIndex} · {wx.cloudPct}%</dd></div><div><dt>Visibility · rain</dt><dd>{wx.visibilityKm} km · {wx.precipitationMm} mm</dd></div></dl> : <div className="lv-err"><b>{wxErr || "LOADING WEATHER…"}</b></div>}
          {sun && <dl><div><dt>Sun altitude · azimuth</dt><dd>{sun.altitudeDeg.toFixed(0)}° · {sun.azimuthDeg.toFixed(0)}°</dd></div><div><dt>Sunrise · sunset</dt><dd>{hhmm(sun.sunrise)} · {hhmm(sun.sunset)}</dd></div></dl>}
          {route ? <><h3>Estimated Thermal Exposure</h3><dl><div><dt>Route</dt><dd>{route.label}</dd></div><div><dt>Heat load</dt><dd>{heatLabel(route.heatContext)}</dd></div>
            <div><dt>Estimated shade</dt><dd>{Math.round(route.estimatedShade * 100)}% · {route.shadeConfidence} confidence · {route.buildingCount} buildings</dd></div>
            <div><dt>Model confidence</dt><dd>{an?.modelConfidence?.level ?? "—"}</dd></div></dl>
            <div className="lv-segbar" aria-label="Thermal segments">{route.segments.map((s, i) => <i key={i} style={{ flex: s.lengthM, background: CLS_COLOR[s.class] }} title={`${s.class} · ${Math.round(s.shade * 100)}% shade`} />)}</div>
            <div className="lv-legend"><span style={{ color: CLS_COLOR.LOW }}>● Low</span><span style={{ color: CLS_COLOR.MODERATE }}>● Moderate</span><span style={{ color: CLS_COLOR.ELEVATED }}>● Elevated</span><span style={{ color: CLS_COLOR.HIGH }}>● High</span></div></>
            : <p className="muted">Pick a destination to see route thermal exposure.</p>}
          {an && <><h3>SATELLITE DATA</h3><dl>
            <div><dt>Vegetation (Sentinel-2 NDVI)</dt><dd>{sat?.sentinel2 ? `${sat.sentinel2.meanNdvi?.toFixed(2) ?? "—"} · ${sat.sentinel2.acquisitionDate} · ${sat.sentinel2.ageDays} d old` : MSG.noSat}</dd></div>
            <div><dt>Observed surface temp (Landsat)</dt><dd>{sat?.landsat?.surfaceTemperatureC != null ? `${sat.landsat.surfaceTemperatureC.toFixed(0)}°C · ${sat.landsat.acquisitionDate} · ${sat.landsat.freshness}` : MSG.noSat}</dd></div></dl>
            <h3>EVIDENCE</h3><ul className="lv-ev">{Object.entries(an.evidence).map(([k, e]) => <li key={k}><b>{k}</b>
              <span>{e.sourceType === "DEMO_DATA" ? (SPEC_UNAVAILABLE[k] ?? "Data unavailable for this area.") : `${e.source} · ${e.badge} · ${e.freshness}`}</span></li>)}</ul></>}
          <small className="muted">{an?.disclaimer ?? "Estimated environmental thermal exposure. Not medical advice."}</small>
        </div>}

        {tab === "relief" && <div className="lv-rel">
          {near && !near.available && <div className="lv-err" role="alert"><b>{MSG.relief}</b><button className="lv-btn" onClick={() => { reliefAt.current = null; setWxTick(t => t + 1); }}>Retry</button></div>}
          {["WATER", "SHADE", "REST", "COOLING", "HOSPITAL", "TRANSIT"].map(k => { const n = kindList(k)[0];
            return <div key={k} className="lv-relrow"><span>{KIND_ICON[k]}</span><span><b>{k === "HOSPITAL" ? "Medical" : k[0] + k.slice(1).toLowerCase()}</b>
              <small>{n ? `${n.name} · ${kmLabel(n.d)} · MAPPED · ${n.availability && n.availability !== "UNKNOWN" ? `availability ${n.availability}` : "Availability unknown"}` : MSG.noRelief}</small></span>
              {n && <button className="lv-btn" onClick={() => goRelief(n)}>Go</button>}</div>; })}
          {evBad("relief") && <div className="lv-err"><b>{MSG.relief}</b></div>}
          <small className="muted">Source: OpenStreetMap via Overpass. Opening status is not verified.</small>
        </div>}
      </div>}
    </section>

    <nav className="lv-nav-bar" aria-label="RAHAT LIVE sections">
      {(["explore", "route", "heat", "relief"] as Tab[]).map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setOpen(true); }}>
        <span>{{ explore: "🧭", route: "🛣", heat: "🌡", relief: "💧" }[t]}</span>{t.toUpperCase()}</button>)}
    </nav>
  </div>;
}
