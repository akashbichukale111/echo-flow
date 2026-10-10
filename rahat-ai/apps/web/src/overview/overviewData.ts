import type { HeatClass, JNode, JPOI, JRoute } from "../journey/jtypes";

export type SceneMode = "idle" | "destination" | "relief" | "starting";
export type ReliefKind = "SHADE" | "WATER" | "REST" | "COOLING";
export const RELIEF_KINDS: ReliefKind[] = ["SHADE", "WATER", "REST", "COOLING"];
export const RELIEF_FLAG: Record<ReliefKind, "shade" | "water" | "rest" | "cooling"> = {
  SHADE: "shade", WATER: "water", REST: "rest", COOLING: "cooling",
};
export const RELIEF_LABEL: Record<ReliefKind, string> = {
  SHADE: "Nearest shade", WATER: "Nearest water", REST: "Rest point", COOLING: "Cooling centre",
};

export interface NearestRelief { poi: JPOI; meters: number }
export type NearestMap = Record<ReliefKind, NearestRelief | null>;

/** Great-circle distance in metres. Straight-line, not network distance. */
export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestRelief(pois: JPOI[], origin: JNode | undefined): NearestMap {
  const out: NearestMap = { SHADE: null, WATER: null, REST: null, COOLING: null };
  if (!origin) return out;
  for (const kind of RELIEF_KINDS) {
    const flag = RELIEF_FLAG[kind];
    let best: NearestRelief | null = null;
    for (const poi of pois) {
      if (!poi[flag] || poi.status !== "OPEN") continue;
      const meters = haversine(origin.lat, origin.lon, poi.lat, poi.lon);
      if (!best || meters < best.meters) best = { poi, meters };
    }
    out[kind] = best;
  }
  return out;
}

const ORDER: HeatClass[] = ["LOW", "MODERATE", "ELEVATED", "HIGH"];
/** Segment-count-weighted mean heat class of a route. */
export function meanClass(classes: Record<HeatClass, number>): HeatClass {
  let n = 0;
  let sum = 0;
  ORDER.forEach((c, i) => { n += classes[c]; sum += classes[c] * i; });
  return n === 0 ? "MODERATE" : ORDER[Math.round(sum / n)];
}
export const classWord = (c: HeatClass) => c[0] + c.slice(1).toLowerCase();

export function solarLabel(elevationDeg: number): "High" | "Moderate" | "Low" {
  return elevationDeg >= 55 ? "High" : elevationDeg >= 30 ? "Moderate" : "Low";
}
export function shadeLabel(fraction: number): "Low" | "Moderate" | "High" {
  return fraction < 0.25 ? "Low" : fraction < 0.5 ? "Moderate" : "High";
}
export function distLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

export interface Chip { label: string; query: string; landmark?: string }
export const CHIPS: Chip[] = [
  { label: "India Gate", query: "India Gate", landmark: "India Gate" },
  { label: "Connaught Place", query: "Connaught Place", landmark: "Connaught Place" },
  { label: "AIIMS Delhi", query: "AIIMS" },
  { label: "New Delhi Railway Station", query: "New Delhi Railway Station" },
  { label: "Lal Qila", query: "Lal Qila" },
  { label: "Akshardham", query: "Akshardham" },
];

/** Demo landmark nodes are named "<place> (demo node)"; resolve those without a network call. */
export function landmarkNode(nodes: JNode[], landmark: string): number | null {
  const n = nodes.find(x => x.name.startsWith(landmark));
  return n ? n.id : null;
}

export function routePair(routes: JRoute[] | undefined) {
  const fast = routes?.find(r => r.id === "fastest");
  const rahat = routes?.find(r => r.id === "rahat");
  return fast && rahat ? { fast, rahat } : null;
}
