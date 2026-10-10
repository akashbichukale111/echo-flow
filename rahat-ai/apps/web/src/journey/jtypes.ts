export type HeatClass = "LOW" | "MODERATE" | "ELEVATED" | "HIGH";
export type RouteId = "fastest" | "rahat" | "relief-priority" | "balanced";

export interface JNode { id: number; name: string; x: number; y: number; lat: number; lon: number }
export interface JMap {
  nodes: JNode[]; edges: number[][]; width: number; height: number;
  buildings: { id: string; x: number; y: number; w: number; d: number; h: number }[];
  trees: { x: number; y: number; r: number }[];
  source: string; coverage: string; timestamp: string; city: string;
}
export interface JPOI {
  id: string; node: number; name: string; type: string; tags: string[];
  water: boolean; shade: boolean; cooling: boolean; rest: boolean;
  status: string; source: string; verification: string; availability: string;
  confidence: string; last_updated: string; lat: number; lon: number;
}
export interface JSegment {
  a: number; b: number; distance: number; minutes: number; load: number; shade: number;
  solar_exposure: number; rate: number; delay_minutes: number; heat_class: HeatClass;
  explanation: string; source: string; timestamp: string; confidence: string;
  relief_access: number; breakdown: Record<string, number>;
  nearby_relief: { id: string; name: string; type: string; distance_m: number } | null;
}
export interface Stage { poi: string; name: string; node: number; kinds: string[]; source: string }
export interface JRoute {
  id: RouteId; label: string; nodes: number[]; segments: JSegment[]; minutes: number;
  travel_minutes: number; distance: number; load: number; shade: number; solar_exposure: number;
  relief_count: number; relief_ids: string[]; detour_minutes: number; confidence: string;
  same_geometry_as: RouteId | null; classes: Record<HeatClass, number>;
  water_on_route: number; rest_on_route: number; cooling_on_route: number;
  shade_points_on_route: number; needs_coverage: Record<string, number>;
  corridor: { stages: Stage[]; label: string; complete: boolean };
  breakdown: Record<string, number>;
  delta_vs_fastest: { minutes: number; distance: number; load: number; load_pct: number };
}
export interface JEvidence {
  source: string; timestamp: string | null; coverage: string; confidence: string;
  method: string; limitations: string;
}
export interface JPlan {
  request: JReq; weather: { temperature_c: number; humidity_pct: number; source: string };
  sun: { azimuth: number; elevation: number }; routes: JRoute[]; evidence: JEvidence[];
  heatwave: { active: boolean; threshold_c: number; temperature_c: number; note: string };
  data_labels: string[];
}
export interface JReq {
  origin: number; destination: number; waypoints: { node: number }[]; needs: string[];
  travel_mode: "walk" | "cycle" | "rider"; departure: string; max_detour_pct: number;
  heatwave: boolean; delay_min: number; closed_relief: string[];
}
export interface ProviderStatus { name: string; state: string; detail: string; real_mode: string }
export interface JBoot {
  map: JMap; relief: JPOI[]; needs: string[]; defaults: JReq; heatwave_threshold_c: number;
  providers: ProviderStatus[];
}
export interface Place {
  name: string; lat: number; lon: number; inside_demo_coverage: boolean; node: number | null;
  snapped_distance_m: number | null; source: string; note: string | null;
}
export interface NeedItem extends JPOI {
  distance: number; minutes: number; detour_minutes: number; load_to_relief: number;
  rank_score: number; why: string;
}
export interface NeedResult {
  node: number; radius_m: number; items: NeedItem[]; framing: string; source: string;
  by_type: Record<string, null | {
    id: string; name: string; distance_m: number; minutes: number; detour_minutes: number;
  }>;
}
export interface Metrics { minutes: number; distance: number; load: number; relief: number; shade: number }
export interface Change {
  reason: string; before: Metrics; after: Metrics; geometryChanged: boolean;
  apply: () => void;
}
export const HEAT_COLOR: Record<HeatClass, string> = {
  LOW: "#5fd3a1", MODERATE: "#e6d46a", ELEVATED: "#f59a48", HIGH: "#ee5438",
};
export const metricsOf = (r: JRoute): Metrics => ({
  minutes: r.minutes, distance: r.distance, load: r.load,
  relief: r.relief_count, shade: r.shade,
});
