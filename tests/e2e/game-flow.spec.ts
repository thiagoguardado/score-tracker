import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("creates, scores, persists, and finishes a game", async ({ page }) => {
  await page.getByRole("button", { name: /new game/i }).click();
  await page.getByLabel("Player 1 name").fill("Thiago");
  await page.getByLabel("Player 2 name").fill("Mario");
  await page.getByRole("button", { name: "Start game" }).click();

  await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible();
  await expect(page.getByText("Try saying")).toBeVisible();
  await expect(page.getByText(/repeat last round/)).toBeVisible();
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByLabel("Thiago").fill("10");
  await page.getByLabel("Mario").fill("7");
  await page.getByRole("button", { name: "Confirm round" }).click();

  await expect(page.getByText("10", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("10", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("Final result")).toBeVisible();
  await expect(page.getByRole("button", { name: /share result/i })).toBeVisible();
});

test("edits and deletes rounds from history", async ({ page }) => {
  await page.getByRole("button", { name: /new game/i }).click();
  await page.getByLabel("Player 1 name").fill("Ana");
  await page.getByLabel("Player 2 name").fill("Bia");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByLabel("Ana").fill("4");
  await page.getByLabel("Bia").fill("6");
  await page.getByRole("button", { name: "Confirm round" }).click();

  await page.getByRole("button", { name: "Rounds" }).click();
  await page.getByRole("button", { name: "Edit round 1" }).click();
  await page.getByLabel("Ana").fill("9");
  await page.getByRole("button", { name: "Confirm round" }).click();
  await expect(page.getByText("9", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete round 1" }).click();
  await expect(page.getByText("No rounds yet")).toBeVisible();
});

test("persists a manual Portuguese language choice", async ({ page }) => {
  await page.getByLabel("Language").selectOption("pt-BR");
  await expect(page.getByRole("button", { name: /novo jogo/i })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Idioma")).toHaveValue("pt-BR");
  await expect(page.getByRole("button", { name: /novo jogo/i })).toBeVisible();
});

test("supports system, light, and persistent dark themes", async ({ page }) => {
  await expect(page.getByLabel("Theme")).toHaveValue("system");

  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.getByLabel("Theme").locator("option").first()).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(page.getByLabel("Theme").locator("option").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.reload();
  await expect(page.getByLabel("Theme")).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByLabel("Theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});
