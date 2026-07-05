import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { env, hasKTradeCredentials, orderSelectors } from "@/src/config/env";
import { toNumber } from "@/src/lib/number";
import type {
  HoldingInput,
  OrderRequest,
  OrderResult,
  PortfolioPositionInput,
  PortfolioSummaryInput,
  Quote,
  WatchlistInput
} from "@/src/types/market";

type CapturedPayloads = {
  watchlists: unknown[];
  portfolio: unknown[];
  quotes: unknown[];
};

type CaptureKind = keyof CapturedPayloads;

const DATA_WAIT_MS = 15_000;
const CAPTURE_POLL_MS = 100;

export class KTradeClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private captured: CapturedPayloads = { watchlists: [], portfolio: [], quotes: [] };
  private dashboardReady = false;
  private portfolioWatchReady = false;
  private defaultWatchReady = false;

  async connect(): Promise<void> {
    this.browser = await chromium.launch({ headless: env.KTRADE_HEADLESS });
    const statePath = env.KTRADE_SESSION_STATE_PATH;
    this.context = await this.browser.newContext({
      storageState: await storageStateIfExists(statePath)
    });
    this.page = await this.context.newPage();
    this.captureJsonResponses(this.page);
  }

  async close(): Promise<void> {
    await this.context?.storageState({ path: env.KTRADE_SESSION_STATE_PATH }).catch(() => undefined);
    await this.browser?.close();
  }

  async login(): Promise<void> {
    if (!this.page || !this.context) throw new Error("KTrade client is not connected");

    await this.page.goto(env.KTRADE_DASHBOARD_URL ?? env.KTRADE_LOGIN_URL, { waitUntil: "domcontentloaded" });
    if (await this.isAuthenticated()) {
      await this.persistSession();
      return;
    }

    if (!hasKTradeCredentials) {
      throw new Error("KTrade credentials are missing. Set KTRADE_USERNAME and KTRADE_PASSWORD in the environment.");
    }

    await this.page.goto(env.KTRADE_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await this.page.locator(env.KTRADE_USERNAME_SELECTOR).first().fill(env.KTRADE_USERNAME);
    await this.page.locator(env.KTRADE_PASSWORD_SELECTOR).first().fill(env.KTRADE_PASSWORD);
    await Promise.all([
      this.page.waitForLoadState("networkidle").catch(() => undefined),
      this.page.locator(env.KTRADE_SUBMIT_SELECTOR).first().click()
    ]);

    await this.completeSecondLevelLoginIfNeeded();

    if (env.KTRADE_TOTP_SECRET) {
      console.warn("KTRADE_TOTP_SECRET is configured, but TOTP generation is intentionally not bundled. Add a provider-specific MFA handler in KTradeClient.login().");
    }

    if (!(await this.isAuthenticated())) {
      throw new Error("KTrade login did not reach an authenticated state. Update selectors or handle MFA in src/services/ktrade/client.ts.");
    }

    await this.persistSession();
  }

  async fetchWatchlists(): Promise<WatchlistInput[]> {
    await this.ensureDashboard();
    await this.waitForCapture("watchlists", 3_000);
    const fromJson = normalizeWatchlists(this.captured.watchlists);
    if (fromJson.length > 0) return fromJson;

    const symbols = await extractSymbolsFromTables(this.requirePage());
    return symbols.length > 0 ? [{ name: "KTrade Watchlist", symbols }] : [];
  }

  async fetchPortfolio(): Promise<HoldingInput[]> {
    const positions = await this.fetchPortfolioPositions();
    return positions.map((position) => ({
      symbol: position.symbol,
      quantity: position.position,
      averageBuy: position.purchasePrice,
      currentPrice: position.lastPrice
    }));
  }

  async fetchPortfolioPositions(): Promise<PortfolioPositionInput[]> {
    const page = this.requirePage();
    await this.openPortfolioWatch();

    const watchRows = await page.locator("table[id^='portfolioWatchTblID']").first().locator("tbody tr").evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim().replace(/\s+/g, " ") ?? ""))
    );

    const detailRows = await page.locator("table.splashPortfolio").first().locator("tbody tr").evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim().replace(/\s+/g, " ") ?? ""))
    );

    const detailBySymbol = new Map(
      detailRows
        .filter((cells) => isSymbol(cells[0]))
        .map((cells) => [
          cells[0],
          {
            holding: toNumber(cells[1]),
            holdingAvailable: toNumber(cells[2]),
            marketRate: toNumber(cells[10]),
            custodyValue: toNumber(cells[13]),
            profitLoss: toNumber(cells[23])
          }
        ])
    );
    const namesBySymbol = await extractCompanyNamesFromTables(page);

    return watchRows
      .map((cells) => ({
        symbol: cells[0] ?? "",
        name: namesBySymbol.get(cells[0] ?? ""),
        market: cells[1] ?? "",
        position: toNumber(cells[2]),
        purchasePrice: toNumber(cells[3]),
        lastPrice: toNumber(cells[4]),
        todayGainLoss: toNumber(cells[5]),
        totalGainLoss: toNumber(cells[6]),
        bidSize: toNumber(cells[7]),
        bidPrice: toNumber(cells[8]),
        askPrice: toNumber(cells[9]),
        askSize: toNumber(cells[10]),
        change: toNumber(cells[11]),
        ...detailBySymbol.get(cells[0])
      }))
      .filter((row) => isSymbol(row.symbol) && row.position > 0 && row.purchasePrice > 0 && row.lastPrice > 0);
  }

  async fetchPortfolioSummary(): Promise<PortfolioSummaryInput[]> {
    const page = this.requirePage();
    await this.openPortfolioWatch();

    const labels = [
      "TRADING CASH BALANCE",
      "MARKET VALUE OF CUSTODY",
      "WORKING CAPITAL",
      "OPEN POSITION (EXPOSURE)",
      "MARGIN REQUIRED",
      "TOTAL WORTH",
      "MARGIN PERCENTAGE",
      "MARK TO MARKET",
      "BLOCKED MTM PROFIT"
    ];

    const pairs = await page.evaluate((summaryLabels) => {
      const texts = Array.from(document.querySelectorAll("body *"))
        .map((element) => element.textContent?.trim().replace(/\s+/g, " ") ?? "")
        .filter(Boolean);

      return summaryLabels.flatMap((label) => {
        const index = texts.findIndex((text) => text.toUpperCase() === label || text.toUpperCase().startsWith(`${label} `));
        if (index < 0) return [];
        const haystack = texts.slice(index, index + 8).join(" ");
        const value = haystack.replace(label, "").match(/-?[\d,.]+(?:\.\d+)?/u)?.[0] ?? "";
        return value ? [{ label, value }] : [];
      });
    }, labels);

    return pairs.map((pair) => ({ label: pair.label, value: toNumber(pair.value) }));
  }

  /**
   * Returns whatever symbols are in KTrade's own "DEFAULT WATCH" market-watch
   * tab (not filtered by `symbols` — that list is a separate, user-managed
   * watchlist inside KTrade itself, not necessarily overlapping the portfolio).
   * Column layout confirmed against the live table.watchTable markup:
   * 3=SYMBOL, 5=LAST, 12=HIGH, 13=LOW, 14=OPEN (hidden), 15=LAST VOL (hidden).
   */
  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const direct = await this.fetchQuotesViaApi(symbols);
    if (direct.length > 0) return direct;

    await this.waitForCapture("quotes", 1_000);
    const fromJson = normalizeQuotes(this.captured.quotes);
    if (fromJson.length > 0) {
      const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
      return fromJson.filter((quote) => wanted.size === 0 || wanted.has(quote.symbol.toUpperCase()));
    }

    await this.openDefaultWatch();
    const rows = await this.requirePage()
      .locator("table.watchTable")
      .first()
      .locator("tbody tr")
      .evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "")));

    return rows
      .map((cells) => {
        const close = toNumber(cells[5]);
        return {
          symbol: cells[3] ?? "",
          open: toNumber(cells[14]) || close,
          high: toNumber(cells[12]) || close,
          low: toNumber(cells[13]) || close,
          close,
          volume: toNumber(cells[15]),
          timestamp: new Date()
        };
      })
      .filter((quote) => isSymbol(quote.symbol) && quote.close > 0);
  }

  /**
   * Fast path: hit KTrade's internal JSON endpoint directly with the authenticated
   * session cookies (no page navigation). Requires KTRADE_QUOTES_API_URL.
   */
  private async fetchQuotesViaApi(symbols: string[]): Promise<Quote[]> {
    if (!env.KTRADE_QUOTES_API_URL || !this.context) return [];
    try {
      const response = await this.context.request.get(env.KTRADE_QUOTES_API_URL, { timeout: 10_000 });
      if (!response.ok()) return [];
      const payload = await response.json();
      const quotes = normalizeQuotes([payload]);
      const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
      return quotes.filter((quote) => wanted.size === 0 || wanted.has(quote.symbol.toUpperCase()));
    } catch {
      return [];
    }
  }

  /**
   * Place an order through the KTrade order ticket. Only runs when
   * KTRADE_ORDER_SELECTORS_JSON is configured; the trade engine keeps orders in
   * dry-run/manual mode otherwise.
   */
  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const selectors = orderSelectors();
    if (!selectors) {
      return {
        placed: false,
        detail: "KTRADE_ORDER_SELECTORS_JSON is not configured; order requires manual placement."
      };
    }

    const page = this.requirePage();
    await this.ensureDashboard();

    await page.locator(selectors.openTicket).first().click({ timeout: 10_000 });
    await page.locator(selectors.symbolInput).first().waitFor({ state: "visible", timeout: 10_000 });

    await page.locator(selectors.symbolInput).first().fill(order.symbol);
    await page.locator(order.side === "buy" ? selectors.buySide : selectors.sellSide).first().click();
    await page.locator(selectors.quantityInput).first().fill(String(order.quantity));
    if (selectors.priceInput && order.limitPrice) {
      await page.locator(selectors.priceInput).first().fill(order.limitPrice.toFixed(2));
    }

    await page.locator(selectors.submit).first().click();
    if (selectors.confirm) {
      await page.locator(selectors.confirm).first().click({ timeout: 10_000 }).catch(() => undefined);
    }

    const errorText = selectors.errorBanner
      ? await page.locator(selectors.errorBanner).first().textContent({ timeout: 3_000 }).catch(() => null)
      : null;
    if (errorText?.trim()) {
      return { placed: false, detail: `KTrade rejected the order: ${errorText.trim()}` };
    }

    return { placed: true, detail: `Order submitted: ${order.side} ${order.quantity} ${order.symbol}` };
  }

  /** Navigate to the dashboard once and wait for real data instead of sleeping. */
  private async ensureDashboard(): Promise<void> {
    const page = this.requirePage();
    if (this.dashboardReady && !page.isClosed()) return;

    await page.goto(env.KTRADE_DASHBOARD_URL ?? env.KTRADE_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await Promise.race([
      page.waitForSelector("table tbody tr", { timeout: DATA_WAIT_MS }).catch(() => undefined),
      this.waitForCapture("quotes", DATA_WAIT_MS)
    ]);
    this.dashboardReady = true;
  }

  /** Poll the captured JSON buffers until data arrives or the timeout elapses. */
  private async waitForCapture(kind: CaptureKind, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.captured[kind].length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_POLL_MS));
    }
    return this.captured[kind].length > 0;
  }

  private captureJsonResponses(page: Page): void {
    page.on("response", async (response: Response) => {
      const url = response.url().toLowerCase();
      const contentType = response.headers()["content-type"] ?? "";
      if (!contentType.includes("json")) return;

      try {
        const payload = await response.json();
        if (url.includes(env.KTRADE_WATCHLIST_URL_PATTERN.toLowerCase())) this.captured.watchlists.push(payload);
        if (url.includes(env.KTRADE_PORTFOLIO_URL_PATTERN.toLowerCase())) this.captured.portfolio.push(payload);
        if (url.includes(env.KTRADE_QUOTES_URL_PATTERN.toLowerCase())) this.captured.quotes.push(payload);
      } catch {
        // Ignore non-JSON responses that advertise JSON incorrectly.
      }
    });
  }

  private async isAuthenticated(): Promise<boolean> {
    const page = this.requirePage();
    const url = page.url().toLowerCase();
    const passwordFields = await page.locator(env.KTRADE_PASSWORD_SELECTOR).count().catch(() => 0);
    const usernameFields = await page.locator(env.KTRADE_USERNAME_SELECTOR).count().catch(() => 0);
    if (passwordFields > 0 || usernameFields > 0) return false;
    return !url.includes("login") && !url.includes("signin") && !url.includes("sign-in");
  }

  private async persistSession(): Promise<void> {
    await mkdir(path.dirname(env.KTRADE_SESSION_STATE_PATH), { recursive: true });
    await this.context?.storageState({ path: env.KTRADE_SESSION_STATE_PATH });
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("KTrade client is not connected");
    return this.page;
  }

  private async openPortfolioWatch(): Promise<void> {
    const page = this.requirePage();
    const portfolioTable = page.locator("table[id^='portfolioWatchTblID']").first();
    if (this.portfolioWatchReady && (await portfolioTable.isVisible().catch(() => false))) return;

    await this.ensureDashboard();
    await page.locator("text=Watches").first().hover({ timeout: 10_000 });
    await page.locator("text=PORTFOLIO WATCH").first().click({ timeout: 10_000 }).catch(async () => {
      await page.locator("text=Portfolio Watch").first().click({ timeout: 10_000 });
    });
    await portfolioTable.locator("tbody tr").first().waitFor({ state: "attached", timeout: DATA_WAIT_MS }).catch(() => undefined);
    await page
      .locator("table.splashPortfolio tbody tr")
      .first()
      .waitFor({ state: "attached", timeout: 5_000 })
      .catch(() => undefined);
    this.portfolioWatchReady = true;
  }

  /** Opens the "DEFAULT WATCH" market-watch tab (KTrade's own general watchlist, separate from portfolio holdings). */
  private async openDefaultWatch(): Promise<void> {
    const page = this.requirePage();
    const watchTable = page.locator("table.watchTable").first();
    if (this.defaultWatchReady && (await watchTable.isVisible().catch(() => false))) return;

    await this.ensureDashboard();
    await page.locator("text=Watches").first().hover({ timeout: 10_000 });
    await page.locator("text=DEFAULT WATCH").first().click({ timeout: 10_000 });
    await watchTable.locator("tbody tr").first().waitFor({ state: "attached", timeout: DATA_WAIT_MS }).catch(() => undefined);
    this.defaultWatchReady = true;
  }

  private async completeSecondLevelLoginIfNeeded(): Promise<void> {
    const page = this.requirePage();
    const secondLevelPassword = page.locator(env.KTRADE_SECOND_LEVEL_PASSWORD_SELECTOR).first();
    const isVisible = await secondLevelPassword.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isVisible) return;

    if (!env.KTRADE_SECOND_LEVEL_PASSWORD) {
      throw new Error("KTrade requested a second-level password. Set KTRADE_SECOND_LEVEL_PASSWORD and rerun the collector.");
    }

    await secondLevelPassword.fill(env.KTRADE_SECOND_LEVEL_PASSWORD);
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => undefined),
      page.locator(env.KTRADE_SECOND_LEVEL_SUBMIT_SELECTOR).first().click()
    ]);
  }
}

