export type SourceType =
  | "PUBLIC DATA" | "OPERATOR INPUT" | "DEMO DATA"
  | "MODEL OUTPUT" | "AI RECOMMENDATION"
  | "DERIVED MODEL INPUT" | "SIMULATED OPERATIONAL DATA";

export type DataLabel =
  | "REAL PUBLIC DATA" | "REAL GOVERNMENT BASELINE" | "DERIVED MODEL INPUT"
  | "SIMULATED OPERATIONAL DATA" | "MODEL OUTPUT" | "OPERATOR INPUT"
  | "DEMO DATA" | "AI RECOMMENDATION";

export interface Freshness {
  status: string; age_hours: number | null; age_label: string;
  cadence_hours: number | null;
}

export interface Evidence {
  source: string;
  source_type: SourceType;
  timestamp: string;
  confidence: string;
  location: string;
  value: string | number | boolean;
  unit: string;
  influence: string;
  data_label?: DataLabel | null;
}

export interface ZoneInput {
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  demand_lpd: number;
  storage_l: number;
  supply_lpd: number;
  loss_pct: number;
  reserve_l: number;
  tanker_capacity_l: number;
  available_tankers: number;
  refill_minutes: number;
  distance_km: number;
  speed_kph: number;
  unload_minutes: number;
  demand_trend_pct: number;
  supply_trend_pct: number;
  criticality: number;
  observed_anomaly: boolean;
  priority_facilities: string;
  notes: string;
  field_labels?: Record<string, DataLabel>;
  linked_scheme_sl?: number | null;
  tanker_source_name?: string;
  tanker_source_lat?: number | null;
  tanker_source_lon?: number | null;
}
export interface Zone extends ZoneInput {
  id: string;
  version: number;
  provenance: Evidence;
}
export interface Point { day: number; storage_l: number }
export interface Risk {
  score: number;
  level: string;
  label: string;
  factors: Record<string, number>;
  assumptions: string[];
}
export interface ScenarioParameters {
  loss_reduction_pp: number;
  intervention_delay_hours: number;
  trips_per_tanker: number;
  redistribution_l: number;
  donor_zone_id: string | null;
  donor_min_buffer_days: number;
}
export interface Scenario {
  id: string;
  name: string;
  buffer_days: number | null;
  impact_days: number | null;
  projection: Point[];
  resources: string;
  constraints: string[];
  confidence: string;
  feasible: boolean;
  assumptions: string[];
  donor_zone_id: string | null;
  donor_buffer_days: number | null;
}
export interface Recommendation {
  scenario: string;
  title: string;
  reasoning_summary: string;
  expected_impact_days: number | null;
  evidence_count: number;
  confidence: string;
  source: string;
  source_type: SourceType;
  assumptions: string[];
  missing_information: string[];
  recommended_human_verification: string[];
  approval_state: string;
}
export interface Cause {
  id: string; rank: number; kind: "DRIVER" | "CONTEXT"; title: string;
  detail: string; label: DataLabel; evidence: string[];
}
export interface PublicObservation {
  timestamp: string | null; source: string; source_type: string;
  data_label: DataLabel; station_id: string; station_name: string;
  latitude: number; longitude: number; state: string; district: string;
  parameter: string; value: number; unit: string; confidence: string;
  note: string; value_si?: number | null; unit_si?: string | null;
  freshness: Freshness; distance_km?: number;
}
export interface WeatherDetail {
  status: string; provider: string; message?: string;
  temperature_c?: number; precip_mm?: number; humidity_pct?: number;
  wind_kph?: number; condition?: string; observed_at?: string;
  forecast_precip_mm?: number; freshness?: Freshness;
  forecast?: { date: string; max_c: number; min_c: number;
    total_precip_mm: number; chance_of_rain_pct: number; condition: string }[];
}
export interface DataContext {
  notes: string[]; radius_km: number;
  groundwater: {
    status: string; message?: string; lead_basis?: string;
    stations?: PublicObservation[];
    trend?: { status: string; change?: number; span_days?: number; unit?: string };
  };
  scada: {
    status: string; message?: string;
    station?: { station_name: string; distance_km: number };
    latest?: PublicObservation[];
  };
  discharge: {
    status: string; message?: string; distance_km?: number;
    latest?: PublicObservation & { gates_reporting?: number; gates_nonzero?: number };
  };
  supply_baseline: { status: string; linked_scheme?: MidcScheme | null };
}
export interface MidcScheme {
  sl_no: number | null; scheme_id: string | null; scheme: string;
  capacity_mld: number | null; utilisation_mld: number | null;
  industrial_mld: number | null; domestic_mld: number | null;
  utilisation_pct: number | null; spare_capacity_mld: number | null;
  latitude: number | null; longitude: number | null; placement: string;
  data_label: DataLabel; data_quality_notes: string[]; note: string;
}
export interface Analysis {
  workspace?: string;
  causes: Cause[];
  data_context: DataContext | null;
  composition: { field: string; name: string; label: DataLabel;
    value: number }[];
  zone: Zone;
  model: {
    model_version: string;
    gross_withdrawal_lpd: number;
    net_drawdown_lpd: number;
    estimated_loss_lpd: number;
    usable_delivered_l: number;
    storage_only_days: number;
    buffer_days: number | null;
    reserve_l: number;
    confidence: string;
    assumptions: string[];
  };
  risk: Risk;
  clock: {
    days: number | null;
    hours: number | null;
    action_window_hours: number | null;
    label: string;
  };
  diagnosis: {
    primary_driver: string;
    summary: string;
    secondary_signal: string;
  };
  anomalies: {
    id: string; location: string; title: string; confidence: string;
    timestamp: string; source_type: SourceType;
    supporting_signals: string[]; recommended_verification: string;
  }[];
  environment: {
    weather: Evidence; rainfall: Evidence; groundwater: Evidence;
    weather_detail?: WeatherDetail;
    status: string[]; unconnected: string[];
  };
  scenarios: Scenario[];
  evidence: Evidence[];
  validator: { missing_information: string[]; confidence: string };
  recommendation: Recommendation;
  calculated_at: string;
}
export interface Verification {
  before_buffer_days: number | null;
  after_buffer_days: number | null;
  change_days: number | null;
  before_loss_pct: number;
  after_loss_pct: number;
  before_risk: Risk;
  after_risk: Risk;
  expected_buffer_days_at_plan_time: number | null;
  before_anomaly: boolean;
  after_anomaly: boolean;
  simulated: boolean;
  observed_at: string;
  recorded_at: string;
  summary: string;
  provenance: Evidence;
  observation: Zone;
  note: string;
}
export interface ActionRecord {
  id: string;
  zone_id: string;
  zone_version: number;
  status: string;
  scenario: string;
  parameters: ScenarioParameters;
  before: Zone;
  expected: Scenario;
  created_at: string;
  history: { timestamp: string; event: string; note: string }[];
  verification: Verification | null;
}
export interface Health {
  status: string; mode: string; storage: string;
  physical_control: boolean; weather_provider: string;
  bedrock_configured: boolean;
  workspace?: string; workspaces?: string[];
  weather_configured?: boolean; routing_configured?: boolean;
}
export interface MapFeature {
  id: string; kind: "groundwater" | "scada" | "discharge" | "water_supply";
  name: string; latitude: number; longitude: number; data_label: DataLabel;
  headline: { parameter: string; value: number | null; unit: string } | null;
  timestamp: string | null; freshness: Freshness; source: string;
  confidence?: string; district?: string; note?: string; placement?: string;
  capacity_mld?: number | null; utilisation_pct?: number | null;
}
export interface MapData {
  count: number; features: MapFeature[];
  layers: Record<string, { status: string; message?: string }>;
}
export interface RouteEstimate {
  status: string; label: string; provider?: string; message?: string;
  distance_km?: number; duration_min?: number | null; travel_mode?: string;
  straight_line_km?: number; operator_distance_km?: number; traffic?: string;
  geometry?: [number, number][];
  origin?: { name: string; latitude: number; longitude: number };
  destination?: { name: string; latitude: number; longitude: number };
}
export interface TankerResult {
  required_trips: number;
  first_delivery_hours: number;
  cycle_hours: number;
  delivery_capacity_l: number;
  feasible_in_window: boolean;
  estimated_completion_hours: number | null;
  assumptions: string[];
}
export const DEFAULT_PARAMETERS: ScenarioParameters = {
  loss_reduction_pp: 4,
  intervention_delay_hours: 6,
  trips_per_tanker: 3,
  redistribution_l: 100000,
  donor_zone_id: null,
  donor_min_buffer_days: 7
};
