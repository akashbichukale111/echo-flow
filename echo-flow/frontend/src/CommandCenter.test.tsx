import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import App from "./App";
import { scenarioFixture } from "./testFixtures";

// Controllable stand-in for MapLibre so map states can be driven without WebGL or the network.
const ml = vi.hoisted(() => ({ handlers: {} as Record<string, (e?: unknown) => void>, throwOnCreate: false }));
vi.mock("maplibre-gl", () => {
  class MapMock {
    constructor() { if (ml.throwOnCreate) throw new Error("webgl unavailable"); ml.handlers = {}; }
    on(ev: string, cb: (e?: unknown) => void) { ml.handlers[ev] = cb; return this; }
    addControl() {} addSource() {} addLayer() {} setLayoutProperty() {} remove() {} fitBounds() {} flyTo() {}
    getSource() { return { setData() {} }; } getLayer() { return {}; } getCenter() { return { lat: 19.07, lng: 72.87 }; }
  }
  class Marker { setLngLat() { return this; } addTo() { return this; } remove() {} }
  class LngLatBounds { extend() { return this; } }
  class NavigationControl {} class ScaleControl {}
  return { default: { Map: MapMock, Marker, LngLatBounds, NavigationControl, ScaleControl } };
});

const SECRET = "v1.public.SECRET-BROWSER-KEY";
let calls: Array<{ url: string; method: string; body: unknown }> = [];
let routeReply: unknown = { status: "NOT_CONNECTED", detail: "x", data: null, limitations: "" };

function ok(data: unknown) { return Promise.resolve({ ok: true, status: 200, json: async () => data }); }

