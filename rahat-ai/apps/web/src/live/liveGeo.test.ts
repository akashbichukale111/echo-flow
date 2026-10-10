import { describe, expect, it } from "vitest";
import { distM, kmLabel, snap } from "./liveGeo";

const line: [number, number][] = [[18.5, 73.8], [18.5, 73.81], [18.51, 73.81]];

describe("liveGeo", () => {
  it("measures real distance", () => { expect(distM([18.5, 73.8], [18.5, 73.81])).toBeGreaterThan(1000); });
  it("snaps a point on the route to ~0 m", () => {
    const s = snap(line, { lat: 18.5, lon: 73.805 });
    expect(s.distM).toBeLessThan(2); expect(s.remainM).toBeLessThan(s.totalM);
  });
  it("detects a lateral deviation", () => { expect(snap(line, { lat: 18.5, lon: 73.8 + 0.0 }).distM).toBeLessThan(2);
    expect(snap(line, { lat: 18.505, lon: 73.8 }).distM).toBeGreaterThan(300); });
  it("formats distances", () => { expect(kmLabel(420)).toBe("420 m"); expect(kmLabel(4800)).toBe("4.8 km"); });
});
