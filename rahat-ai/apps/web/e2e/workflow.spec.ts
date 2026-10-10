import { expect, test } from "@playwright/test";

test.skip("legacy Pune control-room flow (control room moved to the new overview)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start simulated trip", exact: true }))
    .toBeEnabled();
  await page.getByRole("button", { name: "RAHAT mode", exact: true }).click();
  await page.getByRole("button", { name: "Start simulated trip", exact: true }).click();
  await expect(page).toHaveURL(/live-trip/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("PAUSED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "I NEED RAHAT", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Nearby relief" })).toBeVisible();
  await expect(page.getByText("Network-distance ranking", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close relief", exact: true }).click();
  await page.getByRole("link", { name: "Scenario lab", exact: true }).click();
  await page.getByRole("button", { name: "Run scenario", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recalculated candidates" })).toBeVisible();
});

test("all application routes resolve and mobile has no horizontal body overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/planner", "/thermal-map", "/exposure", "/relief", "/compare",
    "/live-trip", "/scenario", "/community", "/evidence", "/settings",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Navigate through the heat." })).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflow).toBe(false);
  }
});

test("community reports stay unverified", async ({ page }) => {
  await page.goto("/community");
  await page.getByLabel("Optional note").fill("E2E demonstration report");
  await page.getByRole("button", { name: "Submit unverified report" }).click();
  await expect(page.getByText("Community report saved as UNVERIFIED.")).toBeVisible();
});

test("flagship Delhi journey: hero, plan, choose RAHAT, simulate, I NEED RAHAT", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /NAVIGATE THE CITY/ })).toBeVisible();
  await page.getByRole("button", { name: /START YOUR JOURNEY/ }).click();
  await expect(page).toHaveURL(/journey\/start/);
  await page.getByRole("button", { name: "WATER" }).click();
  await page.getByRole("button", { name: "SEE THE HEAT CHOICE" }).click();
  await expect(page.getByText("RAHAT CORRIDOR").first()).toBeVisible();
  await page.getByRole("button", { name: "CHOOSE THE RAHAT WAY" }).click();
  await page.getByRole("button", { name: "START JOURNEY", exact: true }).click();
  await expect(page.getByText("RAHAT JOURNEY ACTIVE")).toBeVisible();
  await expect(page.getByText("SIMULATED JOURNEY").first()).toBeVisible();
  await page.getByRole("button", { name: "I NEED RAHAT" }).first().click();
  await expect(page.getByRole("dialog", { name: "Nearby relief" })).toBeVisible();
});
