import { test, expect } from "@playwright/test";

const paths = [
  "control-room", "water-buffer", "shortage-clock", "diagnosis",
  "loss-anomalies", "what-if", "tanker-intelligence", "zone-map",
  "action-center", "verification", "evidence", "zone-configuration", "settings"
];

test("every page resolves within the same shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const path of paths) {
    await page.goto(`/${path}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".skeleton")).toHaveCount(0);
    await expect(page.getByText("This route is not available.")).toHaveCount(0);
    await expect(page.locator(".error")).toHaveCount(0);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 2
    )).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test("zone input through human-approved simulated verification", async ({ page }) => {
  await page.goto("/zone-configuration");
  await page.getByRole("button", { name: "Create new", exact: true }).click();
  await page.getByLabel("Zone name", { exact: true })
    .fill(`QA zone ${Date.now()}`);
  await page.getByLabel("Location", { exact: true }).fill("Synthetic QA locality");
  await page.getByRole("button", { name: "Save zone", exact: true }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Zone saved"
  })).toBeVisible();

await page.goto("/water-buffer");
  await expect(page.getByText("12.42 days", { exact: true }).first()).toBeVisible();

await page.goto("/what-if");
  await page.getByLabel("Loss reduction (percentage points)").fill("5");
  await expect(page.getByText("Results reflect the current parameters.")).toBeVisible();
  await page.getByRole("button", { name: "Create scenario draft" }).click();

await expect(page).toHaveURL(/action-center/);
  await page.getByRole("button", { name: "Approve", exact: true }).last().click();
  await page.getByLabel("Operator rationale").fill("QA human approval for demo only");
  await page.getByRole("button", { name: "Confirm recorded decision" }).click();
  await page.getByRole("button", { name: "Record execution", exact: true }).last().click();
  await page.getByLabel("Operator rationale").fill("QA simulated intervention completed");
  await page.getByRole("button", { name: "Confirm recorded decision" }).click();

await page.goto("/verification");
  await page.getByRole("button", { name: "Enter verification observation" }).last().click();
  await page.getByLabel("Observed/estimated loss (%)").fill("3");
  await page.getByLabel("Observation notes").fill("Synthetic QA observation, not measured");
  await page.getByRole("button", { name: "Save verification", exact: true }).click();
  await expect(page.getByText("SIMULATED VERIFICATION", { exact: true }).last()).toBeVisible();

await page.goto("/evidence");
  await expect(page.getByText("OPERATOR INPUT", { exact: true }).first()).toBeVisible();
});
