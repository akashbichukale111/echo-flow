import fs from "fs";

const payload = {
  origin: { lat: 18.152, lon: 74.576 },
  destination: { lat: 18.152, lon: 74.576 },
  travelMode: "rider",
  maxDetourPct: 40,
  sun: { altitudeDeg: null, azimuthDeg: null }
};

fetch("http://localhost:8010/api/real/analyze", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
}).then(r => r.text()).then(console.log);
