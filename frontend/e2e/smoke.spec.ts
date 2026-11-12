import { expect, test } from "@playwright/test";

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

test("login → Overview → Products → product chart → its latest PO", async ({ page }) => {
	test.skip(!email || !password, "set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD");

	await page.goto("/login");
	await page.getByLabel("Email").fill(email!);
	await page.getByLabel("Password").fill(password!);
	await page.getByRole("button", { name: "Sign in" }).click();

	// Overview: KPI strip, and a cost mover to follow when the data has one.
	await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
	await expect(page.getByText("Stock value")).toBeVisible();
	const mover = page.locator('a[href^="/products/"]').first();
	await expect(mover).toBeVisible();
	const sku = (await mover.locator("span.text-xs").innerText()).trim();

	await page.getByRole("link", { name: "Products", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
	await page.getByPlaceholder("Search by SKU or name...").fill(sku);
	await page
		.getByRole("row", { name: new RegExp(sku) })
		.first()
		.click();

	// Product page: the cost & price chart draws, and the latest purchase opens its PO.
	await expect(page.getByText("Cost & price")).toBeVisible();
	await expect(page.locator(".recharts-surface").first()).toBeVisible();
	const purchases = page
		.getByRole("heading", { name: "Recent purchases" })
		.locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
	const latestPo = purchases.locator('a[href^="/purchases/"]').first();
	const orderNumber = (await latestPo.innerText()).trim();
	await latestPo.click();
	await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]{36}$/);
	await expect(page.getByRole("heading", { name: new RegExp(orderNumber) })).toBeVisible();
});
