import { chromium, type Page } from "playwright";
import { env } from "@/src/config/env";

/**
 * Fills the KTrade order ticket to verify the selectors resolve correctly —
 * and deliberately STOPS before clicking Trade. It never submits an order.
 * Run this yourself (not via an AI agent) since it needs your live session:
 *   npx tsx scripts/inspect-ktrade-order-ticket.ts SYMBOL SIDE QTY PRICE
 * Example:
 *   npx tsx scripts/inspect-ktrade-order-ticket.ts MEBL buy 10 550
 */

const [symbol = "MEBL", side = "buy", quantity = "10", price = "550"] = process.argv.slice(2);

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await login(page);
  await page.goto(env.KTRADE_DASHBOARD_URL ?? env.KTRADE_LOGIN_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  await page.locator("#trade-symbol").first().click({ timeout: 10000 });
  await page.locator("#trade-symbol").first().fill(symbol);
  await page.waitForTimeout(800);

  const suggestions = await page.locator(".ui-autocomplete li, .ui-menu-item").allTextContents().catch(() => []);
  console.log("Autocomplete suggestions after typing symbol:", suggestions);

  if (suggestions.length > 0) {
    await page.locator(".ui-autocomplete li, .ui-menu-item").first().click().catch(() => undefined);
    await page.waitForTimeout(500);
  } else {
    console.warn("No autocomplete suggestions appeared — the symbol field may need a different interaction (e.g. keyboard ArrowDown+Enter) to register.");
  }

  await page.locator(side === "buy" ? "#trade-side-buy" : "#trade-side-sell").first().click();
  await page.locator("#trade-volume").first().fill(quantity);
  await page.locator("#trade-price").first().fill(price);
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => ({
    symbolValue: (document.querySelector("#trade-symbol") as HTMLInputElement | null)?.value,
    volumeValue: (document.querySelector("#trade-volume") as HTMLInputElement | null)?.value,
    priceValue: (document.querySelector("#trade-price") as HTMLInputElement | null)?.value,
    orderValueLabel: document.querySelector("#order-value-label")?.textContent?.trim(),
    activeSide: document.querySelector("#trade-side-buy")?.classList.contains("active")
      ? "buy"
      : document.querySelector("#trade-side-sell")?.classList.contains("active")
        ? "sell"
        : "unknown"
  }));

  console.log("Ticket state (NOT submitted):", JSON.stringify(state, null, 2));
  console.log("\nIf orderValueLabel is populated correctly and activeSide matches, the selectors are good.");
  console.log("This script deliberately does not click #tradeorderbtn. Close the browser when done reviewing.");

  await page.waitForTimeout(60000);
  await browser.close();
}

async function login(page: Page) {
  await page.goto(env.KTRADE_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(env.KTRADE_USERNAME_SELECTOR).first().fill(env.KTRADE_USERNAME);
  await page.locator(env.KTRADE_PASSWORD_SELECTOR).first().fill(env.KTRADE_PASSWORD);
  await Promise.all([page.waitForLoadState("networkidle").catch(() => undefined), page.locator(env.KTRADE_SUBMIT_SELECTOR).first().click()]);

  const secondLevel = page.locator(env.KTRADE_SECOND_LEVEL_PASSWORD_SELECTOR).first();
  if (await secondLevel.isVisible({ timeout: 5000 }).catch(() => false)) {
    if (!env.KTRADE_SECOND_LEVEL_PASSWORD) throw new Error("KTrade requested second-level password.");
    await secondLevel.fill(env.KTRADE_SECOND_LEVEL_PASSWORD);
    await Promise.all([page.waitForLoadState("networkidle").catch(() => undefined), page.locator(env.KTRADE_SECOND_LEVEL_SUBMIT_SELECTOR).first().click()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
