export interface Intervention {
  pump: number;
  gate_open: boolean;
  road_closed: boolean;
  buffer: "B5" | "B6" | null;
  clear_drain: boolean;
  noncritical_shed: number;
  priority_power: boolean;
}

export interface GraphNode { id: string; kind: string; x: number; y: number; population: number }
export interface GraphEdge { source: string; target: string; kind: string; minutes: number }
export interface SystemGraph { coordinate_system: string; nodes: GraphNode[]; edges: GraphEdge[] }
export interface Echo { source: string; target: string; value: number | null; label: string; unit: string }
export interface Check { name: string; pass: boolean; detail?: string }

export interface Simulation {
  accepted: boolean;
  metrics: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  echoes: Echo[];
  trace: Record<string, unknown>[];
  checks: Check[];
  consequence_council: Record<string, unknown>;
}

export interface Run {
  id: string;
  created_at: string;
  state_revision: number;
  knowledge_revision: number;
  selected_plan: string;
  intervention: Intervention;
  simulation: Simulation;
  plans: Record<string, Simulation>;
  options: Array<{
    id: string; distance_m: number; capacity_m3: number; exposure: string;
    status: string; range: string; checks: Check[]; precheck_pass: boolean;
  }>;
  robustness: Record<string, { acceptable: number; total: number; fraction: number; mean_loss: number }>;
  safety: { allowed: boolean; checks: Check[] };
  agents: Array<{
    agent_id: string; status: string; provider: string; reasoning_summary: string;
    evidence: unknown[]; timestamp: string;
  }>;
  red_team: unknown;
  voi: unknown;
  model_doubt: unknown;
  recovery: unknown;
  chronos: unknown;
  minimum_intervention: unknown;
  breakpoint: unknown;
  linchpins: unknown;
  no_feasible_buffer: boolean;
  aws_execution_id: string | null;
  executed?: boolean;
  rejected?: boolean;
}

export interface Scenario {
  id: string;
  version: number;
  state_revision: number;
  knowledge_revision: number;
  created_at: string;
  decision_window_seconds: number;
  metadata: { name: string; source_type: string; confidence: string };
  state: Record<string, unknown> & { mode: "flood" | "heat" };
  graph: SystemGraph;
  run: Run | null;
  approval: { run_id: string } | null;
  unknown: { name: string; verified: boolean; low: number; high: number };
  audit: Array<{ id: string; timestamp: string; name: string; source: string; data_reference: string; data: unknown }>;
  learning: unknown[];
  action_result?: unknown;
  live_inputs?: Record<string, { label: string; inputs: string; source: string; fetched_at: string; mm_per_hour: number }>;
}

export type Provenance = "REAL / PUBLIC" | "SIMULATED" | "DERIVED" | "AI REASONING";
export interface ProviderResult {
  provider: string; status: "LIVE" | "NOT_CONNECTED" | "UNAVAILABLE" | "ERROR";
  provenance: string; purpose: string; detail: string; data: unknown; source_url: string;
  fetched_at: string; latency_ms: number; cached: boolean; limitations: string;
}
export interface LiveContext { lat: number; lon: number; fetched_at: string; providers: Record<string, ProviderResult> }
export interface Challenge { id: number; challenge: string; system: string; engine: string; data: string; live_context: string; note: string }
export interface AuditReport { valid: boolean; events: number; broken_at_seq: number | null; reason: string; head_hash: string | null; sink?: string; sink_events?: number | null; sink_consistent?: boolean }

export type RoutePhase = "IDLE" | "PENDING" | "LIVE" | "FAILED";
export interface RouteState {
  phase: RoutePhase;
  origin: [number, number] | null;
  destination: [number, number] | null;
  result: ProviderResult | null;
  message: string;
}
export type PickMode = "none" | "anchor" | "origin" | "destination";
export type MapPhase = "NOT_CONFIGURED" | "LOADING" | "READY" | "FAILED";
