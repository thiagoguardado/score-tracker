import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("creates, scores, persists, and finishes a game", async ({ page }) => {
  await page.getByRole("button", { name: /new game/i }).click();
  await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
  await expect(page.getByLabel("Language")).toHaveCount(0);
  await expect(page.getByLabel("Theme")).toHaveCount(0);
  const setupMic = page.locator(".setup-voice-dock .main-mic");
  await expect(setupMic).toHaveAttribute("data-model-phase", "idle");
  await expect(setupMic).toHaveAccessibleName("Download offline voice");
  await expect(page.locator(".setup-voice-dock")).toHaveCSS("position", "fixed");
  await page.getByLabel("Player 1 name").fill("Thiago");
  await page.getByLabel("Player 2 name").fill("Mario");
  await page.getByRole("button", { name: "Start game" }).click();

  await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible();
  await expect(page.getByText("Scores · ranking · repeat · undo")).toBeVisible();
  await expect(page.locator(".voice-dock")).toHaveCSS("position", "fixed");
  await expect(page.getByLabel("Language")).toHaveCount(0);
  await expect(page.getByLabel("Theme")).toHaveCount(0);
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByLabel("Thiago", { exact: true }).fill("10");
  await expect(page.getByLabel("Mario", { exact: true })).toHaveAttribute("inputmode", "numeric");
  await page.getByLabel("Mario", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Toggle sign for Mario's score" }).click({ force: true });
  await expect(page.getByLabel("Mario", { exact: true })).toHaveValue("-7"); // wait for re-render to settle
  await page.getByRole("button", { name: "Confirm round" }).click({ force: true });

  await expect(page.getByText("10", { exact: true })).toBeVisible();
  await expect(page.getByText("-7", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("10", { exact: true })).toBeVisible();
  await expect(page.getByText("-7", { exact: true })).toBeVisible();

  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept()),
    page.getByRole("button", { name: "Finish" }).click(),
  ]);
  await expect(page.getByText("Final result")).toBeVisible();
  await expect(page.getByRole("button", { name: /share result/i })).toBeVisible();
});

test("edits and deletes rounds from history", async ({ page }) => {
  await page.getByRole("button", { name: /new game/i }).click();
  await page.getByLabel("Player 1 name").fill("Ana");
  await page.getByLabel("Player 2 name").fill("Bia");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByLabel("Ana", { exact: true }).fill("4");
  await page.getByLabel("Bia", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Confirm round" }).click({ force: true });

  await page.getByRole("button", { name: "Rounds" }).click();
  await page.getByRole("button", { name: "Edit round 1" }).click();
  await page.getByLabel("Ana", { exact: true }).fill("9", { force: true });
  await page.getByRole("button", { name: "Confirm round" }).click({ force: true });
  await expect(page.getByText("9", { exact: true })).toBeVisible();

  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept()),
    page.getByRole("button", { name: "Delete round 1" }).click(),
  ]);
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

test("keeps settings on Home and returns there from game flows", async ({ page }) => {
  await expect(page.getByLabel("Language")).toBeVisible();
  await expect(page.getByLabel("Theme")).toBeVisible();
  await page.getByRole("button", { name: /new game/i }).click();
  await page.getByRole("button", { name: "Home" }).click();
  await expect(page.getByLabel("Language")).toBeVisible();
  await expect(page.getByLabel("Theme")).toBeVisible();
});
