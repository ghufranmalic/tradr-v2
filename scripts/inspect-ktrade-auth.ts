import { chromium, type Response } from "playwright";
import { env } from "@/src/config/env";

type JsonHit = {
  url: string;
  status: number;
  shape: string;
  nestedShape?: string;
  sample?: unknown;
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const jsonHits: JsonHit[] = [];

  page.on("response", async (response: Response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.toLowerCase().includes("json")) return;
    try {
      const body = await response.json();
      jsonHits.push({
        url: response.url(),
        status: response.status(),
        shape: describeShape(body),
        nestedShape: describeNestedShape(body),
        sample: response.url().includes("TopSectorStocksFull") ? sampleTopStocks(body) : undefined
      });
    } catch {
      // Keep inspection resilient if a response advertises JSON incorrectly.
    }
  });

  await page.goto(env.KTRADE_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(env.KTRADE_USERNAME_SELECTOR).first().fill(env.KTRADE_USERNAME);
  await page.locator(env.KTRADE_PASSWORD_SELECTOR).first().fill(env.KTRADE_PASSWORD);
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => undefined),
    page.locator(env.KTRADE_SUBMIT_SELECTOR).first().click()
  ]);

  const secondLevel = page.locator(env.KTRADE_SECOND_LEVEL_PASSWORD_SELECTOR).first();
  if (await secondLevel.isVisible({ timeout: 5000 }).catch(() => false)) {
    if (!env.KTRADE_SECOND_LEVEL_PASSWORD) {
      console.log(JSON.stringify({ finalUrl: page.url(), needsSecondLevelPassword: true }, null, 2));
      await browser.close();
      return;
    }
    await secondLevel.fill(env.KTRADE_SECOND_LEVEL_PASSWORD);
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => undefined),
      page.locator(env.KTRADE_SECOND_LEVEL_SUBMIT_SELECTOR).first().click()
    ]);
  }

  await page.goto(env.KTRADE_DASHBOARD_URL ?? env.KTRADE_LOGIN_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  const tableSummaries = await page.locator("table").evaluateAll((tables) =>
    tables.slice(0, 12).map((table, index) => {
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => cell.textContent?.trim().replace(/\s+/g, " ") ?? "");
      const firstRow = Array.from(table.querySelectorAll("tbody tr")).slice(0, 1).map((row) =>
        Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim().replace(/\s+/g, " ") ?? "")
      );
      return { index, headers, firstRowCellCount: firstRow[0]?.length ?? 0 };
    })
  );

  console.log(
    JSON.stringify(
      {
        finalUrl: page.url(),
        title: await page.title(),
        jsonHits,
        tableSummaries
      },
      null,
      2
    )
  );

  await browser.close();
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== "object") return typeof value;
  const keys = Object.keys(value as Record<string, unknown>).slice(0, 12);
  return `object(${keys.join(",")})`;
}

function describeNestedShape(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const objectValue = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(objectValue)) {
    if (Array.isArray(child) && child[0] && typeof child[0] === "object") {
      return `${key}[0](${Object.keys(child[0] as Record<string, unknown>).slice(0, 20).join(",")})`;
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const nested = describeNestedShape(child);
      if (nested) return `${key}.${nested}`;
    }
  }
  return undefined;
}

function sampleTopStocks(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const stocks = (value as Record<string, unknown>).stocks;
  if (!Array.isArray(stocks)) return undefined;
  return stocks.slice(0, 3).map((stock) => {
    if (!stock || typeof stock !== "object") return stock;
    const row = stock as Record<string, unknown>;
    return {
      company: row.company,
      name: row.name,
      last: row.last,
      turnover: row.turnover
    };
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
