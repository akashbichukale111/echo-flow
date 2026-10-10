import * as SunCalc from "suncalc";

export interface SunInfo {
  altitudeDeg: number; azimuthDeg: number; sunrise: Date | null; sunset: Date | null; source: "SunCalc";
}
const valid = (d: Date | null) => (d && Number.isFinite(d.getTime()) ? d : null);

/** SunCalc azimuth is radians from SOUTH toward WEST; RAHAT uses compass degrees from NORTH. */
export function sunAt(lat: number, lon: number, at: Date = new Date()): SunInfo {
  const p = SunCalc.getPosition(at, lat, lon);
  const t = SunCalc.getTimes(at, lat, lon);
  return {
    altitudeDeg: (p.altitude * 180) / Math.PI,
    azimuthDeg: (((p.azimuth * 180) / Math.PI + 180) % 360 + 360) % 360,
    sunrise: valid(t.sunrise), sunset: valid(t.sunset), source: "SunCalc",
  };
}
