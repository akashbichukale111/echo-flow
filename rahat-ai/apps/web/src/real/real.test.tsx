import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { gpsErrorMessage, moved, toFix, getFix } from "./gps";
import { fitView, pathOf } from "./projection";
import { sunAt } from "./sun";
import RealJourneyPage from "./RealJourneyPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("gps", () => {
  it("normalizes a browser position and drops non-finite speed/heading", () => {
    const f = toFix({ coords: { latitude: 28.6, longitude: 77.2, accuracy: 12, speed: NaN, heading: null }, timestamp: 5 });
    expect(f).toEqual({ lat: 28.6, lon: 77.2, accuracy: 12, speed: null, heading: null, timestamp: 5 });
  });
  it("explains permission denial and points to demo mode, not fake GPS", () => {
    expect(gpsErrorMessage(1)).toMatch(/demo/i);
    expect(gpsErrorMessage(undefined)).toMatch(/unavailable/i);
  });
  it("measures movement in metres", () => {
    expect(moved({ lat: 28.6, lon: 77.2 }, { lat: 28.601, lon: 77.2 })).toBeGreaterThan(100);
    expect(moved({ lat: 28.6, lon: 77.2 }, { lat: 28.6, lon: 77.2 })).toBe(0);
  });
  it("rejects with a clear message when geolocation is missing", async () => {
    vi.stubGlobal("navigator", {});
    await expect(getFix()).rejects.toThrow(/unavailable/i);
  });
});

describe("sun", () => {
  it("is high at Delhi noon in June and below horizon at midnight (compass azimuth 0-360)", () => {
    const noon = sunAt(28.61, 77.21, new Date("2026-06-01T06:30:00Z"));
    expect(noon.altitudeDeg).toBeGreaterThan(60);
    expect(noon.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(noon.azimuthDeg).toBeLessThan(360);
    expect(sunAt(28.61, 77.21, new Date("2026-06-01T18:30:00Z")).altitudeDeg).toBeLessThan(0);
  });
});

describe("projection", () => {
  it("keeps all points inside the box with north up", () => {
    const v = fitView([{ lat: 28.6, lon: 77.2 }, { lat: 28.7, lon: 77.3 }], 600, 400, 20);
    const [x1, y1] = v.project(28.6, 77.2), [x2, y2] = v.project(28.7, 77.3);
    for (const n of [x1, x2]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(600);
    }
    expect(y2).toBeLessThan(y1);
    expect(pathOf(v, [[28.6, 77.2], [28.7, 77.3]])).toMatch(/^M[\d.]+,[\d.]+L/);
  });
});

const analysis = (mode: string) => ({
  ok: true, dataMode: mode, disclaimer: "Estimated environmental thermal exposure. Not medical advice.",
  weather: { temperatureC: 39, feelsLikeC: 44, humidityPct: 30, windKph: 5, uvIndex: 9, cloudPct: 5, precipitationMm: 0,
    visibilityKm: 5, condition: "Sunny", observedAt: null, source: mode === "REAL DATA" ? "WeatherAPI" : "Demo weather fallback",
    sourceType: mode === "REAL DATA" ? "PUBLIC_API" : "DEMO_DATA", freshness: "LIVE" },
  sun: { elevation: 60, azimuth: 180, source: "SunCalc" }, relief: [], generatedAt: "",
  evidence: { route: { key: "route", source: "Demo route fallback", sourceType: "DEMO_DATA", badge: "DEMO DATA", confidence: "LOW",
    observedAt: null, freshness: "UNKNOWN", limitations: "Synthetic geometry." },
  surfaceTemperature: { key: "surfaceTemperature", source: "Landsat", sourceType: "PUBLIC_API", badge: "PUBLIC DATA", confidence: "LOW",
    observedAt: null, freshness: "UNKNOWN", limitations: "x" } },
  routes: (["fastest", "balanced", "rahat"] as const).map((id, i) => ({
    id, label: id.toUpperCase(), minutes: 30 + i * 3, distanceM: 5000 + i * 300, thermalLoad: 90 - i * 25, avgRate: 2, heatContext: "MODERATE",
    estimatedShade: 0.2 + i * 0.2, shadeConfidence: "LOW", buildingCount: 0, providerRouteId: `r${i}`, source: "Demo route fallback",
    sourceType: "DEMO_DATA", sameAs: [], headline: id === "rahat" ? "LOWER ESTIMATED THERMAL LOAD" : null, reliefNear: [], reliefCount: 0,
    components: {}, deltaVsFastest: { minutes: i * 3, thermalLoadPct: -27 * i, shadePts: 20 * i, detourPct: 6 * i },
    why: { increasedBy: ["low estimated shade"], reducedBy: [] },
    coords: [[28.6315, 77.2167], [28.62, 77.22], [28.6129, 77.2295]],
    segments: [{ start: [28.6315, 77.2167], end: [28.62, 77.22], lengthM: 100, minutes: 1, shade: 0.2, rate: 2, load: 2, class: "MODERATE" }] })),
});

function mockFetch(mode: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.includes("/real/status") ? { mode: mode === "REAL DATA" ? "REAL" : "DEMO", demoFallback: true, providers: {} }
      : url.includes("/real/search") ? { items: [{ id: null, name: "India Gate", label: "India Gate, Delhi", lat: 28.6129, lon: 77.2295, source: "Demo place fallback", sourceType: "DEMO_DATA" }], evidence: {} }
      : url.includes("/real/analyze") ? analysis(mode)
      : url.includes("/real/explain") ? { text: "RAHAT shows lower estimated thermal load. These are model estimates, not medical advice.", source: "DETERMINISTIC EXPLANATION" }
      : {};
    return { ok: true, status: 200, json: async () => body };
  }));
}

describe("RealJourneyPage", () => {
  it("does not request GPS until the user clicks, and denial falls back to a labelled demo start", async () => {
    mockFetch("DEMO DATA");
    const get = vi.fn((_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: get, watchPosition: vi.fn(), clearWatch: vi.fn() } });
    render(<RealJourneyPage />);
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Allow location/i));
    await waitFor(() => expect(screen.getByText(/permission was denied/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Use demo start/i));
    expect(screen.getByText("DEMO START")).toBeTruthy();
  });

  it("shows FASTEST/BALANCED/RAHAT, DEMO DATA labels and never claims medical safety", async () => {
    mockFetch("DEMO DATA");
    vi.stubGlobal("navigator", { geolocation: undefined });
    render(<RealJourneyPage />);
    fireEvent.click(screen.getByText(/Use demo start/i));
    fireEvent.change(await screen.findByPlaceholderText(/Search a place/i), { target: { value: "India" } });
    fireEvent.click(await screen.findByText("India Gate", {}, { timeout: 3000 }));
    expect(await screen.findByText("LOWER ESTIMATED THERMAL LOAD", {}, { timeout: 3000 })).toBeTruthy();
    for (const l of ["FASTEST", "BALANCED", "RAHAT"]) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getAllByText("DEMO DATA").length).toBeGreaterThan(0);
    expect(screen.getByText("DEMO DATA", { selector: ".rj-mode" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/medically safe|guaranteed shade|heatstroke/i);
  });
});
