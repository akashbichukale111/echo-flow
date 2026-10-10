import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mapStats = vi.hoisted(() => ({ removed: 0, created: 0 }));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() { mapStats.created += 1; }
    on(ev: string, a: unknown) { if (ev === "load" && typeof a === "function") queueMicrotask(() => (a as () => void)()); return this; }
    addSource() { return this; } addLayer() { return this; }
    getSource() { return { setData: () => undefined }; }
    remove() { mapStats.removed += 1; }
    easeTo() { return this; } zoomIn() { return this; } zoomOut() { return this; } fitBounds() { return this; }
    getZoom() { return 10; } getCanvas() { return { style: {} }; } queryRenderedFeatures() { return []; }
  }
  class FakeMarker { setLngLat() { return this; } addTo() { return this; } remove() { return this; } }
  class FakePopup { setLngLat() { return this; } setDOMContent() { return this; } addTo() { return this; } }
  class FakeBounds { extend() { return this; } }
  return { default: { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, LngLatBounds: FakeBounds } };
});

import RealLiveMapPage from "./RealLiveMapPage";

const weather = { temperatureC: 39, feelsLikeC: 41, humidityPct: 30, windKph: 5, uvIndex: 9, cloudPct: 5, precipitationMm: 0, visibilityKm: 5,
  condition: "Sunny", observedAt: null, source: "WeatherAPI", sourceType: "PUBLIC_API", freshness: "LIVE" };
const place = (name: string, sourceType = "PUBLIC_API") => ({ id: name, name, label: `${name}, Pune`, lat: 18.52, lon: 73.86, source: "Amazon Location", sourceType });

interface Net { search: () => Response | Promise<Response>; analyze: () => Response | Promise<Response>; calls: string[] }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let net: Net;

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    net.calls.push(url);
    if (url.includes("/api/live/map/style")) return new Response('{"version":8,"sources":{},"layers":[]}');
    if (url.includes("/api/real/weather")) return json({ weather });
    if (url.includes("/api/live/relief")) return json({ items: [], available: true });
    if (url.includes("/api/real/search")) return net.search();
    if (url.includes("/api/real/analyze")) return net.analyze();
    return json({ detail: "not found" }, 404);
  }));
}

interface Geo { mode: "ok" | "denied"; clearWatch: ReturnType<typeof vi.fn>; watches: number }
function stubGeo(mode: Geo["mode"]): Geo {
  const geo: Geo = { mode, clearWatch: vi.fn(), watches: 0 };
  const pos = () => ({ coords: { latitude: 18.5, longitude: 73.9, accuracy: 12, speed: null, heading: null }, timestamp: Date.now() });
  vi.stubGlobal("navigator", { geolocation: {
    getCurrentPosition: (ok: (p: unknown) => void, err: (e: { code: number }) => void) => (geo.mode === "ok" ? ok(pos()) : err({ code: 1 })),
    watchPosition: (ok: (p: unknown) => void, err: (e: { code: number }) => void) => { geo.watches += 1; if (geo.mode === "ok") ok(pos()); else err({ code: 1 }); return geo.watches; },
    clearWatch: geo.clearWatch,
  } });
  return geo;
}

const renderPage = () => render(<MemoryRouter><RealLiveMapPage /></MemoryRouter>);
const box = () => screen.getByRole("combobox", { name: /search destination/i }) as HTMLInputElement;

