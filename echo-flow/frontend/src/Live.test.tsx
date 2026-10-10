import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import App from "./App";
import { CoverageMatrix, Prov } from "./Live";

const coverage = { challenges: [
  { id: 2, challenge: "Floods", system: "ECHO-FLOW", engine: "IMPLEMENTED", data: "SIMULATED", live_context: "", note: "hero" },
  { id: 6, challenge: "Water Leaks", system: "WATERPULSE", engine: "PLANNED", data: "NONE", live_context: "", note: "never claimed" },
] };

function mockFetch(handlers: Record<string, unknown | (() => never)>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const key = Object.keys(handlers).find(k => String(url).includes(k));
    if (!key) return new Response(JSON.stringify({ detail: "nope" }), { status: 404 });
    return new Response(JSON.stringify(handlers[key]), { status: 200 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("provenance + coverage honesty", () => {
  it("renders each provenance label verbatim", () => {
    render(<>{["REAL / PUBLIC", "SIMULATED", "DERIVED", "AI REASONING"].map(l => <Prov key={l} label={l} />)}</>);
    for (const l of ["REAL / PUBLIC", "SIMULATED", "DERIVED", "AI REASONING"]) expect(screen.getByText(l)).toBeInTheDocument();
  });
  it("shows PLANNED for unbuilt challenges", async () => {
    mockFetch({ "/api/coverage": coverage });
    render(<CoverageMatrix />);
    await waitFor(() => expect(screen.getByText("Water Leaks")).toBeInTheDocument());
    expect(screen.getByText("PLANNED")).toBeInTheDocument();
    expect(screen.getByText("IMPLEMENTED")).toBeInTheDocument();
  });
  it("discloses unreachable API instead of faking coverage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    render(<CoverageMatrix />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not reachable/i));
  });
});

describe("routes", () => {
  // No /api/scenarios handler: the backend "scenario load" fails, so the app must say so instead of faking state.
  const h = { "/api/health": { api: "ONLINE", aws: "NOT USED — LOCAL DEVELOPMENT MODE" }, "/api/coverage": coverage,
    "/api/integrations": { integrations: [] } };
  const cases: Array<[string, RegExp]> = [
    ["/", /No scenario loaded/],
    ["/nonsense", /No scenario loaded/],
    ["/echo-flow", /No scenario loaded/],
    ["/echo-flow/audit", /No scenario loaded/],
    ["/rahat", /No scenario loaded/],
    ["/waterpulse", /No scenario loaded/],
  ];
  it.each(cases)("renders %s as the Command Center workspace (no landing page, no standalone sub-products)", async (path, expected) => {
    mockFetch(h);
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/SEVEN CHALLENGES/)).toBeNull();
    expect(screen.queryByText(/RAHAT · Heat Intelligence|WATERPULSE · Water Intelligence/)).toBeNull();
  });
  it("the Command Center reports AWS honestly and never claims ONLINE", async () => {
    mockFetch(h);
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    expect(await screen.findByText(/AWS: NOT USED/)).toBeInTheDocument();
    expect(screen.queryByText(/AWS ONLINE/i)).toBeNull();
  });
  it("Live Evidence lists unbuilt capabilities as PLANNED and never asserts them", async () => {
    mockFetch(h);
    render(<MemoryRouter initialEntries={["/echo-flow/live"]}><App /></MemoryRouter>);
    expect(await screen.findByText("Water Leaks")).toBeInTheDocument();
    expect(screen.getByText("PLANNED")).toBeInTheDocument();
    expect(screen.getByText(/never claimed/)).toBeInTheDocument();
  });
});
