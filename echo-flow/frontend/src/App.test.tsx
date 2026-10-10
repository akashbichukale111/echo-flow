import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { Evidence } from "./App";

describe("evidence rendering", () => {
  it("does not fabricate missing values", () => {
    render(<Evidence value={null} />);
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });
  it("renders calculated scalar values", () => {
    render(<Evidence value={{ hospital_eta_min: 18, allowed: false }} />);
    expect(screen.getByText("hospital eta min")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
  });
  it("discloses empty evidence", () => {
    render(<Evidence value={[]} />);
    expect(screen.getByText("No records")).toBeInTheDocument();
  });
});
