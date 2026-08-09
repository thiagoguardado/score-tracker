import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("cria, pontua, persiste e finaliza uma partida", async ({ page }) => {
  await page.getByRole("button", { name: /novo jogo/i }).click();
  await page.getByLabel("Nome do jogador 1").fill("Thiago");
  await page.getByLabel("Nome do jogador 2").fill("Mário");
  await page.getByRole("button", { name: "Começar jogo" }).click();

  await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible();
  await page.getByRole("button", { name: "Digitar" }).click();
  await page.getByLabel("Thiago").fill("10");
  await page.getByLabel("Mário").fill("7");
  await page.getByRole("button", { name: "Confirmar rodada" }).click();

  await expect(page.getByText("10", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("10", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Finalizar" }).click();
  await expect(page.getByText("Resultado final")).toBeVisible();
  await expect(page.getByRole("button", { name: /compartilhar resultado/i })).toBeVisible();
});

test("edita e exclui rodadas pelo histórico", async ({ page }) => {
  await page.getByRole("button", { name: /novo jogo/i }).click();
  await page.getByLabel("Nome do jogador 1").fill("Ana");
  await page.getByLabel("Nome do jogador 2").fill("Bia");
  await page.getByRole("button", { name: "Começar jogo" }).click();
  await page.getByRole("button", { name: "Digitar" }).click();
  await page.getByLabel("Ana").fill("4");
  await page.getByLabel("Bia").fill("6");
  await page.getByRole("button", { name: "Confirmar rodada" }).click();

  await page.getByRole("button", { name: "Rodadas" }).click();
  await page.getByRole("button", { name: "Editar rodada 1" }).click();
  await page.getByLabel("Ana").fill("9");
  await page.getByRole("button", { name: "Confirmar rodada" }).click();
  await expect(page.getByText("9", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Excluir rodada 1" }).click();
  await expect(page.getByText("Nenhuma rodada ainda")).toBeVisible();
});
