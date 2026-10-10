import { afterEach, describe, expect, it, vi } from "vitest";
import { api, fmt, localDeparture } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("shared frontend helpers", () => {
  it("preserves the explicit India timezone", () => {
    expect(localDeparture(14.25)).toBe("2026-05-15T14:15:00+05:30");
  });
  it("does not display invalid numbers as measurements", () => {
    expect(fmt(Number.NaN)).toBe("Unavailable");
  });
  it("surfaces backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ detail: "No route satisfies the constraints" }),
    }));
    await expect(api("/plan", {})).rejects.toThrow("No route satisfies");
  });
  it("sends JSON to the connected backend", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ status: "ok" }),
    });
    vi.stubGlobal("fetch", mock);
    await expect(api("/plan", { origin: 12 })).resolves.toEqual({ status: "ok" });
    expect(mock).toHaveBeenCalledWith("/api/plan", expect.objectContaining({
      method: "POST", body: '{"origin":12}',
    }));
  });
});
