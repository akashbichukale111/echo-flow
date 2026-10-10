import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

vi.mock("../OperationalMap", () => ({
  default: () => <div data-testid="map">map</div>
}));

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe("PILOT workspace (public datasets) against the live API", () => {
  beforeEach(() => {
    localStorage.setItem("waterpulse-workspace", "pilot");
    localStorage.removeItem("waterpulse-zone");
  });
  afterEach(() => localStorage.clear());

  it("tells the whole product story on the control room", async () => {
    mount("/control-room");
    await screen.findByText(/MODEL RISK ESTIMATE/, {}, { timeout: 10000 });
    for (const heading of ["Why is this happening?", "What can we do?",
      "Recommended action", "Did it work?"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText(/Water Shortage Prevention OS/)).toBeInTheDocument();
    expect(screen.getAllByText(/Action window/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MODEL ESTIMATE/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/REAL GOVERNMENT BASELINE/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SIMULATED OPERATIONAL DATA/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Municipal live demand and NRW telemetry are not connected/))
      .toBeInTheDocument();
  });

  it("never shows a LIVE or REAL-TIME claim", async () => {
    mount("/control-room");
    await screen.findByText(/MODEL RISK ESTIMATE/, {}, { timeout: 10000 });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bLIVE\b(?! (demand|NRW|tanker|traffic|municipal))/);
    expect(text).not.toMatch(/REAL-TIME/i);
  });

  it("shows unavailable weather instead of demo weather", async () => {
    mount("/control-room");
    await screen.findByText(/MODEL RISK ESTIMATE/, {}, { timeout: 10000 });
    expect(screen.getByText("DATA UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText("Demonstration weather")).toBeNull();
  });

  it("evidence page lists nearby real telemetry with freshness", async () => {
    mount("/evidence");
    await screen.findByText("Real public data near this zone", {}, { timeout: 10000 });
    expect(screen.getAllByText(/NWDP/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/STALE DATA/).length).toBeGreaterThan(0);
    expect(screen.getByText("MIDC supply schemes (baseline)")).toBeInTheDocument();
  });

  it("switching to the delhi zone shows real groundwater context", async () => {
    mount("/control-room");
    await screen.findByText(/MODEL RISK ESTIMATE/, {}, { timeout: 10000 });
    const select = screen.getAllByRole("combobox")
      .find(el => within(el).queryByText(/Delhi/)) as HTMLSelectElement;
    await userEvent.selectOptions(select, "pilot-delhi-nw");
    await waitFor(() => expect(screen.getByRole("region", { name: "Groundwater" }))
      .toHaveTextContent(/DSIIDC/), { timeout: 10000 });
    expect(screen.getByRole("region", { name: "Groundwater" }))
      .toHaveTextContent(/REAL PUBLIC DATA/);
  });

  it("settings lists the four public datasets", async () => {
    mount("/settings");
    await screen.findByText("Public datasets", {}, { timeout: 10000 });
    expect(screen.getByText("Delhi groundwater")).toBeInTheDocument();
    expect(screen.getByText("MIDC water supply schemes")).toBeInTheDocument();
    expect(await screen.findByText(/not necessarily live municipal telemetry/))
      .toBeInTheDocument();
  });

  it("workspace switch toggles to demo data", async () => {
    mount("/control-room");
    await screen.findByText(/MODEL RISK ESTIMATE/, {}, { timeout: 10000 });
    await userEvent.selectOptions(screen.getByLabelText("Data workspace"), "demo");
    await screen.findByText(/DEMO workspace: every value is synthetic/, {}, { timeout: 10000 });
  });
});