beforeEach(() => {
  mapStats.removed = 0; mapStats.created = 0;
  net = { calls: [], search: () => json({ items: [place("AIIMS Pune"), place("Aundh Park")], evidence: {} }), analyze: () => json({ ok: false, routes: [] }) };
  stubFetch();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("RAHAT LIVE first screen", () => {
  it("asks the user where they want to go and offers the search box", async () => {
    stubGeo("ok"); renderPage();
    expect(screen.getByRole("heading", { name: "WHERE DO YOU WANT TO GO?" })).toBeTruthy();
    expect(box().placeholder).toBe("Where do you want to go?");
    expect(screen.getByText(/use your live location to find a cooler route/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Locate me" }).getAttribute("title")).toBe("Locate me");
    expect(screen.getByRole("button", { name: "Zoom in" }).getAttribute("title")).toBe("Zoom in");
    expect(screen.getByRole("button", { name: "Map layers" })).toBeTruthy();
  });
});

describe("GPS", () => {
  it("shows the real accuracy once live and never invents one", async () => {
    stubGeo("ok"); renderPage();
    await waitFor(() => expect(document.body.textContent).toMatch(/YOU ARE HERE/));
    await waitFor(() => expect(document.body.textContent).toMatch(/LIVE · GPS ±12 m/), { timeout: 3000 });
  });

  it("explains a denied permission kindly and offers TRY AGAIN and ENTER LOCATION MANUALLY", async () => {
    stubGeo("denied"); renderPage();
    await screen.findByText("Couldn't access your location.");
    expect(screen.getByText(/Location access is needed for Live GPS navigation\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "TRY AGAIN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ENTER LOCATION MANUALLY" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/LIVE · GPS/);
    expect(document.body.textContent).not.toMatch(/demo/i);
  });

  it("manual mode asks for a start point instead of pretending to have GPS", async () => {
    stubGeo("denied"); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "ENTER LOCATION MANUALLY" }));
    expect(box().placeholder).toBe("Enter your starting location");
    fireEvent.change(box(), { target: { value: "Aundh" } });
    fireEvent.click(await screen.findByText("Aundh Park"));
    await waitFor(() => expect(document.body.textContent).toMatch(/MANUAL START · NOT LIVE GPS/));
    expect(document.body.textContent).not.toMatch(/LIVE · GPS/);
  });

  it("stops the GPS watcher and destroys the map on unmount", async () => {
    const geo = stubGeo("ok"); const { unmount } = renderPage();
    await waitFor(() => expect(mapStats.created).toBeGreaterThan(0));
    unmount();
    expect(geo.clearWatch).toHaveBeenCalled();
    expect(mapStats.removed).toBeGreaterThan(0);
  });
});

describe("search", () => {
  it("debounces typing: one request for a burst of keystrokes", async () => {
    stubGeo("ok"); renderPage();
    for (const v of ["a", "ai", "aii", "aiim", "aiims"]) fireEvent.change(box(), { target: { value: v } });
    await screen.findByText("AIIMS Pune");
    expect(net.calls.filter(u => u.includes("/api/real/search")).length).toBe(1);
  });

  it("supports ArrowDown highlight, Escape to close, and Enter to choose", async () => {
    stubGeo("ok"); renderPage();
    fireEvent.change(box(), { target: { value: "aiims" } });
    await screen.findByText("AIIMS Pune");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    expect(box().getAttribute("aria-activedescendant")).toBe("lv-opt-0");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(net.calls.some(u => u.includes("/api/real/analyze"))).toBe(true));
    expect(box().value).toBe("AIIMS Pune");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("uses the friendly route failure message and never falls back to demo data", async () => {
    stubGeo("ok"); renderPage();
    fireEvent.change(box(), { target: { value: "aiims" } });
    await screen.findByText("AIIMS Pune");
    fireEvent.click(screen.getByText("AIIMS Pune"));
    await screen.findByText("Couldn't calculate a route.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/India Gate|Connaught|DEMO/);
  });

  it("shows 'No places found.' for an empty result", async () => {
    stubGeo("ok"); net.search = () => json({ items: [], evidence: {} }); renderPage();
    fireEvent.change(box(), { target: { value: "zzzzzz" } });
    await screen.findByText("No places found.");
  });

  it("shows a friendly failure with Retry when search errors", async () => {
    stubGeo("ok"); net.search = () => json({ detail: "boom" }, 502); renderPage();
    fireEvent.change(box(), { target: { value: "aiims" } });
    await screen.findByText(/Couldn't find places right now\./);
    expect(document.body.textContent).not.toMatch(/boom|Request failed/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
  });

  it("refuses to show demo-only search results as real places", async () => {
    stubGeo("ok"); net.search = () => json({ items: [place("India Gate", "DEMO_DATA")], evidence: {} }); renderPage();
    fireEvent.change(box(), { target: { value: "india" } });
    await screen.findByText(/Couldn't find places right now\./);
    expect(screen.queryByText("India Gate")).toBeNull();
  });
});
