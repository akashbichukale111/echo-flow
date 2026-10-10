import * as SunCalc from "suncalc";

const valid = (d) => (d && Number.isFinite(d.getTime()) ? d : null);

function sunAt(lat, lon, at = new Date()) {
  const p = SunCalc.getPosition(at, lat, lon);
  const t = SunCalc.getTimes(at, lat, lon);
  return {
    altitudeDeg: (p.altitude * 180) / Math.PI,
    azimuthDeg: (((p.azimuth * 180) / Math.PI + 180) % 360 + 360) % 360,
    sunrise: valid(t.sunrise), sunset: valid(t.sunset), source: "SunCalc",
  };
}

try {
  console.log(sunAt(18.152, 74.576));
} catch (e) {
  console.error("Error:", e);
}