beforeEach(() => {
  calls = [];
  ml.throwOnCreate = false;
  vi.stubEnv("VITE_AMAZON_LOCATION_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url.endsWith("/api/health")) return ok({ api: "ONLINE", aws: "NOT USED — LOCAL DEVELOPMENT MODE" });
    if (url.endsWith("/api/scenarios")) return ok(scenarioFixture());
    if (url.endsWith("/decision")) return ok(scenarioFixture(true));
    if (url.endsWith("/api/route")) return ok(routeReply);
    return ok({});
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function Probe() { return <output data-testid="path">{useLocation().pathname}</output>; }
function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /><Probe /></MemoryRouter>);
}

describe("application entry", () => {
  it("opens the real Command Center at / with no landing page", async () => {
    mount("/");
    expect(await screen.findByText("FLOOD_HERO_SCENARIO")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/echo-flow/command");
    expect(screen.queryByText(/ONE ENVIRONMENT/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /ENTER ECHO-FLOW/i })).toBeNull();
    expect(screen.getByText("SIMULATION MODE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Command Center" })).toBeInTheDocument();
    expect(calls.filter(c => c.url.endsWith("/api/scenarios") && c.method === "POST")).toHaveLength(1);
  });

  it.each(["/echo-flow", "/echo-flow/command"])("renders the same Command Center at %s", async path => {
    mount(path);
    expect(await screen.findByText("FLOOD_HERO_SCENARIO")).toBeInTheDocument();
    expect(screen.getByLabelText("Operations map")).toBeInTheDocument();
  });

  it.each(["/rahat", "/waterpulse"])("does not present %s as a standalone product", async path => {
    mount(path);
    await screen.findByText("FLOOD_HERO_SCENARIO");
    expect(screen.getByTestId("path")).toHaveTextContent("/echo-flow/command");
    expect(screen.queryByText(/RAHAT|WATERPULSE/)).toBeNull();
  });

  it("keeps the internal screens reachable", async () => {
    mount("/");
    await screen.findByText("FLOOD_HERO_SCENARIO");
    for (const name of ["Find Options", "Simulation", "Counterfactuals", "Red Team", "Safety Gate", "Human Decision", "Live Evidence", "Audit"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });
});

describe("decision workflow through the map workspace", () => {
  it("runs the backend decision and shows its returned comparison", async () => {
    mount("/");
    await screen.findByText("FLOOD_HERO_SCENARIO");
    fireEvent.click(screen.getByRole("button", { name: "RUN DECISION" }));
    expect(await screen.findAllByText(/PLAN C · BUFFER \+ PUMP/)).not.toHaveLength(0);
    expect(calls.some(c => c.url.endsWith("/scenarios/sc1/decision") && c.method === "POST")).toBe(true);
    expect(screen.getByText(/Blocked by the safety gate/)).toBeInTheDocument();
  });

  it("a selected entity proposes an intervention that runs the real backend workflow", async () => {
    ml.throwOnCreate = true;
    mount("/");
    await screen.findByText("FLOOD_HERO_SCENARIO");
    fireEvent.click(await screen.findByRole("button", { name: /B6/ }));
    fireEvent.click(await screen.findByRole("button", { name: "SIMULATE WITH B6 BUFFER" }));
    await waitFor(() => expect(calls.some(c => c.url.endsWith("/decision"))).toBe(true));
    const post = calls.find(c => c.url.endsWith("/decision"))!;
    expect((post.body as { intervention: { buffer: string } }).intervention.buffer).toBe("B6");
  });
});

describe("map with a configured key", () => {
  beforeEach(() => vi.stubEnv("VITE_AMAZON_LOCATION_API_KEY", SECRET));

  it("shows a clear authorization failure and never leaks the key", async () => {
    const { container } = mount("/");
    await screen.findByText("FLOOD_HERO_SCENARIO");
    await waitFor(() => expect(ml.handlers.error).toBeDefined());
    act(() => ml.handlers.error({ error: { status: 403, message: `Forbidden ${SECRET}` } }));
    expect(await screen.findByText("GEOGRAPHIC MAP FAILED TO LOAD")).toBeInTheDocument();
    
    expect(screen.getByRole("button", { name: "RETRY MAP" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("falls back with a message when the map cannot be created", async () => {
    ml.throwOnCreate = true;
    mount("/");
    expect(await screen.findByText("GEOGRAPHIC MAP FAILED TO LOAD")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Synthetic system dependency graph/ })).toBeInTheDocument();
  });

  it("claims the map is loaded only after the map's load event", async () => {
    mount("/");
    await screen.findByText("FLOOD_HERO_SCENARIO");
    expect(screen.queryByText(/MAP LOADED/)).toBeNull();
    await waitFor(() => expect(ml.handlers.load).toBeDefined());
    act(() => ml.handlers.load());
    expect(await screen.findByText("MAP LOADED · AMAZON LOCATION")).toBeInTheDocument();
    expect(screen.getByText("Synthetic demo scenario is not placed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PLACE AT MAP CENTRE" }));
    await waitFor(() => expect(screen.queryByText("Synthetic demo scenario is not placed")).toBeNull());
    expect(screen.getByText(/Demo anchor/)).toBeInTheDocument();
  });

  async function pickRoutePoints() {
    mount("/");
    await screen.findByText("FLOOD_HERO_SCENARIO");
    await waitFor(() => expect(ml.handlers.load).toBeDefined());
    act(() => ml.handlers.load());
    await screen.findByText("MAP LOADED · AMAZON LOCATION");
    fireEvent.click(screen.getByRole("button", { name: "SET ORIGIN" }));
    act(() => ml.handlers.click({ lngLat: { lng: 72.8, lat: 19.0 } }));
    fireEvent.click(screen.getByRole("button", { name: "SET DESTINATION" }));
    act(() => ml.handlers.click({ lngLat: { lng: 72.9, lat: 19.1 } }));
    fireEvent.click(screen.getByRole("button", { name: "CALCULATE ROUTE" }));
  }

  it("never reports a route when the routing call failed", async () => {
    routeReply = { status: "UNAVAILABLE", detail: "Authorization failed (HTTP 403): the key must allow geo:CalculateRoute",
      data: null, limitations: "" };
    await pickRoutePoints();
    expect(await screen.findByText("ROUTE NOT CALCULATED")).toBeInTheDocument();
    expect(screen.getByText(/geo:CalculateRoute/)).toBeInTheDocument();
    expect(screen.queryByText(/CALCULATED ROUTE · AMAZON LOCATION/)).toBeNull();
    const post = calls.find(c => c.url.endsWith("/api/route"))!;
    expect(post.body).toMatchObject({ origin: [72.8, 19.0], destination: [72.9, 19.1], travel_mode: "Car" });
  });

  it("labels a calculated route as such only when the service returned one", async () => {
    routeReply = { status: "LIVE", provenance: "DERIVED", detail: "", limitations: "Does not know about flooding.",
      data: { distance_km: 18.4, duration_min: 25, travel_mode: "Car", geometry: [[72.8, 19], [72.9, 19.1]] } };
    await pickRoutePoints();
    expect(await screen.findByText("CALCULATED ROUTE · AMAZON LOCATION")).toBeInTheDocument();
    expect(screen.getByText(/18.4 km · 25 min/)).toBeInTheDocument();
    expect(screen.queryByText("ROUTE NOT CALCULATED")).toBeNull();
  });
});
