import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const stub = (name: string) => () => <h1>{name}</h1>;
vi.mock("../overview/OverviewPage", () => ({ default: stub("page:overview") }));
vi.mock("./pages", () => ({
  StartPage: stub("page:start"), ChoicePage: stub("page:choice"), RoutePage: stub("page:route"),
  ThermalPage: stub("page:thermal"), ExposurePage: stub("page:exposure"), ReliefPage: stub("page:relief"),
  ComparePage: stub("page:compare"), LivePage: stub("page:live"), ScenarioPage: stub("page:scenario"),
  CommunityPage: stub("page:community"), EvidencePage: stub("page:evidence"), SettingsPage: stub("page:settings"),
  NeedDialog: stub("page:need"),
}));

import { JourneyRoutes, LEGACY_REDIRECTS } from "./JourneyApp";

// Mounted exactly like main.tsx mounts it: a catch-all parent with absolute child paths.
const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/*" element={<JourneyRoutes />} /></Routes>
  </MemoryRouter>);

afterEach(cleanup);

describe("unified routing", () => {
  const direct: [string, string][] = [
    ["/", "overview"], ["/journey/start", "start"], ["/journey/route", "route"],
    ["/journey/thermal", "thermal"], ["/journey/exposure", "exposure"], ["/journey/relief", "relief"],
    ["/journey/compare", "compare"], ["/journey/live", "live"], ["/journey/scenario", "scenario"],
    ["/journey/community", "community"], ["/journey/evidence", "evidence"], ["/journey/settings", "settings"],
  ];
  it.each(direct)("opens %s directly", async (path, name) => {
    at(path);
    expect(await screen.findByText(`page:${name}`)).toBeTruthy();
  });

  it.each(Object.entries(LEGACY_REDIRECTS))("redirects retired URL %s -> %s", async (from, to) => {
    at(from);
    const name = to.split("/").pop()!;
    expect(await screen.findByText(`page:${name}`)).toBeTruthy();
  });

  it("shows a recoverable 404 for unknown URLs", async () => {
    at("/nope");
    expect(await screen.findByText("That page does not exist")).toBeTruthy();
  });
});
