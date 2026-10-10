import { test, expect, type Page } from "@playwright/test";

const paths = [
  "control-room", "water-buffer", "shortage-clock", "diagnosis",
  "loss-anomalies", "what-if", "tanker-intelligence", "zone-map",
  "action-center", "verification", "evidence", "zone-configuration", "settings"
];

// Network failures to third-party hosts (map tiles, fonts) are not app errors
// in an offline CI sandbox; anything else on the console is.
const ignorable = (text: string) =>
  /Failed to load resource|net::ERR|tile\.openstreetmap|maptiler|demotiles|WebGL|GPU stall|swiftshader/i
    .test(text);

async function usePilot(page: Page, schematic = false) {
  await page.addInitScript(([s]) => {
    localStorage.setItem("waterpulse-workspace", "pilot");
    if (s) localStorage.setItem("waterpulse-map", "schematic");
  }, [schematic]);
}

test("pilot: every route renders cleanly with no overflow or console errors", async ({ page }) => {
  await usePilot(page);
  const problems: string[] = [];
  page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
  page.on("console", m => {
    if (m.type() === "error" && !ignorable(m.text())) problems.push(`console: ${m.text()}`);
  });
  for (const path of paths) {
    await page.goto(`/${path}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".skeleton")).toHaveCount(0);
    await expect(page.getByText("This route is not available.")).toHaveCount(0);
    await expect(page.locator(".error")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on /${path}`).toBeLessThanOrEqual(2);
  }
  expect(problems).toEqual([]);
});

test("pilot: control room tells the product story", async ({ page }) => {
  await usePilot(page);
  await page.goto("/control-room");
  await expect(page.getByText("Water Shortage Prevention OS")).toBeVisible();
  await expect(page.getByText(/^WATER BUFFER/).first()).toBeVisible();
  await expect(page.getByText(/^SHORTAGE CLOCK/).first()).toBeVisible();
  await expect(page.getByText(/Action window:/)).toBeVisible();
  for (const name of ["Why is this happening?", "What can we do?", "Recommended action", "Did it work?"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("REAL GOVERNMENT BASELINE").first()).toBeVisible();
  await expect(page.locator(".cause")).not.toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/\bREAL-TIME\b/i);
});

test("pilot: delhi zone shows real groundwater with a stale flag", async ({ page }) => {
  await usePilot(page);
  await page.goto("/control-room");
  await page.getByLabel("Selected zone").selectOption("pilot-delhi-nw");
  const gw = page.getByRole("region", { name: "Groundwater" });
  await expect(gw).toContainText("DSIIDC");
  await expect(gw).toContainText("REAL PUBLIC DATA");
  await expect(gw).toContainText("STALE DATA");
});

test("pilot: schematic map opens an information panel with provenance", async ({ page }) => {
  await usePilot(page, true);
  await page.goto("/zone-map");
  const station = page.getByRole("button", { name: /SCADA stations/ }).first();
  await expect(station).toBeVisible();
  await station.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Map feature details" });
  await expect(panel).toBeVisible();
  for (const text of ["Parameter", "Timestamp", "Source", "Confidence", "REAL PUBLIC DATA"]) {
    await expect(panel).toContainText(text);
  }
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(panel).toHaveCount(0);
});

test("pilot: tanker page labels the route honestly", async ({ page }) => {
  await usePilot(page);
  await page.goto("/tanker-intelligence");
  await expect(page.getByRole("heading", { name: "Route estimate" })).toBeVisible();
  await expect(page.getByText(/STRAIGHT-LINE \(NOT A ROAD ROUTE\)|ROUTED ESTIMATE/).first()).toBeVisible();
  await expect(page.getByText(/live traffic is not requested or claimed/i)).toBeVisible();
});

test("pilot: server-side approval gate blocks execution without approval", async ({ request }) => {
  const headers = { "X-WaterPulse-Workspace": "pilot" };
  const draft = await request.post("/api/zones/pilot-baramati/actions", {
    headers, data: { scenario: "tanker", parameters: {} } });
  expect(draft.status()).toBe(201);
  const { id } = await draft.json();
  const blocked = await request.post(`/api/actions/${id}/execution`, {
    headers, data: { note: "attempt to skip approval" } });
  expect(blocked.status()).toBe(409);
});
