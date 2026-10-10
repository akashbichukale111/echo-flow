import type { LatLon } from "./types";

export interface View { w: number; h: number; project: (lat: number, lon: number) => [number, number] }

/** Fit lat/lon points into a w x h SVG box with equal-scale (cos-lat corrected) axes. */
export function fitView(points: LatLon[], w = 640, h = 380, pad = 28): View {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const spanX = Math.max(1e-6, (maxLon - minLon) * k), spanY = Math.max(1e-6, maxLat - minLat);
  const s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
  return { w, h, project: (lat, lon) => [ox + (lon - minLon) * k * s, h - (oy + (lat - minLat) * s)] };
}
export const pathOf = (v: View, coords: [number, number][]) =>
  coords.map(([la, lo], i) => `${i ? "L" : "M"}${v.project(la, lo).map(n => n.toFixed(1)).join(",")}`).join("");
