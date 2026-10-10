import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LibreMap, GeoJSONSource } from "maplibre-gl";
import { Button, DataBadge, FreshBadge } from "./components";
import { useMapData, useRoute } from "./publicData";
import type { MapFeature, Zone } from "./types";
import "maplibre-gl/dist/maplibre-gl.css";

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
const FONT = KEY ? "Noto Sans Regular" : "Open Sans Regular";
const STYLE = KEY
  ? `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${KEY}`
  : null;

export function zoneDays(z: Zone) {
  const drain = z.demand_lpd / (1 - z.loss_pct / 100) - z.supply_lpd;
  return z.storage_l <= z.reserve_l ? 0 :
    drain > 0 ? (z.storage_l - z.reserve_l) / drain : 1000;
}
export function zoneColor(z: Zone) {
  const d = zoneDays(z);
  return d < 1 ? "#f3757b" : d < 3 ? "#f2a365" : d < 7 ? "#e7c86b" : "#65cfaa";
}
const KIND_STYLE: Record<string, { color: string; name: string }> = {
  groundwater: { color: "#4fd1b5", name: "Groundwater stations" },
  scada: { color: "#5aa9ff", name: "SCADA stations" },
  discharge: { color: "#9ec9ff", name: "Discharge stations" },
  water_supply: { color: "#e9b44c", name: "MIDC supply schemes" }
};
const LAYERS = ["zones", "tanker", "groundwater", "scada", "discharge",
  "water_supply", "route"] as const;
type Layer = typeof LAYERS[number];
const LAYER_NAME: Record<Layer, string> = {
  zones: "Zones & risk", tanker: "Tanker source", route: "Tanker route",
  groundwater: "Groundwater", scada: "SCADA", discharge: "Discharge",
  water_supply: "MIDC schemes"
};

function webglAvailable() {
  // The schematic can be forced (keyboard-friendly, offline, deterministic).
  if (localStorage.getItem("waterpulse-map") === "schematic") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch { return false; }
}
type Picked =
  | { type: "feature"; feature: MapFeature }
  | { type: "zone"; zone: Zone }
  | { type: "tanker"; zone: Zone };

