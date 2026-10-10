import type { Scenario } from "./types";

const sim = (depthA: number, accepted = true) => ({
  accepted,
  metrics: { zone_a_depth_m: depthA, zone_b_depth_m: 0, affected_population: 1200 },
  before: { a_m3: 8000, b_m3: 800 }, after: { a_m3: 6200, b_m3: 800 },
  echoes: [], trace: [], checks: [], consequence_council: {}
});

export const graph = {
  coordinate_system: "synthetic local Cartesian metres; not a real map",
  nodes: [
    { id: "A", kind: "zone", x: 0, y: 0, population: 2800 },
    { id: "B", kind: "zone", x: 800, y: 600, population: 1600 },
    { id: "P1", kind: "pump", x: 200, y: 100, population: 0 },
    { id: "B6", kind: "buffer", x: 1400, y: -400, population: 0 },
    { id: "R7", kind: "road", x: 900, y: 500, population: 0 },
    { id: "H1", kind: "hospital", x: 1200, y: 0, population: 0 }
  ],
  edges: [
    { source: "P1", target: "A", kind: "dependency", minutes: 0 },
    { source: "H1", target: "R7", kind: "route", minutes: 6 }
  ]
};

export function scenarioFixture(withRun = false): Scenario {
  const intervention = { pump: 0.6, gate_open: false, road_closed: false, buffer: "B6" as const,
    clear_drain: false, noncritical_shed: 0, priority_power: false };
  return {
    id: "sc1", version: 1, state_revision: 0, knowledge_revision: 0, created_at: new Date().toISOString(),
    decision_window_seconds: 900,
    metadata: { name: "FLOOD_HERO_SCENARIO", source_type: "synthetic", confidence: "demo" },
    state: { mode: "flood", a_m3: 8000 }, graph,
    run: withRun ? {
      id: "run1", created_at: new Date().toISOString(), state_revision: 0, knowledge_revision: 0,
      selected_plan: "PLAN C · BUFFER + PUMP", intervention, simulation: sim(0.42),
      plans: { "PLAN 0 · NO ACTION": sim(0.9, false), "PLAN C · BUFFER + PUMP": sim(0.42) },
      options: [{ id: "B6", distance_m: 1500, capacity_m3: 8500, exposure: "LOW", status: "PASS", range: "ok",
        checks: [{ name: "Legal", pass: true }], precheck_pass: true }],
      robustness: { "PLAN 0 · NO ACTION": { acceptable: 2, total: 20, fraction: .1, mean_loss: 5 },
        "PLAN C · BUFFER + PUMP": { acceptable: 15, total: 20, fraction: .75, mean_loss: 1 } },
      safety: { allowed: false, checks: [{ name: "Synthetic measurement verified", pass: false, detail: "unverified" }] },
      agents: [], red_team: {}, voi: {}, model_doubt: {}, recovery: {}, chronos: {}, minimum_intervention: {},
      breakpoint: {}, linchpins: {}, no_feasible_buffer: false, aws_execution_id: null
    } : null,
    approval: null, unknown: { name: "C12 capacity", verified: false, low: 0.4, high: 0.9 },
    audit: [], learning: []
  } as unknown as Scenario;
}
