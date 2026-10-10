import type { LatLon } from "./types";

export interface Fix extends LatLon {
  accuracy: number; speed: number | null; heading: number | null; timestamp: number;
}

export function toFix(p: { coords: { latitude: number; longitude: number; accuracy: number; speed: number | null; heading: number | null }; timestamp: number }): Fix {
  const c = p.coords;
  return {
    lat: c.latitude, lon: c.longitude, accuracy: c.accuracy,
    speed: c.speed != null && Number.isFinite(c.speed) ? c.speed : null,
    heading: c.heading != null && Number.isFinite(c.heading) ? c.heading : null,
    timestamp: p.timestamp,
  };
}

export function gpsErrorMessage(code: number | undefined): string {
  if (code === 1) return "Location permission was denied. You can still plan with a demo start point (DEMO DATA).";
  if (code === 2) return "Your position could not be determined. Demo start point available.";
  if (code === 3) return "Location timed out. Try again or use the demo start point.";
  return "Location is unavailable in this browser. Demo start point available.";
}

export class GpsError extends Error {
  code: number | undefined;
  constructor(message: string, code?: number) { super(message); this.name = "GpsError"; this.code = code; }
}

export function gpsSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

/** One-shot fix. Called only from a user gesture, never on page load. */
export function getFix(timeoutMs = 12000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!gpsSupported()) { reject(new GpsError(gpsErrorMessage(undefined))); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve(toFix(p)),
      e => reject(new GpsError(gpsErrorMessage(e.code), e.code)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5000 },
    );
  });
}

/** Live updates, throttled so a noisy GPS does not trigger constant recalculation. */
export function watchFixes(onFix: (f: Fix) => void, onError: (m: string, code?: number) => void,
  minIntervalMs = 4000, minMoveM = 15): () => void {
  if (!gpsSupported()) { onError(gpsErrorMessage(undefined)); return () => undefined; }
  let last: Fix | null = null;
  const id = navigator.geolocation.watchPosition(p => {
    const fix = toFix(p);
    if (last && fix.timestamp - last.timestamp < minIntervalMs && moved(last, fix) < minMoveM) return;
    last = fix; onFix(fix);
  }, e => onError(gpsErrorMessage(e.code), e.code), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  return () => navigator.geolocation.clearWatch(id);
}

export function moved(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
