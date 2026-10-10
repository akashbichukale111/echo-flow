export type Pt = [number, number]; // [lat, lon]
const R = Math.PI / 180;

export function distM(a: Pt, b: Pt): number {
  const dLat = (b[0] - a[0]) * R, dLon = (b[1] - a[1]) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Snap { distM: number; index: number; remainM: number; totalM: number }

/** Nearest point on a lat/lon polyline: lateral distance, segment index and metres still to travel. */
export function snap(coords: Pt[], p: { lat: number; lon: number }): Snap {
  const kx = Math.cos(p.lat * R) * 111320, ky = 110540;
  let best = { d: Infinity, i: 0, t: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a[1] - p.lon) * kx, ay = (a[0] - p.lat) * ky, bx = (b[1] - p.lon) * kx, by = (b[0] - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, i, t };
  }
  let remain = 0, total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const l = distM(coords[i], coords[i + 1]);
    total += l;
    if (i === best.i) remain += (1 - best.t) * l; else if (i > best.i) remain += l;
  }
  return { distM: best.d, index: best.i, remainM: remain, totalM: total };
}

export const kmLabel = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
export const minLabel = (min: number) => (min < 1 ? "<1 min" : min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.round(min)} min`);
