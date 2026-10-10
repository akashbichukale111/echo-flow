import { api } from "../api";
import type { Analysis, LatLon, Place, Reassess, Relief, ScenarioRow, Evidence, Exposure, RealRoute } from "./types";
import type { SunInfo } from "./sun";

export interface Status { mode: "REAL" | "DEMO"; demoFallback: boolean; providers: Record<string, string> }
const sunBody = (s: SunInfo | null) => (s ? { sun: { altitudeDeg: s.altitudeDeg, azimuthDeg: s.azimuthDeg } } : {});
const pt = (p: LatLon) => ({ lat: p.lat, lon: p.lon });

export const realStatus = () => api<Status>("/real/status");
export const realSearch = (q: string, bias?: LatLon, signal?: AbortSignal) =>
  api<{ items: Place[]; evidence: Evidence }>(
    `/real/search?q=${encodeURIComponent(q)}${bias ? `&lat=${bias.lat}&lon=${bias.lon}` : ""}`, undefined, signal);
export const realReverse = (p: LatLon) => api<{ label: string; source: string }>(`/real/reverse?lat=${p.lat}&lon=${p.lon}`);
export const realAnalyze = (origin: LatLon, destination: LatLon, sun: SunInfo | null,
  travelMode: "walk" | "cycle" | "rider" | "car" = "rider", maxDetourPct = 40) =>
  api<Analysis>("/real/analyze", { origin: pt(origin), destination: pt(destination), travelMode, maxDetourPct, ...sunBody(sun) });
export const realScenario = (origin: LatLon, destination: LatLon, sun: SunInfo | null,
  scenario: { tempOffsetC?: number; shadeRemoved?: boolean; delayMin?: number; waterUnavailable?: boolean; cloudPct?: number }) =>
  api<{ ok: boolean; rows: ScenarioRow[]; before: Analysis; after: Analysis }>("/real/scenario", {
    base: { origin: pt(origin), destination: pt(destination), ...sunBody(sun) }, scenario });
export const realReassess = (route: RealRoute, position: LatLon, state: Exposure | Record<string, never>,
  opts: { elapsedMin: number; needRahat?: boolean; weatherTempC?: number; lastWeatherTempC?: number; relief: Relief[] }) =>
  api<Reassess>("/real/reassess", {
    routeCoords: route.coords, segments: route.segments, position: pt(position), state,
    elapsedMin: opts.elapsedMin, needRahat: !!opts.needRahat, weatherTempC: opts.weatherTempC,
    lastWeatherTempC: opts.lastWeatherTempC, relief: opts.relief.slice(0, 100) });
export const realExplain = (origin: LatLon, destination: LatLon, sun: SunInfo | null) =>
  api<{ text: string; source: string; warning?: string }>("/real/explain", { origin: pt(origin), destination: pt(destination), ...sunBody(sun) });
export const realReport = (kind: string, p: LatLon, note = "") =>
  api<{ id: string; status: string }>("/real/reports", { kind, lat: p.lat, lon: p.lon, note });
export const realReports = (p: LatLon) => api<{ items: { id: string; kind: string; status: string; reportedAt: string; latitude: number; longitude: number }[] }>(
  `/real/reports?lat=${p.lat}&lon=${p.lon}`);
export const realSnapshot = (origin: LatLon, destination: LatLon, sun: SunInfo | null) =>
  api<{ id: string; dataMode: string }>("/real/evidence-snapshot", { method: "POST", body: JSON.stringify({ origin: pt(origin), destination: pt(destination), ...sunBody(sun) }) });
