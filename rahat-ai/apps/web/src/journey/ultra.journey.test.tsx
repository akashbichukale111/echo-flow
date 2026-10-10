import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { why } from "./UltraPages";
import { HEAT_COLOR, metricsOf } from "./jtypes";
import type { JRoute } from "./jtypes";
import { Badge, HeatChip, WhatChanged, dist, f, sign } from "./UltraUi";

const seg = { a: 0, b: 1, distance: 200, minutes: 1, load: 3, shade: 0.5, solar_exposure: 1, rate: 3,
  delay_minutes: 0, heat_class: "HIGH" as const, explanation: "", source: "", timestamp: "", confidence: "",
  relief_access: 0, breakdown: {}, nearby_relief: null };
const route = (id: JRoute["id"], over: Partial<JRoute>): JRoute => ({
  id, label: id.toUpperCase(), nodes: [0, 1], segments: [seg], minutes: 7, travel_minutes: 7, distance: 2000,
  load: 20, shade: 0.2, solar_exposure: 1, relief_count: 1, relief_ids: [], detour_minutes: 0, confidence: "",
  same_geometry_as: null, classes: { LOW: 0, MODERATE: 0, ELEVATED: 0, HIGH: 1 }, water_on_route: 0,
  rest_on_route: 0, cooling_on_route: 0, shade_points_on_route: 0, needs_coverage: {},
  corridor: { stages: [], label: "", complete: false }, breakdown: {},
  delta_vs_fastest: { minutes: 0, distance: 0, load: 0, load_pct: 0 }, ...over,
});

describe("formatting", () => {
  it("formats numbers without inventing values", () => {
    expect(f(NaN)).toBe("n/a");
    expect(dist(950)).toBe("950 m");
    expect(dist(2160)).toBe("2.16 km");
    expect(sign(-1.25)).toBe("−1.3");
    expect(sign(0)).toBe("±0.0");
  });
});

describe("data labels", () => {
  it("renders the demo and simulated labels verbatim", () => {
    expect(renderToStaticMarkup(<Badge kind="DEMO DATA" />)).toContain("DEMO DATA");
    expect(renderToStaticMarkup(<Badge kind="SIMULATED JOURNEY" />)).toContain("SIMULATED JOURNEY");
  });
  it("thermal chips use the four documented classes", () => {
    for (const c of ["LOW", "MODERATE", "ELEVATED", "HIGH"] as const) {
      expect(renderToStaticMarkup(<HeatChip cls={c} />)).toContain(HEAT_COLOR[c]);
    }
  });
});

describe("explanations come from engine numbers", () => {
  it("states the real delta and never claims medical outcomes", () => {
    const fast = route("fastest", { load: 21.4, minutes: 7.4, shade: 0.21, relief_count: 1 });
    const rahat = route("rahat", {
      load: 16.9, minutes: 7.8, shade: 0.62, relief_count: 4,
      delta_vs_fastest: { minutes: 0.4, distance: 129, load: -4.5, load_pct: -21 },
    });
    const text = why([fast, rahat], ["WATER"]);
    expect(text).toContain("21% lower");
    expect(text).toContain("+0.4 min");
    expect(text).toContain("62%");
    expect(text).toContain("water");
    expect(text.toLowerCase()).not.toMatch(/heatstroke|dehydrat|body temperature|safe/);
  });
  it("is honest when geometry is identical", () => {
    const fast = route("fastest", {});
    const rahat = route("rahat", { same_geometry_as: "fastest" });
    expect(why([fast, rahat], [])).toContain("also the lowest-exposure");
  });
});

describe("What Changed panel", () => {
  it("shows before, now and the actual difference, and offers a choice", () => {
    const before = metricsOf(route("rahat", { minutes: 7.8, load: 16.9 }));
    const after = metricsOf(route("rahat", { minutes: 8.6, load: 15.1 }));
    const html = renderToStaticMarkup(<WhatChanged
      change={{ reason: "Traffic increased", before, after, geometryChanged: true, apply: () => {} }}
      onDismiss={() => {}} />);
    expect(html).toContain("WHAT CHANGED?");
    expect(html).toContain("Traffic increased");
    expect(html).toContain("+0.8");        // time difference
    expect(html).toContain("−1.8");        // exposure difference
    expect(html).toContain("Take the alternative");
    expect(html).toContain("Keep my current route");
    expect(html).toContain("Nothing is applied until you choose");
  });
});