export default function OperationalMap({
  zones, selected, onSelect
}: { zones: Zone[]; selected: string; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(() => !webglAvailable());
  const [visible, setVisible] = useState<Record<Layer, boolean>>({
    zones: true, tanker: true, route: true, groundwater: true, scada: true,
    discharge: true, water_supply: true
  });
  const [picked, setPicked] = useState<Picked | null>(null);
  const mapData = useMapData();
  const active = zones.find(z => z.id === selected) || zones[0];
  const route = useRoute(active?.id ?? null);
  const features = useMemo(() => mapData.data?.features ?? [], [mapData.data]);

  // ---- GeoJSON for each layer (rebuilt only when inputs change)
  const collections = useMemo(() => {
    const fc = (items: object[]) => ({ type: "FeatureCollection" as const,
      features: items });
    const point = (lon: number, lat: number, properties: object) => ({
      type: "Feature" as const, properties,
      geometry: { type: "Point" as const, coordinates: [lon, lat] } });
    const byKind = (kind: string) => fc(features.filter(f => f.kind === kind)
      .map(f => point(f.longitude, f.latitude, {
        id: f.id, stale: f.freshness.status === "STALE" ? 1 : 0 })));
    return {
      zones: fc(zones.map(z => point(z.longitude, z.latitude, {
        id: z.id, name: z.name, color: zoneColor(z),
        selected: z.id === selected ? 1 : 0 }))),
      tanker: fc(zones.filter(z => z.id === selected &&
        z.tanker_source_lat != null && z.tanker_source_lon != null)
        .map(z => point(z.tanker_source_lon!, z.tanker_source_lat!, { id: z.id }))),
      groundwater: byKind("groundwater"), scada: byKind("scada"),
      discharge: byKind("discharge"), water_supply: byKind("water_supply"),
      route: fc(route.data?.geometry && route.data.geometry.length > 1 ? [{
        type: "Feature" as const, properties: {
          routed: route.data.status === "OK" ? 1 : 0 },
        geometry: { type: "LineString" as const,
          coordinates: route.data.geometry } }] : [])
    };
  }, [features, zones, selected, route.data]);
  const collectionsRef = useRef(collections);
  collectionsRef.current = collections;

  // ---- create the map once
  useEffect(() => {
    if (fallback || !container.current || !active) return;
    let disposed = false;
    let timer = 0;
    void import("maplibre-gl").then(({ default: maplibre }) => {
      if (disposed || !container.current) return;
      try {
        const map = new maplibre.Map({
          container: container.current,
          style: STYLE ?? {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            sources: { osm: { type: "raster", tileSize: 256,
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              attribution: "© OpenStreetMap contributors" } },
            layers: [{ id: "basemap", type: "raster", source: "osm",
              paint: { "raster-saturation": -.8, "raster-brightness-max": .55 } }]
          },
          center: [active.longitude, active.latitude], zoom: 8.2,
          attributionControl: { compact: true }
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        const fail = () => { if (!disposed) setFallback(true); };
        map.getCanvas().addEventListener("webglcontextlost", fail);
        timer = window.setTimeout(() => { if (!map.loaded()) fail(); }, 12000);
        map.on("load", () => {
          window.clearTimeout(timer);
          const c = collectionsRef.current;
          const add = (id: string, data: object) => map.addSource(
            id, { type: "geojson", data: data as never,
              ...(id === "water_supply" ? { cluster: true, clusterRadius: 38,
                clusterMaxZoom: 8 } : {}) });
          (Object.keys(c) as Layer[]).forEach(id => add(id, c[id]));
          map.addLayer({ id: "route", type: "line", source: "route",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#c9a7ff", "line-width": 4,
              "line-dasharray": ["case", ["==", ["get", "routed"], 1],
                ["literal", [1, 0]], ["literal", [2, 2]]] as never } });
          map.addLayer({ id: "water_supply-clusters", type: "circle",
            source: "water_supply", filter: ["has", "point_count"],
            paint: { "circle-color": "#e9b44c", "circle-opacity": .75,
              "circle-radius": ["step", ["get", "point_count"], 12, 5, 16, 15, 20] } });
          map.addLayer({ id: "water_supply-count", type: "symbol",
            source: "water_supply", filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"],
              "text-size": 11, "text-font": [FONT] },
            paint: { "text-color": "#201a05" } });
          map.addLayer({ id: "water_supply", type: "circle", source: "water_supply",
            filter: ["!", ["has", "point_count"]],
            paint: { "circle-color": "#e9b44c", "circle-radius": 5,
              "circle-stroke-color": "#1b1608", "circle-stroke-width": 1 } });
          map.addLayer({ id: "groundwater", type: "circle", source: "groundwater",
            paint: { "circle-color": "#4fd1b5", "circle-radius": 6,
              "circle-opacity": ["case", ["==", ["get", "stale"], 1], .45, 1],
              "circle-stroke-color": "#06231d", "circle-stroke-width": 1.5 } });
          map.addLayer({ id: "discharge", type: "circle", source: "discharge",
            paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": 13,
              "circle-stroke-color": "#9ec9ff", "circle-stroke-width": 2.5 } });
          map.addLayer({ id: "scada", type: "circle", source: "scada",
            paint: { "circle-color": "#5aa9ff", "circle-radius": 7,
              "circle-stroke-color": "#04142b", "circle-stroke-width": 2 } });
          map.addLayer({ id: "tanker", type: "circle", source: "tanker",
            paint: { "circle-color": "#c9a7ff", "circle-radius": 8,
              "circle-stroke-color": "#1d1030", "circle-stroke-width": 2 } });
          map.addLayer({ id: "zones", type: "circle", source: "zones",
            paint: { "circle-color": ["get", "color"],
              "circle-radius": ["case", ["==", ["get", "selected"], 1], 15, 10],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 1.5] } });
          map.addLayer({ id: "zones-labels", type: "symbol", source: "zones",
            layout: { "text-field": ["get", "name"], "text-size": 12,
              "text-offset": [0, 1.9], "text-anchor": "top",
              "text-font": [FONT] },
            paint: { "text-color": "#eaf4f6", "text-halo-color": "#0a1418",
              "text-halo-width": 1.5 } });
          for (const id of ["groundwater", "scada", "discharge", "water_supply"]) {
            map.on("click", id, e => {
              const featureId = e.features?.[0]?.properties?.id;
              const hit = collectionsRef.current && featureLookup.current
                .find(f => f.kind === id && f.id === featureId);
              if (hit) setPicked({ type: "feature", feature: hit });
            });
          }
          map.on("click", "zones", e => {
            const id = e.features?.[0]?.properties?.id;
            if (typeof id === "string") onSelectRef.current(id);
          });
          map.on("click", "tanker", () => {
            const z = zonesRef.current.find(q => q.id === selectedRef.current);
            if (z) setPicked({ type: "tanker", zone: z });
          });
          for (const id of ["zones", "scada", "discharge", "groundwater",
            "water_supply", "tanker"]) {
            map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
          }
          setReady(true);
        });
      } catch { setFallback(true); }
    }).catch(() => setFallback(true));
    return () => {
      disposed = true; window.clearTimeout(timer);
      mapRef.current?.remove(); mapRef.current = null; setReady(false);
    };
    // The map is created once; data and layer visibility update in place.
  }, [fallback, active?.id === undefined]);

  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const zonesRef = useRef(zones); zonesRef.current = zones;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const featureLookup = useRef<MapFeature[]>([]); featureLookup.current = features;

  useEffect(() => {  // push data updates into existing sources
    const map = mapRef.current;
    if (!ready || !map) return;
    (Object.keys(collections) as Layer[]).forEach(id => {
      (map.getSource(id) as GeoJSONSource | undefined)
        ?.setData(collections[id] as never);
    });
  }, [collections, ready]);
  useEffect(() => {  // layer toggles
    const map = mapRef.current;
    if (!ready || !map) return;
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    for (const layer of LAYERS) {
      set(layer, visible[layer]);
      if (layer === "zones") set("zones-labels", visible.zones);
      if (layer === "water_supply") {
        set("water_supply-clusters", visible.water_supply);
        set("water_supply-count", visible.water_supply);
      }
    }
  }, [visible, ready]);
  useEffect(() => {  // follow the selected zone
    const map = mapRef.current;
    if (!ready || !map || !active) return;
    map.easeTo({ center: [active.longitude, active.latitude], duration: 700 });
    setPicked(null);
  }, [active?.id, ready]);

  if (!active) return <div className="empty">Configure a zone to show the map.</div>;
  const counts = Object.fromEntries(Object.keys(KIND_STYLE).map(
    k => [k, features.filter(f => f.kind === k).length]));

  return <div className="operational-map">
    <div className="map-toolbar" role="group" aria-label="Map layers">
      {LAYERS.map(layer => <label key={layer}>
        <input type="checkbox" checked={visible[layer]}
          onChange={e => setVisible(v => ({ ...v, [layer]: e.target.checked }))} />
        {LAYER_NAME[layer]}{counts[layer] !== undefined && ` (${counts[layer]})`}
      </label>)}
    </div>
    <div className="map-stage">
      {fallback
        ? <SchematicMap zones={zones} features={features} selected={selected}
            onSelect={onSelect} onPick={setPicked} visible={visible}
            route={route.data?.geometry} active={active} />
        : <div ref={container} className="map-canvas" aria-label="Operational map" />}
      {picked && <InfoPanel picked={picked} close={() => setPicked(null)}
        route={route.data} />}
    </div>
    <ul className="map-legend" aria-label="Map legend">
      <li><i style={{ background: "#65cfaa" }} /> Zone: stable</li>
      <li><i style={{ background: "#e7c86b" }} /> watch</li>
      <li><i style={{ background: "#f2a365" }} /> approaching</li>
      <li><i style={{ background: "#f3757b" }} /> critical</li>
      {Object.entries(KIND_STYLE).map(([k, v]) =>
        <li key={k}><i style={{ background: v.color }} /> {v.name}</li>)}
      <li><i style={{ background: "#c9a7ff" }} /> Tanker source / route</li>
    </ul>
    <div className="map-caption">
      {mapData.error && <strong>Public-data layers unavailable: {mapData.error}. </strong>}
      {mapData.data && Object.entries(mapData.data.layers)
        .filter(([, layer]) => layer.status !== "OK").map(([name]) =>
          <strong key={name}>{name}: DATA UNAVAILABLE. </strong>)}
      Zone markers are points, not municipal zone geometry. Station markers show
      nearby public telemetry, not zone telemetry. MIDC scheme positions are
      approximate town centroids. Route: {route.data?.label ?? "loading"}
      {route.data?.traffic ? ` · ${route.data.traffic}` : ""}.
      {!fallback && !KEY && " Basemap: OpenStreetMap fallback (set VITE_MAPTILER_KEY for MapTiler)."}
      {!fallback && KEY && " Basemap: MapTiler · © OpenStreetMap contributors."}
      {fallback && " Showing the offline schematic (WebGL unavailable or schematic view selected)."}
    </div>
    <div className="zone-switcher" aria-label="Select map zone">
      {zones.map(z => <Button key={z.id} aria-pressed={z.id === selected}
        onClick={() => onSelect(z.id)}>{z.name}</Button>)}
    </div>
  </div>;
}

