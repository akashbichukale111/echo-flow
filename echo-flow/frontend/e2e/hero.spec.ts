import { test, expect } from "@playwright/test";

test("flood hero requires verification and human authorization", async ({ page }) => {
  await page.goto("/");
  // No landing page: the root opens the real Command Center and loads the scenario by itself.
  await expect(page).toHaveURL(/#\/echo-flow\/command$/);
  await expect(page.getByRole("button", { name: /ENTER ECHO-FLOW/ })).toHaveCount(0);
  await expect(page.getByText("FLOOD_HERO_SCENARIO")).toBeVisible();
  await expect(page.getByLabel("Operations map")).toBeVisible();

  await page.getByRole("button", { name: "RUN DECISION", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 120000 });

  await page.getByRole("link", { name: "Human Decision" }).click();
  await expect(page.getByRole("heading", { name: "ACTION BLOCKED" })).toBeVisible();
  await expect(page.getByRole("button", { name: "APPROVE", exact: true })).toBeDisabled();

  await page.getByRole("link", { name: "Red Team" }).click();
  await page.getByRole("button", { name: "VERIFY SYNTHETIC MEASUREMENT" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "RUN AGAIN" }).click();
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 120000 });

  await page.getByRole("link", { name: "Human Decision" }).click();
  await expect(page.getByRole("button", { name: "APPROVE", exact: true })).toBeEnabled();

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "APPROVE", exact: true }).click();
  await expect(page.getByRole("button", { name: "EXECUTE SIMULATED ACTION" })).toBeEnabled();
  await page.getByRole("button", { name: "EXECUTE SIMULATED ACTION" }).click();

  await expect(page.getByText(/State revision 1/)).toBeVisible();
  await page.getByRole("link", { name: /New state/ }).click();
  await expect(page.getByText("SIMULATED ACTION — NO PHYSICAL INFRASTRUCTURE CONTROL")).toBeVisible();

  await page.getByRole("button", { name: "RE-SIMULATE NEW STATE" }).click();
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 120000 });
});
