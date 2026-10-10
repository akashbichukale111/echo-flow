import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Graph from "./Graph";
import { colorFor, offsetToLngLat, type Anchor } from "./geo";
import { describeMapFailure, withKey, type MapConfig } from "./mapConfig";
import type { LiveContext, MapPhase, PickMode, RouteState, Scenario } from "./types";

export interface LayerState { entities: boolean; links: boolean; route: boolean; live: boolean }

interface Props {
  config: MapConfig;
  scenario: Scenario;
  anchor: Anchor | null;
  onAnchor: (a: Anchor) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  layers: LayerState;
  onLayers: (l: LayerState) => void;
  liveCtx: LiveContext | null;
  route: RouteState;
  pickMode: PickMode;
  onPick: (mode: PickMode, lngLat: [number, number]) => void;
  onRequestPick: (mode: PickMode) => void;
  onCancelPick: () => void;
  onPhase: (phase: MapPhase, reason: string) => void;
}

const INDIA_OVERVIEW: [number, number] = [78.96, 22.59];
const LOAD_TIMEOUT_MS = 15000;
const empty = { type: "FeatureCollection", features: [] } as const;

export default function MapView(props: Props) {
  const { config, scenario } = props;
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<MlMarker[]>([]);
  const latest = useRef(props);
  latest.current = props;
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<MapPhase>(config.status === "READY" ? "LOADING" : "NOT_CONFIGURED");
  const [reason, setReason] = useState(config.status === "READY" ? "" : `Not configured: ${config.missing.join(", ")}`);
  const [tileWarning, setTileWarning] = useState("");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const update = useCallback((p: MapPhase, r: string) => {
    setPhase(p); setReason(r); latest.current.onPhase(p, r);
  }, []);

  useEffect(() => { props.onPhase(phase, reason); /* report initial state */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const entityPositions = useMemo(() => {
    if (!props.anchor) return {} as Record<string, [number, number]>;
    const a = props.anchor;
    return Object.fromEntries(scenario.graph.nodes.map(n => [n.id, offsetToLngLat(a, n.x, n.y)]));
  }, [props.anchor, scenario.graph]);

  const fit = useCallback(() => {
    const map = mapRef.current;
    const pts = Object.values(entityPositions);
    if (!map) return;
    if (!pts.length) { map.flyTo({ center: INDIA_OVERVIEW, zoom: 4, essential: false, duration: reduced ? 0 : 800 }); return; }
    const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach(p => b.extend(p));
    map.fitBounds(b, { padding: 70, maxZoom: 15, duration: reduced ? 0 : 800 });
  }, [entityPositions, reduced]);

  const entityPositionsRef = useRef(entityPositions);
  entityPositionsRef.current = entityPositions;
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // ---- create the map once per configuration/attempt -------------------------------------------------------
  useEffect(() => {
    if (config.status !== "READY" || !box.current) return;
    let loaded = false;
    let timer = 0;
    let map: MlMap;
    update("LOADING", "");
    setTileWarning("");
    const fail = (status?: number) => {
      if (loaded) return;
      window.clearTimeout(timer);
      update("FAILED", describeMapFailure(status, config));
    };
    try {
      map = new maplibregl.Map({
        container: box.current,
        style: config.styleUrl,
        center: latest.current.anchor ? [latest.current.anchor.lon, latest.current.anchor.lat] : INDIA_OVERVIEW,
        zoom: latest.current.anchor ? 13 : 4,
        attributionControl: { compact: true },
        transformRequest: url => withKey(url, config) ?? { url }
      });
    } catch {
      update("FAILED", describeMapFailure(undefined, config));
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    timer = window.setTimeout(() => fail(undefined), LOAD_TIMEOUT_MS);

    map.on("load", () => {
      loaded = true;
      window.clearTimeout(timer);
      map.addSource("links", { type: "geojson", data: empty as never });
      map.addSource("route", { type: "geojson", data: empty as never });
      map.addLayer({ id: "links-dependency", type: "line", source: "links", filter: ["==", ["get", "dashed"], true],
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.9 } });
      map.addLayer({ id: "links-route", type: "line", source: "links", filter: ["==", ["get", "dashed"], false],
        paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.95 } });
      map.addLayer({ id: "route-casing", type: "line", source: "route",
        paint: { "line-color": "#06121f", "line-width": 9, "line-opacity": 0.85 } });
      map.addLayer({ id: "route-line", type: "line", source: "route",
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#35e0ff", "line-width": 5 } });
      update("READY", "");
      if (Object.keys(entityPositionsRef.current).length) fitRef.current();
    });
    map.on("error", e => {
      const status = (e.error as { status?: number } | undefined)?.status;
      if (!loaded) fail(status);
      else setTileWarning(status === 401 || status === 403
        ? "Some map data was refused (authorization)." : "Some map tiles failed to load.");
    });
    map.on("click", e => {
      const { pickMode, onPick } = latest.current;
      if (pickMode !== "none") onPick(pickMode, [e.lngLat.lng, e.lngLat.lat]);
      else latest.current.onSelect(null);
    });
    return () => {
      window.clearTimeout(timer);
      markers.current.forEach(m => m.remove());
      markers.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [config, attempt, update]);

  // ---- keep layers and markers in sync with scenario state ------------------------------------------------
  const run = scenario.run;
  const metrics = run?.simulation.metrics;
  const echoes = run?.simulation.echoes ?? [];

  useEffect(() => {
    const map = mapRef.current;
    if (!map || phase !== "READY") return;
    const byId = Object.fromEntries(scenario.graph.nodes.map(n => [n.id, n]));
    const links = scenario.graph.edges.flatMap(e => {
      const a = entityPositions[e.source], b = entityPositions[e.target];
      if (!a || !b || !byId[e.source] || !byId[e.target]) return [];
      const active = echoes.some(x => x.source === e.source && x.target === e.target);
      const isRoute = e.kind === "route";
      return [{ type: "Feature", properties: { dashed: !isRoute, color: active ? "#ffb35c" : isRoute ? "#d5dfef" : "#4a93a8" },
        geometry: { type: "LineString", coordinates: [a, b] } }];
    });
    (map.getSource("links") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: links } as never);
    const geometry = props.route.phase === "LIVE" && props.route.result?.status === "LIVE"
      ? (props.route.result.data as { geometry: [number, number][] }).geometry : null;
    (map.getSource("route") as GeoJSONSource | undefined)?.setData(geometry
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geometry } }] } as never
      : empty as never);
    const vis = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
    vis("links-dependency", props.layers.links && Boolean(props.anchor));
    vis("links-route", props.layers.links && Boolean(props.anchor));
    vis("route-casing", props.layers.route);
    vis("route-line", props.layers.route);
  }, [phase, scenario.graph, entityPositions, echoes, props.route, props.layers, props.anchor]);

  useEffect(() => {
    const map = mapRef.current;
    markers.current.forEach(m => m.remove());
    markers.current = [];
    if (!map || phase !== "READY") return;
    const add = (el: HTMLElement, lngLat: [number, number]) => {
      markers.current.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map));
    };
    const depth: Record<string, number | undefined> = {
      A: typeof metrics?.zone_a_depth_m === "number" ? metrics.zone_a_depth_m : undefined,
      B: typeof metrics?.zone_b_depth_m === "number" ? metrics.zone_b_depth_m : undefined
    };
    if (props.layers.entities && props.anchor) {
      for (const n of scenario.graph.nodes) {
        const pos = entityPositions[n.id];
        if (!pos) continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = `map-pin${props.selectedId === n.id ? " selected" : ""}${depth[n.id] ? " wet" : ""}`;
        el.style.setProperty("--pin", colorFor(n.kind));
        const d = depth[n.id];
        el.setAttribute("aria-label", `${n.id}, ${n.kind}, synthetic demo entity${d !== undefined ? `, simulated depth ${d.toFixed(2)} metres` : ""}`);
        el.innerHTML = `<i></i><span>${n.id}${d !== undefined ? ` · ${d.toFixed(2)} m` : ""}</span>`;
        el.addEventListener("click", ev => { ev.stopPropagation(); latest.current.onSelect(n.id); });
        add(el, pos);
      }
    }
    const endpoint = (label: "A" | "B", p: [number, number] | null) => {
      if (!p) return;
      const el = document.createElement("div");
      el.className = "map-pin route-end";
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", label === "A" ? "Route origin" : "Route destination");
      el.innerHTML = `<i>${label}</i>`;
      add(el, p);
    };
    if (props.layers.route) { endpoint("A", props.route.origin); endpoint("B", props.route.destination); }
    if (props.layers.live && props.liveCtx) {
      const el = document.createElement("div");
      el.className = "map-pin live-point";
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "Live public-data query point");
      el.innerHTML = "<i></i><span>LIVE QUERY POINT</span>";
      add(el, [props.liveCtx.lon, props.liveCtx.lat]);
    }
  }, [phase, scenario.graph, entityPositions, metrics, props.layers, props.selectedId, props.route.origin, props.route.destination, props.liveCtx, props.anchor]);

  // Re-fit only when the anchor or scenario identity changes, never on every decision run (keeps the user's zoom).
  useEffect(() => { if (phase === "READY" && props.anchor) fitRef.current(); },
    [phase, props.anchor?.lat, props.anchor?.lon, scenario.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current;
    if (el) el.style.cursor = props.pickMode === "none" ? "" : "crosshair";
  }, [props.pickMode]);

  // ---- fallback: never a blank panel --------------------------------------------------------------------
  if (phase === "NOT_CONFIGURED" || phase === "FAILED") {
    return (
      <div className="map-fallback">
        <div className="map-banner" role="alert">
          <strong>{phase === "NOT_CONFIGURED" ? "GEOGRAPHIC MAP NOT CONNECTED" : "GEOGRAPHIC MAP FAILED TO LOAD"}</strong>
          <p>{reason}</p>
          {phase === "NOT_CONFIGURED" && (
            <p>Set <code>VITE_AMAZON_LOCATION_API_KEY</code> in the root <code>.env</code> (browser key with <code>geo:GetMap*</code> on
              map <code>{config.mapName}</code>) and restart the dev server. Showing the synthetic schematic below — it is
              not a geographic map.</p>
          )}
          {phase === "FAILED" && <button className="secondary" onClick={() => setAttempt(a => a + 1)}>RETRY MAP</button>}
        </div>
        <Graph graph={scenario.graph} echoes={echoes} onSelectNode={props.onSelect} />
      </div>
    );
  }

  const nothingPlaced = !props.anchor;
  return (
    <div className="map-stage">
      <div ref={box} className="map-canvas" role="application" aria-label="Interactive emergency operations map" />
      {phase === "LOADING" && <div className="map-loading" role="status"><span className="skeleton-bar" />Loading OpenStreetMap…</div>}
      {phase === "READY" && (
        <>
          <div className="map-chip" title="Basemap data is supplied by OpenStreetMap">
            <span className="dot ok" />BASEMAP · OPENSTREETMAP
            {tileWarning && <em role="status"> · {tileWarning}</em>}
          </div>
          <fieldset className="map-layers">
            <legend>Layers</legend>
            {([
              ["entities", "Demo entities (synthetic)"], ["links", "Links (simulation / synthetic)"],
              ["route", "Calculated route"], ["live", "Live query point"]
            ] as const).map(([k, label]) => (
              <label key={k}><input type="checkbox" checked={props.layers[k]}
                onChange={e => props.onLayers({ ...props.layers, [k]: e.target.checked })} />{label}</label>
            ))}
            <button type="button" className="secondary tiny" onClick={fit}>RECENTER</button>
          </fieldset>
          <details className="map-legend" open>
            <summary>Legend</summary>
            <ul>
              <li><span className="swatch pin" />Pin · SYNTHETIC demo entity (colour = type)</li>
              <li><span className="swatch wet" />Ring · simulated water depth <b className="tag derived">DERIVED</b></li>
              <li><span className="swatch line solid" />Simulation-derived route (synthetic network)</li>
              <li><span className="swatch line dash" />Synthetic dependency (illustrative)</li>
              <li><span className="swatch line calc" />Calculated route · Amazon Location <b className="tag derived">DERIVED</b></li>
              <li><span className="swatch live" />Live query point <b className="tag real">REAL / PUBLIC</b></li>
            </ul>
            <p>No real flood extent, closures or facilities are drawn.</p>
          </details>
          {nothingPlaced && (
            <div className="map-place" role="region" aria-label="Place synthetic scenario">
              <strong>Synthetic demo scenario is not placed</strong>
              <p>Its coordinates are local metres, not latitude/longitude. Choose where to anchor it for visualisation only.</p>
              <button onClick={() => { const c = mapRef.current?.getCenter(); if (c) props.onAnchor({ lat: c.lat, lon: c.lng }); }}>PLACE AT MAP CENTRE</button>
              <button className="secondary" onClick={() => props.onRequestPick("anchor")}>CLICK MAP TO PLACE</button>
            </div>
          )}
          {props.pickMode !== "none" && (
            <div className="map-pick" role="status">
              {props.pickMode === "anchor" ? "Click the map to anchor the synthetic demo scenario"
                : `Click the map to set the route ${props.pickMode}`}
              <button className="secondary tiny" onClick={props.onCancelPick}>CANCEL</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
