import { describe, expect, it } from "vitest";
import { describeMapFailure, readMapConfig, withKey } from "./mapConfig";
import { offsetToLngLat, parseAnchor } from "./geo";

describe("map configuration", () => {
  it("always returns READY for OSM", () => {
    const c = readMapConfig();
    expect(c.status).toBe("READY");
    expect(c.mapName).toBe("OpenStreetMap");
  });

  it("adds no key for OSM requests", () => {
    const c = readMapConfig();
    expect(withKey("https://tile.openstreetmap.org/1/2/3.png", c)).toBeUndefined();
  });

  it("explains authorization failures generically", () => {
    const c = readMapConfig();
    const msg = describeMapFailure(403, c);
    expect(msg).toContain("OpenStreetMap");
  });
});

describe("synthetic anchoring", () => {
  it("treats positions as metre offsets, never as degrees", () => {
    const [lon, lat] = offsetToLngLat({ lat: 0, lon: 0 }, 1000, 1000);
    expect(lat).toBeCloseTo(0.00898, 4);
    expect(lon).toBeCloseTo(0.00898, 4);
    expect(offsetToLngLat({ lat: 19, lon: 72 }, 0, 0)).toEqual([72, 19]);
  });
  it("parses and validates an anchor", () => {
    expect(parseAnchor("19.1, 72.9")).toEqual({ lat: 19.1, lon: 72.9 });
    expect(parseAnchor("200,0")).toBeNull();
    expect(parseAnchor("abc")).toBeNull();
    expect(parseAnchor(undefined)).toBeNull();
  });
});

