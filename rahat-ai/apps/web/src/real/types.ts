export type LatLon = { lat: number; lon: number };
export type SourceType = "PUBLIC_API" | "USER_INPUT" | "COMMUNITY_REPORT" | "DEMO_DATA" | "MODEL_ESTIMATE" | "AI_EXPLANATION";
export type Conf = "HIGH" | "MEDIUM" | "LOW";
export interface Evidence {
  key: string; source: string; sourceType: SourceType; badge: string; confidence: Conf;
  observedAt: string | null; freshness: "LIVE" | "RECENT" | "HISTORICAL" | "UNKNOWN";
  limitations: string; note?: string; cloudCover?: number | null; ageDays?: number; stale?: boolean; count?: number;
  computed?: boolean; sceneId?: string; ageLabel?: string;
}
export interface SatelliteContext {
  sentinel2: { sceneId: string; acquisitionDate: string; cloudCover: number | null; ageDays: number; meanNdvi: number | null;
    vegetationFraction: number | null; validPixelFraction: number | null; freshness: string } | null;
  landsat: { sceneId: string; acquisitionDate: string; cloudCover: number | null; ageDays: number; surfaceTemperatureC: number | null;
    validPixelFraction: number | null; freshness: string; weight: number } | null;
}
export interface Seg {
  start: [number, number]; end: [number, number]; lengthM: number; minutes: number;
  shade: number; rate: number; load: number; class: "LOW" | "MODERATE" | "ELEVATED" | "HIGH";
}
export interface Relief {
  id: string; type: "WATER" | "SHADE" | "REST" | "COOLING" | "HOSPITAL" | "TRANSIT"; name: string;
  latitude: number; longitude: number; source: string; sourceType: SourceType; status: string;
  confidence: Conf; availability: string; lastVerified: string | null; freshness: string;
  distanceMeters?: number; offRouteMeters?: number | null; score?: number; note?: string; reportNote?: string;
}
export type RouteId = "fastest" | "balanced" | "rahat";
export interface RealRoute {
  id: RouteId; label: string; minutes: number; distanceM: number; thermalLoad: number; avgRate: number;
  heatContext: string; estimatedShade: number; shadeConfidence: Conf; buildingCount: number;
  coords: [number, number][]; segments: Seg[]; providerRouteId: string; source: string; sourceType: SourceType;
  sameAs: RouteId[]; headline: string | null; reliefNear: Relief[]; reliefCount: number;
  components: Record<string, number>;
  deltaVsFastest: { minutes: number; thermalLoadPct: number; shadePts: number; detourPct: number };
  why: { increasedBy: string[]; reducedBy: string[] };
}
export interface Weather {
  temperatureC: number; feelsLikeC: number; humidityPct: number; windKph: number; uvIndex: number;
  cloudPct: number; precipitationMm: number; visibilityKm: number; condition: string;
  observedAt: string | null; source: string; sourceType: SourceType; freshness: string;
}
export interface Analysis {
  ok: boolean; error?: string; dataMode: "REAL DATA" | "DEMO DATA"; weather: Weather;
  sun: { elevation: number; azimuth: number; source: string }; routes: RealRoute[]; relief: Relief[];
  evidence: Record<string, Evidence>; satelliteContext?: SatelliteContext;
  modelConfidence?: { level: Conf; reasons: string[] }; generatedAt: string; disclaimer: string; negativeReports?: number;
}
export interface Place { id: string | null; name: string; label: string; lat: number; lon: number; source: string; sourceType: SourceType }
export interface ScenarioRow {
  id: RouteId; before: { minutes: number; estimatedShade: number; thermalLoad: number };
  after: { minutes: number; estimatedShade: number; thermalLoad: number };
  reliefBefore: number; reliefAfter: number; routeChanged: boolean;
}
export interface Exposure { cumulative: number; history: { added: number; credit: number; cumulative: number; why: string[] }[] }
export interface Reassess {
  routeIndex: number; segmentIndex: number; deviationM: number; heatContext: string; triggers: string[];
  shouldReassess: boolean; relief: Relief[]; state: Exposure; progressPct: number;
}