async function storageStateIfExists(statePath: string): Promise<string | undefined> {
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    await access(statePath);
    return statePath;
  } catch {
    return undefined;
  }
}

async function extractSymbolsFromTables(page: Page): Promise<Array<{ symbol: string; name?: string }>> {
  const rows = await page.locator("table").evaluateAll((tables) =>
    tables.flatMap((table) =>
      Array.from(table.querySelectorAll("tbody tr")).map((row) =>
        Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "")
      )
    )
  );

  return rows
    .map((cells) => ({ symbol: cells[0] ?? "", name: cells[1] }))
    .filter((row) => /^[A-Z0-9.-]{2,12}$/i.test(row.symbol));
}

async function extractCompanyNamesFromTables(page: Page): Promise<Map<string, string>> {
  const rows = await page.locator("table").evaluateAll((tables) =>
    tables.flatMap((table) =>
      Array.from(table.querySelectorAll("tbody tr")).map((row) =>
        Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim().replace(/\s+/g, " ") ?? "")
      )
    )
  );

  return new Map(
    rows
      .filter((cells) => isSymbol(cells[0]) && cells[1] && !/^(REG|FUT|ODL)$/i.test(cells[1]))
      .map((cells) => [cells[0], cells[1]])
  );
}

function normalizeWatchlists(payloads: unknown[]): WatchlistInput[] {
  return payloads.flatMap((payload) => {
    const list = Array.isArray(payload) ? payload : getArray(payload, ["data", "watchlists", "items"]);
    return list
      .map((item) => ({
        name: String(getValue(item, ["name", "title"]) ?? "KTrade Watchlist"),
        symbols: getArray(item, ["symbols", "items", "stocks"]).map((stock) => ({
          symbol: String(getValue(stock, ["symbol", "ticker", "code"]) ?? ""),
          name: String(getValue(stock, ["name", "companyName"]) ?? "")
        }))
      }))
      .filter((watchlist) => watchlist.symbols.length > 0);
  });
}