function fmt(n: number | null | undefined, digits = 2) {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function InfoPanel({ picked, close, route }: {
  picked: Picked; close: () => void; route: ReturnType<typeof useRoute>["data"];
}) {
  return <aside className="map-info" aria-label="Map feature details">
    <button className="map-info-close" onClick={close} aria-label="Close details">×</button>
    {picked.type === "feature" && (() => {
      const f = picked.feature;
      return <>
        <h3>{f.name}</h3>
        <DataBadge label={f.data_label} /> <FreshBadge freshness={f.freshness} />
        <dl>
          <dt>Parameter</dt><dd>{f.headline?.parameter ?? "—"}</dd>
          <dt>Latest value</dt><dd>{fmt(f.headline?.value)} {f.headline?.unit}</dd>
          <dt>Timestamp</dt><dd>{f.timestamp
            ? new Date(f.timestamp).toLocaleString() : "No observation date (baseline)"}</dd>
          <dt>Source</dt><dd>{f.source}</dd>
          <dt>Confidence</dt><dd>{f.confidence ?? "—"}</dd>
          {f.kind === "water_supply" && <>
            <dt>Plant capacity</dt><dd>{fmt(f.capacity_mld)} MLD</dd>
            <dt>Utilisation</dt><dd>{fmt(f.utilisation_pct, 1)}%</dd>
            <dt>Placement</dt><dd>{f.placement}</dd></>}
        </dl>
        {f.note && <p className="note">{f.note}</p>}
      </>;
    })()}
    {picked.type === "zone" && <><h3>{picked.zone.name}</h3>
      <p>Zone point · {picked.zone.location}</p></>}
    {picked.type === "tanker" && <>
      <h3>{picked.zone.tanker_source_name || "Tanker source"}</h3>
      <DataBadge label="DERIVED MODEL INPUT" />
      <dl>
        <dt>Route</dt><dd>{route?.label ?? "—"}</dd>
        <dt>Distance</dt><dd>{fmt(route?.distance_km, 1)} km
          {route?.straight_line_km != null && route.status === "OK" &&
            ` (straight line ${fmt(route.straight_line_km, 1)} km)`}</dd>
        <dt>Duration</dt><dd>{route?.duration_min != null
          ? `${route.duration_min} min` : "Not available"}</dd>
        <dt>Traffic</dt><dd>{route?.traffic ?? "—"}</dd>
      </dl>
      <p className="note">Location is an approximate town centroid, not a tanker
        filling point. No live tanker GPS is connected.</p></>}
  </aside>;
}

/** Offline fallback: plain equirectangular plot around the selected zone. */
function SchematicMap({ zones, features, selected, onSelect, onPick, visible,
  route, active }: {
  zones: Zone[]; features: MapFeature[]; selected: string;
  onSelect: (id: string) => void; onPick: (p: Picked) => void;
  visible: Record<Layer, boolean>; route?: [number, number][]; active: Zone;
}) {
  const span = 1.6;  // degrees of longitude shown
  const x = (lon: number) => 400 + ((lon - active.longitude) / span) * 800;
  const y = (lat: number) => 220 - ((lat - active.latitude) / span) * 800;
  const near = features.filter(f => visible[f.kind] &&
    Math.abs(f.longitude - active.longitude) < span / 2 &&
    Math.abs(f.latitude - active.latitude) < span / 2 * .55);
  return <div className="map-canvas fallback">
    <svg viewBox="0 0 800 440" role="img"
      aria-label="Schematic of zones and nearby public stations around the selected zone">
      <rect width="800" height="440" className="schematic-bg" />
      {route && visible.route && route.length > 1 &&
        <polyline fill="none" stroke="#c9a7ff" strokeWidth="3" strokeDasharray="6 5"
          points={route.map(([lon, lat]) => `${x(lon)},${y(lat)}`).join(" ")} />}
      {near.map(f => <g key={`${f.kind}-${f.id}`} tabIndex={0} role="button"
        aria-label={`${f.name}, ${KIND_STYLE[f.kind].name}`}
        onClick={() => onPick({ type: "feature", feature: f })}
        onKeyDown={e => { if (e.key === "Enter") onPick({ type: "feature", feature: f }); }}>
        <circle cx={x(f.longitude)} cy={y(f.latitude)}
          r={f.kind === "discharge" ? 12 : 6}
          fill={f.kind === "discharge" ? "none" : KIND_STYLE[f.kind].color}
          stroke={KIND_STYLE[f.kind].color} strokeWidth="2"
          opacity={f.freshness.status === "STALE" ? .55 : 1} />
        <title>{f.name} · {KIND_STYLE[f.kind].name}</title>
      </g>)}
      {visible.tanker && active.tanker_source_lat != null && active.tanker_source_lon != null &&
        <circle cx={x(active.tanker_source_lon)} cy={y(active.tanker_source_lat)} r="8"
          fill="#c9a7ff" tabIndex={0} role="button" aria-label="Tanker source"
          onClick={() => onPick({ type: "tanker", zone: active })} />}
      {visible.zones && zones.map(z => <g key={z.id} tabIndex={0} role="button"
        aria-label={`Zone ${z.name}`} onClick={() => onSelect(z.id)}
        onKeyDown={e => { if (e.key === "Enter") onSelect(z.id); }}>
        <circle cx={x(z.longitude)} cy={y(z.latitude)} r={z.id === selected ? 14 : 9}
          fill={zoneColor(z)} stroke="#fff" strokeWidth={z.id === selected ? 3 : 1.5} />
        <text x={x(z.longitude)} y={y(z.latitude) + 28} textAnchor="middle"
          className="schematic-label">{z.name}</text>
      </g>)}
    </svg>
  </div>;
}
