import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../App";

// WebGL is unavailable in jsdom; the map has its own SVG fallback in-browser.
vi.mock("../OperationalMap", () => ({
  default: () => <div data-testid="map">map</div>
}));

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

const ROUTES = [
  "control-room", "water-buffer", "shortage-clock", "diagnosis",
  "loss-anomalies", "what-if", "tanker-intelligence", "zone-map",
  "action-center", "verification", "evidence", "zone-configuration", "settings"
];

describe("WATERPULSE UI against the live demo API", () => {
  it.each(ROUTES)("renders /%s inside the shell", async route => {
    mount(`/${route}`);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }))
      .toBeInTheDocument(), { timeout: 8000 });
    expect(screen.queryByText("This route is not available.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0);
  });

  it("labels demo data on the control room", async () => {
    mount("/control-room");
    await screen.findByText(/MODEL RISK ESTIMATE/, {}, { timeout: 8000 });
    expect(screen.getAllByText(/DEMO/i).length).toBeGreaterThan(0);
  });

  it("KPI cards are navigation links", async () => {
    mount("/control-room");
    await screen.findByText(/MODEL RISK ESTIMATE/, {}, { timeout: 8000 });
    const hrefs = screen.getAllByRole("link").map(a => a.getAttribute("href"));
    for (const target of ["/water-buffer", "/shortage-clock", "/loss-anomalies"]) {
      expect(hrefs).toContain(target);
    }
  });

  it("water buffer shows the model estimate and reserve threshold", async () => {
    mount("/water-buffer");
    await screen.findByText("Shortage threshold", {}, { timeout: 8000 });
    expect(screen.getAllByText("MODEL ESTIMATE").length).toBeGreaterThan(0);
  });

  it("evidence inspector opens a drawer with provenance", async () => {
    mount("/evidence");
    const buttons = await screen.findAllByRole("button", { name: /^Inspect/ },
      { timeout: 8000 });
    await userEvent.click(buttons[0]);
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(within(dialog).getByText(/How it influenced the decision/))
      .toBeInTheDocument();
  });

  it("human approval flow: draft, approve, record execution", async () => {
    mount("/control-room");
    await userEvent.click(await screen.findByRole("button",
      { name: "Create review draft" }, { timeout: 8000 }));
    await screen.findByText(/Draft created/);
    await userEvent.click(screen.getAllByRole("link", { name: /action center/i })[0]);
    const approve = await screen.findByRole("button", { name: "Approve" },
      { timeout: 8000 });
    await userEvent.click(approve);
    await userEvent.type(
      await screen.findByLabelText(/Operator rationale/), "Operator approves demo");
    await userEvent.click(screen.getByRole("button",
      { name: /Confirm recorded decision/ }));
    await screen.findByRole("button", { name: "Record execution" },
      { timeout: 8000 });
  });
});