function normalizeQuotes(payloads: unknown[]): Quote[] {
  return payloads.flatMap((payload) => {
    const rows = Array.isArray(payload) ? payload : getArray(payload, ["data", "quotes", "stocks", "items"]);
    return rows
      .map((row) => {
        const close = toNumber(getValue(row, ["close", "last", "price", "latest", "c"]));
        const symbol = firstValidSymbol([getValue(row, ["symbol", "ticker", "code"]), getValue(row, ["name"]), getValue(row, ["company"])]);
        return {
          symbol,
          name: String(getValue(row, ["companyName", "company", "name"]) ?? ""),
          open: toNumber(getValue(row, ["open", "o"])) || close,
          high: toNumber(getValue(row, ["high", "h"])) || close,
          low: toNumber(getValue(row, ["low", "l"])) || close,
          close,
          volume: toNumber(getValue(row, ["volume", "vol", "turnover", "v"])),
          timestamp: new Date()
        };
      })
      .filter((row) => row.symbol && row.close > 0);
  });
}

function firstValidSymbol(values: unknown[]): string {
  for (const value of values) {
    const candidate = String(value ?? "").trim();
    if (/^[A-Z0-9.-]{2,12}$/i.test(candidate)) return candidate;
  }
  return "";
}

function getArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) {
    const child = (value as Record<string, unknown>)[key];
    if (Array.isArray(child)) return child;
    const nested = getArray(child, keys);
    if (nested.length > 0) return nested;
  }
  return [];
}

function getValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined && child !== null) return child;
  }
  return undefined;
}

function isSymbol(value: unknown): value is string {
  return /^[A-Z0-9.-]{2,12}$/i.test(String(value ?? "").trim());
}
