// The scenario graph uses synthetic local metres. They are NEVER treated as latitude/longitude: positions are
// metre OFFSETS (x east, y north) from an explicit, user-visible demo anchor, and are always labelled SYNTHETIC.

export interface Anchor { lat: number; lon: number }

const M_PER_DEG_LAT = 111_320;

export function offsetToLngLat(anchor: Anchor, xMetres: number, yMetres: number): [number, number] {
  const cos = Math.max(0.01, Math.cos((anchor.lat * Math.PI) / 180));
  return [anchor.lon + xMetres / (M_PER_DEG_LAT * cos), anchor.lat + yMetres / M_PER_DEG_LAT];
}

export function parseAnchor(text: string | undefined): Anchor | null {
  if (!text) return null;
  const parts = text.split(",").map(p => Number(p.trim()));
  if (parts.length !== 2 || parts.some(n => !Number.isFinite(n))) return null;
  const [lat, lon] = parts;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export const KIND_COLOR: Record<string, string> = {
  hospital: "#ff9f6b", zone: "#4cc3ff", water: "#4cc3ff", buffer: "#5ee0b5", pump: "#b79cff",
  drain: "#7fb4ff", road: "#c4cee0", shelter: "#f3d36b", command: "#e8f1ff", hazard: "#ff6b73",
  power: "#f3d36b"
};
export const colorFor = (kind: string) => KIND_COLOR[kind] ?? "#c4cee0";
