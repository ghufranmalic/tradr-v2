import { chromium, type Page, type Response } from "playwright";
import { env } from "@/src/config/env";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const jsonHits: Array<{ url: string; status: number; shape: string; nested?: string }> = [];

  page.on("response", async (response: Response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.toLowerCase().includes("json")) return;
    try {
      const body = await response.json();
      jsonHits.push({ url: response.url(), status: response.status(), shape: describeShape(body), nested: describeNested(body) });
    } catch {
      // Inspection only.
    }
  });

  await login(page);
  await page.goto(env.KTRADE_DASHBOARD_URL ?? env.KTRADE_LOGIN_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  await page.locator("text=Watches").first().hover({ timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.locator("text=PORTFOLIO WATCH").first().click({ timeout: 10000 }).catch(async () => {
    await page.locator("text=Portfolio Watch").first().click({ timeout: 10000 });
  });
  await page.waitForTimeout(6000);

  const dom = await page.evaluate<Record<string, unknown>>(`(() => {
    const visibleText = (selector) =>
      Array.from(document.querySelectorAll(selector))
        .map((element) => element.textContent?.trim().replace(/\\s+/g, " ") ?? "")
        .filter(Boolean)
        .slice(0, 30);

    const tables = Array.from(document.querySelectorAll("table")).map((table, index) => {
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => cell.textContent?.trim().replace(/\\s+/g, " ") ?? "");
      const rows = Array.from(table.querySelectorAll("tbody tr"))
        .slice(0, 5)
        .map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim().replace(/\\s+/g, " ") ?? ""));
      return {
        index,
        id: table.id,
        classes: table.getAttribute("class") ?? "",
        headers,
        rows
      };
    });

    return {
      url: location.href,
      title: document.title,
      headings: visibleText("h1,h2,h3,h4,.panel-title,.caption-subject"),
      tabs: visibleText("a,button,li"),
      tables
    };
  })()`);

  console.log(JSON.stringify({ ...dom, jsonHits }, null, 2));
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

function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== "object") return typeof value;
  return `object(${Object.keys(value as Record<string, unknown>).slice(0, 16).join(",")})`;
}

function describeNested(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child) && child[0] && typeof child[0] === "object") {
      return `${key}[0](${Object.keys(child[0] as Record<string, unknown>).slice(0, 24).join(",")})`;
    }
  }
  return undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
