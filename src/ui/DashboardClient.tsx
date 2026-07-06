"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Download,
  LayoutGrid,
  LineChart,
  Moon,
  RefreshCw,
  Save,
  Settings,
  Sun,
  TrendingUp,
  Wallet,
  Zap
} from "lucide-react";
import AppLogo from "@/src/ui/AppLogo";
import PriceLogView from "@/src/ui/PriceLogView";
import SyncConsole from "@/src/ui/SyncConsole";
import { hasLoadedDashboardData, useDashboardSnapshot } from "@/src/ui/use-dashboard-snapshot";
import { createInitialSyncProgress, formatSyncError, mergeSyncProgress } from "@/src/lib/sync-steps";
import type { SyncProgressState } from "@/src/lib/sync-steps";

const OverviewCharts = dynamic(() => import("@/src/ui/OverviewCharts"), {
  ssr: false,
  loading: () => <div className="chart-box tall skeleton" />
});

export type PriceLogEntry = {
  symbol: string;
  name: string;
  purchasePrice: number;
  dailyPrices: Array<{ date: string; close: number }>;
};

export type DashboardData = {
  holdings: Array<{
    symbol: string;
    name: string;
    quantity: number;
    averageBuy: number;
    currentPrice: number;
    marketValue: number;
    profitLoss: number;
  }>;
  signals: Array<{
    symbol: string;
    side: string;
    type: string;
    score: number;
    message: string;
    createdAt: string;
  }>;
  watchlists: Array<{ name: string; symbols: string[] }>;
  prices: Array<{ symbol: string; date: string; close: number; volume: number }>;
  runs: Array<{ status: string; startedAt: string; quoteCount: number; error: string }>;
  portfolioPositions: Array<{
    symbol: string;
    name: string;
    market: string;
    position: number;
    purchasePrice: number;
    lastPrice: number;
    todayGainLoss: number;
    totalGainLoss: number;
    bidSize: number;
    bidPrice: number;
    askPrice: number;
    askSize: number;
    change: number;
    custodyValue?: number;
    profitLoss?: number;
  }>;
  summaryMetrics: Array<{ label: string; value: number }>;
  settings: CollectionSettings;
  mySignalPreference: MySignalPreference;
  tradeSettings: TradeSettings;
  orders: Array<{
    id: string;
    symbol: string;
    name: string;
    side: string;
    quantity: number;
    limitPrice: number | null;
    estimatedValue: number;
    reason: string;
    status: string;
    mode: string;
    detail: string;
    proposedAt: string;
    executedAt: string | null;
    aiRationale: string | null;
    aiConfidence: number | null;
    aiSide: string | null;
  }>;
  recommendations: Array<{
    symbol: string;
    name: string;
    side: string;
    confidence: number;
    horizon: string;
    rationale: string;
    createdAt: string;
  }>;
  priceLog: PriceLogEntry[];
};

type TradeSettings = {
  enabled: boolean;
  autoApprove: boolean;
  liveExecution: boolean;
  aiAdvisorEnabled: boolean;
  horizon: string;
  sellPortionPercent: number;
  buyOrderValue: number;
  maxOrderValue: number;
  maxOrdersPerDay: number;
};

type CollectionSettings = {
  manualRefreshEnabled: boolean;
  scheduledEnabled: boolean;
  intervalMinutes: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  lastScheduledRunAt?: string;
};

type MySignalPreference = {
  positivePercent: number;
  negativePercent: number;
  enabled: boolean;
};

type SortKey =
  | "symbol"
  | "market"
  | "position"
  | "purchasePrice"
  | "lastPrice"
  | "todayGainLoss"
  | "totalGainLoss"
  | "gainPercent"
  | "bidSize"
  | "bidPrice"
  | "askPrice"
  | "askSize"
  | "change";

type Tab = "overview" | "portfolio" | "prices" | "signals" | "trading" | "settings";
type AlertFilter = "all" | "buy" | "sell";
type AlertSort = "asc" | "desc";

const WEEKDAYS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 0, label: "S" }
];

const PIE_COLORS = [
  "#0066ff", "#00c8e8", "#34d399", "#a78bfa", "#fb7185", "#fbbf24", "#38bdf8", "#f472b6",
  "#818cf8", "#4ade80", "#facc15", "#e879f9", "#2dd4bf", "#fb923c", "#94a3b8", "#f87171"
];

const TABS: Array<{ id: Tab; label: string; icon: typeof LayoutGrid }> = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "portfolio", label: "Portfolio", icon: Wallet },
  { id: "prices", label: "Price log", icon: LineChart },
  { id: "signals", label: "Signals", icon: Bell },
  { id: "trading", label: "Trading", icon: Zap },
  { id: "settings", label: "Settings", icon: Settings }
];

export default function DashboardClient({
  data,
  syncMode = "direct",
  workerOnline = false
}: {
  data: DashboardData;
  syncMode?: "direct" | "remote";
  workerOnline?: boolean;
}) {
  const router = useRouter();
  const { dashboard, replaceDashboard } = useDashboardSnapshot(data);
  const [settings, setSettings] = useState(data.settings);
  const [mySignalPreference, setMySignalPreference] = useState(data.mySignalPreference);
  const [tradeSettings, setTradeSettings] = useState(data.tradeSettings);
  const [orderBusy, setOrderBusy] = useState<string | null>(null);
  const [askAiSymbol, setAskAiSymbol] = useState("");
  const [askAiBusy, setAskAiBusy] = useState(false);
  const [askAiAnswer, setAskAiAnswer] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "totalGainLoss",
    direction: "desc"
  });
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncConsoleOpen, setSyncConsoleOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>({
    active: false,
    startedAt: null,
    finishedAt: null,
    steps: [],
    error: null
  });
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [darkMode, setDarkMode] = useState(false);
  const [positiveDraft, setPositiveDraft] = useState(String(data.mySignalPreference.positivePercent));
  const [negativeDraft, setNegativeDraft] = useState(String(Math.abs(data.mySignalPreference.negativePercent)));
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [alertSort, setAlertSort] = useState<AlertSort>("desc");

  const portfolioRows = dashboard.portfolioPositions;
  const sortedPortfolioRows = useMemo(() => {
    return [...portfolioRows].sort((left, right) => {
      const leftValue = sortValue(left, sort.key);
      const rightValue = sortValue(right, sort.key);
      const direction = sort.direction === "asc" ? 1 : -1;
      if (typeof leftValue === "string" || typeof rightValue === "string") {
        return String(leftValue).localeCompare(String(rightValue)) * direction;
      }
      return (leftValue - rightValue) * direction;
    });
  }, [portfolioRows, sort]);

  const mySignalRows = useMemo(
    () => buildMySignalRows(portfolioRows, mySignalPreference),
    [portfolioRows, mySignalPreference]
  );

  const filteredAlertRows = useMemo(() => {
    let rows = [...mySignalRows];
    if (alertFilter !== "all") {
      rows = rows.filter((row) => row.type === alertFilter);
    }
    rows.sort((left, right) => {
      const direction = alertSort === "asc" ? 1 : -1;
      if (left.type !== right.type) {
        return left.type.localeCompare(right.type) * direction;
      }
      if (left.percent !== right.percent) {
        return (left.percent - right.percent) * direction;
      }
      return left.symbol.localeCompare(right.symbol) * direction;
    });
    return rows;
  }, [mySignalRows, alertFilter, alertSort]);

  const totalWorth = findSummaryMetric(dashboard.summaryMetrics, "TOTAL WORTH");
  const tradingCashBalance = findSummaryMetric(dashboard.summaryMetrics, "TRADING CASH BALANCE");
  const positionsUp = portfolioRows.filter((row) => row.totalGainLoss >= 0).length;
  const positionsDown = portfolioRows.filter((row) => row.totalGainLoss < 0).length;

  const totalValue =
    portfolioRows.reduce((sum, holding) => sum + holding.position * holding.lastPrice, 0) ||
    dashboard.holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const totalProfitLoss =
    portfolioRows.reduce((sum, holding) => sum + holding.totalGainLoss, 0) ||
    dashboard.holdings.reduce((sum, holding) => sum + holding.profitLoss, 0);
  const totalShares = portfolioRows.reduce((sum, holding) => sum + holding.position, 0);
  const positionCount = portfolioRows.filter((row) => row.position > 0).length || portfolioRows.length;
  const companyCount = new Set(portfolioRows.map((row) => row.symbol)).size || dashboard.holdings.length;
  const chartSymbol = dashboard.prices.at(-1)?.symbol;
  const chartData = chartSymbol ? dashboard.prices.filter((price) => price.symbol === chartSymbol) : [];
  const latestRun = dashboard.runs[0];
  const hasCachedData = hasLoadedDashboardData(dashboard);

  const allocationRows = useMemo(() => {
    const sourceTotal = portfolioRows.reduce((sum, row) => sum + row.position * row.lastPrice, 0);
    return portfolioRows
      .map((row, index) => {
        const value = row.position * row.lastPrice;
        return {
          ...row,
          color: PIE_COLORS[index % PIE_COLORS.length],
          percentage: sourceTotal ? (value / sourceTotal) * 100 : 0,
          value
        };
      })
      .filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value);
  }, [portfolioRows]);

  const gainersRows = useMemo(
    () =>
      [...portfolioRows]
        .filter((row) => row.totalGainLoss > 0)
        .sort((left, right) => right.totalGainLoss - left.totalGainLoss),
    [portfolioRows]
  );

  const losersRows = useMemo(
    () =>
      [...portfolioRows]
        .filter((row) => row.totalGainLoss < 0)
        .sort((left, right) => left.totalGainLoss - right.totalGainLoss),
    [portfolioRows]
  );

  const totalGainerProfit = useMemo(
    () => gainersRows.reduce((sum, row) => sum + row.totalGainLoss, 0),
    [gainersRows]
  );

  const totalLoserLoss = useMemo(
    () => losersRows.reduce((sum, row) => sum + row.totalGainLoss, 0),
    [losersRows]
  );

  useEffect(() => {
    const isDark = window.localStorage.getItem("tradr-theme") === "dark";
    setDarkMode(isDark);
    document.documentElement.classList.toggle("theme-dark", isDark);
  }, []);

  useEffect(() => {
    setPositiveDraft(String(mySignalPreference.positivePercent));
    setNegativeDraft(String(Math.abs(mySignalPreference.negativePercent)));
  }, [mySignalPreference.positivePercent, mySignalPreference.negativePercent]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  function toggleTheme() {
    setDarkMode((current) => {
      const next = !current;
      window.localStorage.setItem("tradr-theme", next ? "dark" : "light");
      document.documentElement.classList.toggle("theme-dark", next);
      return next;
    });
  }

  async function refreshDashboardData(): Promise<void> {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Dashboard refresh failed.");
    replaceDashboard(payload as DashboardData);
    setSettings(payload.settings);
  }

  async function fetchSyncProgress(): Promise<SyncProgressState> {
    const response = await fetch("/api/collect/progress", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not read sync progress.");
    }
    return (await response.json()) as SyncProgressState;
  }

  async function pollSyncProgress(syncing = syncBusy): Promise<void> {
    try {
      const payload = await fetchSyncProgress();
      setSyncProgress((current) => mergeSyncProgress(current, payload, syncing));
    } catch {
      // Ignore transient polling errors while sync continues.
    }
  }

  async function waitForLocalSync(): Promise<SyncProgressState> {
    const timeoutMs = 180_000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const progress = await fetchSyncProgress();
      setSyncProgress((current) => mergeSyncProgress(current, progress, true));
      if (progress.error) return progress;
      if (!progress.active && progress.finishedAt) return progress;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }

    throw new Error("Sync is taking longer than expected. Check the terminal for KTrade errors.");
  }

  async function refreshKTrade() {
    setSyncBusy(true);
    setSyncConsoleOpen(true);
    setSyncProgress(createInitialSyncProgress());
    let progressInterval: number | undefined;

    try {
      if (syncMode === "remote") {
        progressInterval = window.setInterval(() => void pollSyncProgress(true), 300);
        setMessage("Queuing sync on your PC...");
        const response = await fetch("/api/collect", { method: "POST" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Sync could not be queued.");

        if (!payload.workerOnline) {
          setMessage("Sync queued. Keep npm run sync-watcher running on your PC.");
        } else {
          setMessage("Sync queued — waiting for your PC...");
        }

        const requestedAt = Date.now();
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          const statusResponse = await fetch("/api/collect");
          const status = await statusResponse.json();
          const finishedAt = status.lastRun?.finishedAt ? new Date(status.lastRun.finishedAt).getTime() : 0;

          if (!status.pendingSyncAt && finishedAt >= requestedAt - 5000) {
            if (status.lastRun?.status === "success") {
              await refreshDashboardData();
              setMessage("Refresh complete.");
              router.refresh();
              return;
            }
            if (status.lastRun?.status === "failed") {
              throw new Error(status.lastRun.error ?? "Sync failed on your PC.");
            }
          }
        }

        setMessage("Sync still running on your PC — refresh this page in a minute.");
        return;
      }

      setMessage("Syncing KTrade data...");
      const response = await fetch("/api/collect", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Refresh blocked.");

      if (payload.progress) {
        setSyncProgress((current) => mergeSyncProgress(current, payload.progress as SyncProgressState, true));
      }

      progressInterval = window.setInterval(() => void pollSyncProgress(true), 300);
      const finalProgress = await waitForLocalSync();
      if (finalProgress.error) {
        throw new Error(finalProgress.error);
      }

      await refreshDashboardData();
      setMessage("Refresh complete.");
    } catch (error) {
      const errorMessage = formatSyncError(error instanceof Error ? error.message : String(error));
      setMessage(errorMessage);
      await pollSyncProgress(false);
      setSyncProgress((current) => ({
        ...current,
        error: errorMessage,
        active: false,
        finishedAt: current.finishedAt ?? new Date().toISOString()
      }));
    } finally {
      if (progressInterval !== undefined) {
        window.clearInterval(progressInterval);
      }
      setSyncBusy(false);
    }
  }

  async function saveMySignals() {
    const positive = parsePercentInput(positiveDraft);
    const negative = parsePercentInput(negativeDraft);
    if (positive === null || positive < 0.1) {
      setMessage("Sell threshold must be at least 0.1%.");
      return;
    }
    if (negative === null || negative < 0.1) {
      setMessage("Buy threshold must be at least 0.1%.");
      return;
    }

    const payload = {
      ...mySignalPreference,
      positivePercent: positive,
      negativePercent: -negative
    };

    setBusy(true);
    setMessage("Saving signal thresholds...");
    try {
      const response = await fetch("/api/my-signals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error ?? "Signal settings could not be saved.");
      setMySignalPreference(saved);
      setPositiveDraft(String(saved.positivePercent));
      setNegativeDraft(String(Math.abs(saved.negativePercent)));
      setMessage("Signal thresholds saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    setMessage("Saving collection settings...");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Settings could not be saved.");
      setSettings(payload);
      setMessage("Settings saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function toggleWeekday(day: number) {
    const next = settings.weekdays.includes(day)
      ? settings.weekdays.filter((value) => value !== day)
      : [...settings.weekdays, day];
    setSettings({ ...settings, weekdays: next.sort() });
  }

  function setSortKey(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
    }));
  }

  async function downloadPositionsPdf() {
    if (sortedPortfolioRows.length === 0) {
      setMessage("No portfolio data to download.");
      return;
    }
    const { downloadPortfolioPdf } = await import("@/src/lib/portfolio-pdf");
    downloadPortfolioPdf(sortedPortfolioRows);
  }

  async function decideOrder(id: string, action: "approve" | "reject") {
    setOrderBusy(id);
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not update order.");
      setMessage(action === "approve" ? "Order approved." : "Order rejected.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOrderBusy(null);
    }
  }

  async function askAi() {
    setAskAiBusy(true);
    setAskAiAnswer("");
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: askAiSymbol })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not reach the AI advisor.");
      setAskAiAnswer(payload.rationale ?? "No answer returned.");
    } catch (error) {
      setAskAiAnswer(error instanceof Error ? error.message : String(error));
    } finally {
      setAskAiBusy(false);
    }
  }

  async function saveTradeSettings() {
    setBusy(true);
    setMessage("Saving trading settings...");
    try {
      const response = await fetch("/api/trade-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tradeSettings)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Trading settings could not be saved.");
      setTradeSettings(payload);
      setMessage("Trading settings saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const toastClass = message.includes("complete") || message.includes("saved")
    ? "toast success"
    : message.includes("error") || message.includes("blocked") || message.includes("could not")
      ? "toast error"
      : "toast info";

  const tabTitles: Record<Tab, { title: string; sub: string }> = {
    overview: { title: "Overview", sub: "Portfolio snapshot and analytics" },
    portfolio: { title: "Portfolio", sub: `${positionCount} positions from KTrade` },
    prices: { title: "Price log", sub: "Daily closing prices by month" },
    signals: { title: "Signals", sub: "Custom alerts and technical events" },
    trading: { title: "Trading", sub: "Auto buy/sell orders and guardrails" },
    settings: { title: "Settings", sub: "Collection schedule and run history" }
  };

  const syncTitle =
    syncMode === "direct"
      ? "Refresh KTrade data"
      : workerOnline
        ? "Queue sync on your PC (sync-watcher must be running)"
        : "Queue sync — start npm run sync-watcher on your PC";

  const syncDisabled = syncBusy || !settings.manualRefreshEnabled;

  const tickerSignals = dashboard.signals;
  const showRemoteOfflineBanner = syncMode === "remote" && !workerOnline;
  const showRemoteSetupBanner = syncMode === "remote" && workerOnline && !hasCachedData;

  return (
    <div className="app">
      <div className="ambient" aria-hidden="true" />
      <SyncConsole progress={syncProgress} open={syncConsoleOpen} onClose={() => setSyncConsoleOpen(false)} />

      {/* Mobile header */}
      <header className="header">
        <div className="header-brand">
          <AppLogo size={32} className="header-logo" />
          <div>
            <p className="header-title">Tradr</p>
            <p className="header-sub">PSX · KTrade</p>
          </div>
        </div>
        <div className="header-actions">
          <span className={latestRun ? "status-dot" : "status-dot offline"}>
            {latestRun ? `${latestRun.status}` : "Idle"}
          </span>
          <button
            className="btn btn-accent btn-sm"
            disabled={syncDisabled}
            onClick={refreshKTrade}
            title={syncTitle}
          >
            <RefreshCw size={14} className={syncBusy ? "spin" : undefined} />
            <span>{syncBusy ? "…" : "Sync"}</span>
          </button>
          <button className="btn btn-icon btn-ghost" onClick={toggleTheme} title="Toggle theme" type="button">
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <div className="shell-body">
        {/* Desktop header */}
        <div className="desktop-header">
          <div>
            <h1>{tabTitles[tab].title}</h1>
            {tab === "portfolio" ? (
              <p className="portfolio-sub">
                <span>{positionCount} positions from KTrade</span>
                <span className="positive"> · {positionsUp} up</span>
                <span className="negative"> · {positionsDown} down</span>
              </p>
            ) : (
              <p>{tabTitles[tab].sub}</p>
            )}
          </div>
          <div className="header-actions">
            <span className={latestRun ? "status-dot" : "status-dot offline"}>
              {latestRun ? `${latestRun.status} · ${latestRun.quoteCount} quotes` : "No runs yet"}
            </span>
            <button
              className="btn btn-accent"
              disabled={syncDisabled}
              onClick={refreshKTrade}
              title={syncTitle}
            >
              <RefreshCw size={15} className={syncBusy ? "spin" : undefined} />
              <span>{syncBusy ? "Syncing…" : "Sync KTrade"}</span>
            </button>
            <button className="btn btn-icon btn-ghost" onClick={toggleTheme} type="button">
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>

        {showRemoteOfflineBanner ? (
          <div className="live-sync-banner live-sync-banner-warn" role="status">
            <strong>PC offline</strong>
            <span>
              Your PC is not running <code>npm run sync-watcher</code>. Showing last synced data until it reconnects.
            </span>
          </div>
        ) : null}

        {showRemoteSetupBanner ? (
          <div className="live-sync-banner" role="status">
            <strong>First sync</strong>
            <span>
              Keep <code>npm run sync-watcher</code> running on your PC, then press Sync to load portfolio data.
            </span>
          </div>
        ) : null}

        <main className="main">
          {tab === "overview" ? (
            <div className="panel-view">
              {tickerSignals.length > 0 ? (
                <div className="signal-ticker" aria-label="Technical signals ticker">
                  <div className="signal-ticker-label">Signals</div>
                  <div className="signal-ticker-viewport">
                    <div className="signal-ticker-track">
                      {[...tickerSignals, ...tickerSignals].map((signal, index) => (
                        <span className="signal-ticker-item" key={`${signal.symbol}-${signal.createdAt}-${index}`}>
                          <TickerSignalLine signal={signal} />
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="overview-top">
                <section className="hero">
                  <p className="hero-label">Total portfolio value</p>
                  <p className="hero-value">{formatMoney(totalValue)}</p>
                  <div className="hero-meta">
                    <span>{companyCount} holdings · {formatNumber(totalShares)} shares</span>
                    <span className={`hero-pl ${totalProfitLoss >= 0 ? "positive" : "negative"}`}>
                      {totalProfitLoss >= 0 ? "+" : ""}{formatMoney(totalProfitLoss)} P/L
                    </span>
                  </div>
                </section>

                <div className="stat-grid stat-grid-six">
                  <div className="stat stat-positions">
                    <span className="stat-label">Positions</span>
                    <strong className="stat-value">{positionCount}</strong>
                    <p className="stat-hint">{positionCount === 1 ? "1 company" : `${positionCount} companies`}</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Total P/L</span>
                    <strong className={`stat-value ${totalProfitLoss >= 0 ? "positive" : "negative"}`}>
                      {formatMoney(totalProfitLoss)}
                    </strong>
                    <p className="stat-hint">vs avg buy</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Shares</span>
                    <strong className="stat-value">{formatNumber(totalShares)}</strong>
                    <p className="stat-hint">total held</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Signals</span>
                    <strong className="stat-value">{dashboard.signals.length + mySignalRows.length}</strong>
                    <p className="stat-hint">active alerts</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Total worth</span>
                    <strong className="stat-value">{totalWorth !== undefined ? formatMoney(totalWorth) : "—"}</strong>
                    <p className="stat-hint">KTrade summary</p>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Trading cash</span>
                    <strong className="stat-value">{tradingCashBalance !== undefined ? formatMoney(tradingCashBalance) : "—"}</strong>
                    <p className="stat-hint">cash balance</p>
                  </div>
                </div>
              </div>

              <div className="overview-layout">
                <OverviewCharts
                  chartSymbol={chartSymbol}
                  chartData={chartData}
                  allocationRows={allocationRows}
                  darkMode={darkMode}
                />

                <div className="card trade-alerts-card">
                  <div className="card-head">
                    <div>
                      <h2>Trade alerts</h2>
                      <p>
                        {mySignalPreference.enabled
                          ? `Sell +${mySignalPreference.positivePercent}% · Buy −${Math.abs(mySignalPreference.negativePercent)}%`
                          : "Enable thresholds in Signals tab"}
                      </p>
                    </div>
                    <Bell size={16} style={{ color: "var(--fg-subtle)" }} />
                  </div>
                  <div className="card-body">
                    <div className="alert-toolbar">
                      <div className="filter-group">
                        {(["all", "buy", "sell"] as AlertFilter[]).map((filter) => (
                          <button
                            className={alertFilter === filter ? "filter-btn active" : "filter-btn"}
                            key={filter}
                            onClick={() => setAlertFilter(filter)}
                            type="button"
                          >
                            {filter === "all" ? "All" : filter === "buy" ? "Buy" : "Sell"}
                          </button>
                        ))}
                      </div>
                      <div className="filter-group">
                        <button
                          className={alertSort === "asc" ? "filter-btn active" : "filter-btn"}
                          onClick={() => setAlertSort("asc")}
                          type="button"
                        >
                          Asc
                        </button>
                        <button
                          className={alertSort === "desc" ? "filter-btn active" : "filter-btn"}
                          onClick={() => setAlertSort("desc")}
                          type="button"
                        >
                          Desc
                        </button>
                      </div>
                    </div>
                    <div className="alert-feed">
                      {filteredAlertRows.length > 0 ? (
                        filteredAlertRows.map((signal) => (
                          <div className="signal-item" key={`${signal.symbol}-${signal.type}`}>
                            <span className={`signal-tag ${signal.type}`}>{signal.type}</span>
                            <div className="signal-body">
                              <strong>{signal.symbol}</strong>
                              <span>{signal.message}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty-state">
                          {mySignalPreference.enabled
                            ? alertFilter === "all"
                              ? "No positions meet your buy/sell thresholds."
                              : `No ${alertFilter} alerts match your thresholds.`
                            : "Turn on custom alerts in the Signals tab."}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="overview-gainers-losers">
                <OverviewSplitTable
                  title="Gainers"
                  subtitle="Above purchase price"
                  rows={gainersRows}
                  totalLabel="Total profit"
                  totalValue={totalGainerProfit}
                  tone="positive"
                  emptyMessage="No gainers right now."
                />
                <OverviewSplitTable
                  title="Losers"
                  subtitle="Below purchase price"
                  rows={losersRows}
                  totalLabel="Total loss"
                  totalValue={totalLoserLoss}
                  tone="negative"
                  emptyMessage="No losers right now."
                />
              </div>
            </div>
          ) : null}

          {tab === "portfolio" ? (
            <div className="panel-view">
              <div className="position-list">
                {sortedPortfolioRows.map((row, index) => (
                  <article className="position-card" key={row.symbol}>
                    <div className="position-top">
                      <div>
                        <div className="position-symbol">
                          #{index + 1}{" "}
                          <span className="symbol-tip" title={row.name || row.symbol}>
                            {row.symbol}
                          </span>
                        </div>
                        <div className="position-name">{row.name || row.market}</div>
                      </div>
                      <div className="position-pl">
                        <span className={row.totalGainLoss >= 0 ? "positive" : "negative"}>
                          {formatMoney(row.totalGainLoss)}
                        </span>
                        <small className={gainPercent(row) >= 0 ? "positive" : "negative"}>
                          {gainPercent(row).toFixed(2)}%
                        </small>
                      </div>
                    </div>
                    <dl className="position-grid">
                      <div className="position-stat">
                        <dt>Qty</dt>
                        <dd>{formatNumber(row.position)}</dd>
                      </div>
                      <div className="position-stat">
                        <dt>Last</dt>
                        <dd>{formatMoney(row.lastPrice)}</dd>
                      </div>
                      <div className="position-stat">
                        <dt>Today</dt>
                        <dd className={row.todayGainLoss >= 0 ? "positive" : "negative"}>
                          {formatMoney(row.todayGainLoss)}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
                {portfolioRows.length === 0 ? (
                  <div className="empty-state">No positions yet. Tap Sync to fetch KTrade data.</div>
                ) : null}
              </div>

              <div className="card table-desktop">
                <div className="card-head">
                  <div>
                    <h2>All positions</h2>
                    <p>Sortable custody data from KTrade</p>
                  </div>
                  <div className="card-head-actions">
                    <button
                      className="btn btn-icon btn-ghost"
                      disabled={portfolioRows.length === 0}
                      onClick={downloadPositionsPdf}
                      title="Download PDF"
                      type="button"
                    >
                      <Download size={16} />
                    </button>
                    <TrendingUp size={16} style={{ color: "var(--fg-subtle)" }} />
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th><button className="sort-btn" onClick={() => setSortKey("symbol")}>Symbol</button></th>
                        <th>Business</th>
                        <th><button className="sort-btn" onClick={() => setSortKey("market")}>Market</button></th>
                        <th><button className="sort-btn" onClick={() => setSortKey("position")}>Qty</button></th>
                        <th><button className="sort-btn" onClick={() => setSortKey("purchasePrice")}>Buy</button></th>
                        <th><button className="sort-btn" onClick={() => setSortKey("lastPrice")}>Last</button></th>
                        <th><button className="sort-btn" onClick={() => setSortKey("todayGainLoss")}>Today</button></th>
                        <th><button className="sort-btn" onClick={() => setSortKey("totalGainLoss")}>Total</button></th>
                        <th><button className="sort-btn" onClick={() => setSortKey("gainPercent")}>%</button></th>
                        <th><button className="sort-btn" onClick={() => setSortKey("change")}>Chg</button></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPortfolioRows.map((row, index) => (
                        <tr key={row.symbol}>
                          <td className="row-num">{index + 1}</td>
                          <td>
                            <strong className="symbol-tip" title={row.name || row.symbol}>
                              {row.symbol}
                            </strong>
                          </td>
                          <td>{row.name || "—"}</td>
                          <td>{row.market}</td>
                          <td>{formatNumber(row.position)}</td>
                          <td>{formatMoney(row.purchasePrice)}</td>
                          <td>{formatMoney(row.lastPrice)}</td>
                          <td className={plClass(row.todayGainLoss)}>{formatSignedMoney(row.todayGainLoss)}</td>
                          <td className={plClass(row.totalGainLoss)}>{formatSignedMoney(row.totalGainLoss)}</td>
                          <td className={plClass(gainPercent(row))}>{formatSignedPercent(gainPercent(row))}</td>
                          <td className={plClass(row.change)}>{formatSignedNumber(row.change)}</td>
                        </tr>
                      ))}
                      {portfolioRows.length === 0 ? (
                        <tr>
                          <td colSpan={11}>No portfolio data. Sync to fetch from KTrade.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "prices" ? <PriceLogView entries={dashboard.priceLog} darkMode={darkMode} /> : null}

          {tab === "signals" ? (
            <div className="panel-view">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>My signals</h2>
                    <p>Custom profit and buy-back thresholds</p>
                  </div>
                </div>
                <div className="card-body">
                  <div className="form-stack">
                    <label className="toggle">
                      <input
                        checked={mySignalPreference.enabled}
                        onChange={(event) => setMySignalPreference({ ...mySignalPreference, enabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Enable custom alerts</span>
                    </label>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">Sell at +%</span>
                        <input
                          className="field-input"
                          inputMode="decimal"
                          placeholder="e.g. 10"
                          type="text"
                          value={positiveDraft}
                          onChange={(event) => setPositiveDraft(sanitizePercentInput(event.target.value))}
                          onBlur={() => {
                            const parsed = parsePercentInput(positiveDraft);
                            if (parsed !== null && parsed >= 0.1) {
                              setMySignalPreference({ ...mySignalPreference, positivePercent: parsed });
                              setPositiveDraft(String(parsed));
                            } else {
                              setPositiveDraft(String(mySignalPreference.positivePercent));
                            }
                          }}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Buy at −%</span>
                        <input
                          className="field-input"
                          inputMode="decimal"
                          placeholder="e.g. 5"
                          type="text"
                          value={negativeDraft}
                          onChange={(event) => setNegativeDraft(sanitizePercentInput(event.target.value))}
                          onBlur={() => {
                            const parsed = parsePercentInput(negativeDraft);
                            if (parsed !== null && parsed >= 0.1) {
                              setMySignalPreference({ ...mySignalPreference, negativePercent: -parsed });
                              setNegativeDraft(String(parsed));
                            } else {
                              setNegativeDraft(String(Math.abs(mySignalPreference.negativePercent)));
                            }
                          }}
                        />
                      </label>
                    </div>
                    <button className="btn btn-accent" disabled={busy} onClick={saveMySignals}>
                      <Save size={14} />
                      <span>Save thresholds</span>
                    </button>
                  </div>
                  <div className="section-divider" style={{ margin: "14px 0" }} />
                  <div className="signal-feed">
                    {mySignalRows.map((signal) => (
                      <div className="signal-item" key={`${signal.symbol}-${signal.type}`}>
                        <span className={`signal-tag ${signal.type}`}>{signal.type}</span>
                        <div className="signal-body">
                          <strong>{signal.symbol}</strong>
                          <span>{signal.message}</span>
                        </div>
                      </div>
                    ))}
                    {mySignalRows.length === 0 ? (
                      <div className="empty-state">No positions meet your thresholds.</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Technical signals</h2>
                    <p>SMA, RSI, MACD, and price events</p>
                  </div>
                </div>
                <div className="card-body">
                  <div className="signal-feed">
                    {dashboard.signals.map((signal) => (
                      <div className="signal-item" key={`${signal.symbol}-${signal.createdAt}-${signal.type}`}>
                        <span className={`signal-tag ${signalSideClass(signal.side)}`}>{signal.side}</span>
                        <div className="signal-body">
                          <strong>{signal.symbol} · {signal.score}</strong>
                          <span>{signal.message}</span>
                        </div>
                      </div>
                    ))}
                    {dashboard.signals.length === 0 ? (
                      <div className="empty-state">No technical signals yet.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "trading" ? (
            <div className="panel-view">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Auto-trade</h2>
                    <p>Turns your +/- % thresholds into buy/sell orders with hard limits</p>
                  </div>
                </div>
                <div className="card-body">
                  <div className="form-stack">
                    <label className="toggle">
                      <input
                        checked={tradeSettings.enabled}
                        onChange={(event) => setTradeSettings({ ...tradeSettings, enabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Enable auto-trade engine</span>
                    </label>
                    <label className="toggle">
                      <input
                        checked={tradeSettings.autoApprove}
                        onChange={(event) => setTradeSettings({ ...tradeSettings, autoApprove: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Auto-approve orders (skip manual confirm)</span>
                    </label>
                    <label className="toggle">
                      <input
                        checked={tradeSettings.liveExecution}
                        onChange={(event) => setTradeSettings({ ...tradeSettings, liveExecution: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Place live orders with KTrade (requires AUTO_TRADE_LIVE env var too)</span>
                    </label>
                    <label className="toggle">
                      <input
                        checked={tradeSettings.aiAdvisorEnabled}
                        onChange={(event) => setTradeSettings({ ...tradeSettings, aiAdvisorEnabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>AI advisor (second opinion on every proposal; pauses auto-approve if it disagrees)</span>
                    </label>
                    <label className="field">
                      <span className="field-label">Trading horizon</span>
                      <select
                        className="field-input"
                        onChange={(event) => setTradeSettings({ ...tradeSettings, horizon: event.target.value })}
                        value={tradeSettings.horizon}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">Sell portion (%)</span>
                        <input
                          className="field-input"
                          max={100}
                          min={1}
                          onChange={(event) => setTradeSettings({ ...tradeSettings, sellPortionPercent: Number(event.target.value) })}
                          type="number"
                          value={tradeSettings.sellPortionPercent}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Buy order value (PKR)</span>
                        <input
                          className="field-input"
                          min={0}
                          onChange={(event) => setTradeSettings({ ...tradeSettings, buyOrderValue: Number(event.target.value) })}
                          type="number"
                          value={tradeSettings.buyOrderValue}
                        />
                      </label>
                    </div>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">Max order value (PKR)</span>
                        <input
                          className="field-input"
                          min={1000}
                          onChange={(event) => setTradeSettings({ ...tradeSettings, maxOrderValue: Number(event.target.value) })}
                          type="number"
                          value={tradeSettings.maxOrderValue}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Max orders / day</span>
                        <input
                          className="field-input"
                          max={50}
                          min={1}
                          onChange={(event) => setTradeSettings({ ...tradeSettings, maxOrdersPerDay: Number(event.target.value) })}
                          type="number"
                          value={tradeSettings.maxOrdersPerDay}
                        />
                      </label>
                    </div>
                    <button className="btn btn-accent" disabled={busy} onClick={saveTradeSettings}>
                      <Save size={14} />
                      <span>Save trading settings</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Orders</h2>
                    <p>Proposed, approved, and placed orders — most recent first</p>
                  </div>
                  <Zap size={16} style={{ color: "var(--fg-subtle)" }} />
                </div>
                <div className="card-body">
                  <div className="signal-feed">
                    {dashboard.orders.map((order) => (
                      <div className="signal-item" key={order.id}>
                        <span className={`signal-tag ${order.side === "sell" ? "sell" : "buy"}`}>{order.side}</span>
                        <div className="signal-body">
                          <strong>
                            {order.symbol} · {formatNumber(order.quantity)} @ {order.limitPrice ? formatMoney(order.limitPrice) : "mkt"}
                          </strong>
                          <span>{order.reason}</span>
                          {order.aiRationale ? (
                            <span className="ai-rationale">
                              AI ({order.aiSide}, {order.aiConfidence}% confidence): {order.aiRationale}
                            </span>
                          ) : null}
                          <span className="order-meta">
                            {order.status} · {order.mode} · {new Date(order.proposedAt).toLocaleString()}
                            {order.detail ? ` · ${order.detail}` : ""}
                          </span>
                        </div>
                        {order.status === "proposed" ? (
                          <div className="order-actions">
                            <button
                              className="btn btn-sm btn-accent"
                              disabled={orderBusy === order.id}
                              onClick={() => decideOrder(order.id, "approve")}
                              type="button"
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              disabled={orderBusy === order.id}
                              onClick={() => decideOrder(order.id, "reject")}
                              type="button"
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {dashboard.orders.length === 0 ? (
                      <div className="empty-state">No orders yet. They appear here once a position crosses your +/- % thresholds.</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>AI opinions</h2>
                    <p>Broader advisor read on watched symbols — advisory only, not trade triggers</p>
                  </div>
                </div>
                <div className="card-body">
                  <div className="ask-ai-row">
                    <input
                      className="field-input"
                      onChange={(event) => setAskAiSymbol(event.target.value.toUpperCase())}
                      placeholder="Ask about a symbol, e.g. MEBL"
                      type="text"
                      value={askAiSymbol}
                    />
                    <button className="btn btn-accent btn-sm" disabled={askAiBusy || !askAiSymbol} onClick={askAi} type="button">
                      {askAiBusy ? "Asking…" : "Ask AI"}
                    </button>
                  </div>
                  {askAiAnswer ? <div className="ai-answer">{askAiAnswer}</div> : null}
                  <div className="signal-feed">
                    {dashboard.recommendations.map((rec, index) => (
                      <div className="signal-item" key={`${rec.symbol}-${index}`}>
                        <span className={`signal-tag ${rec.side === "sell" ? "sell" : rec.side === "buy" ? "buy" : "watch"}`}>
                          {rec.side}
                        </span>
                        <div className="signal-body">
                          <strong>
                            {rec.symbol} · {rec.confidence}% confidence · {rec.horizon}
                          </strong>
                          <span>{rec.rationale}</span>
                          <span className="order-meta">{new Date(rec.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                    {dashboard.recommendations.length === 0 ? (
                      <div className="empty-state">
                        No AI opinions yet. Set GEMINI_API_KEY locally and enable the AI advisor to start seeing these.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "settings" ? (
            <div className="panel-view">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Collection</h2>
                    <p>{settings.scheduledEnabled ? "Automatic schedule active" : "Manual refresh only"}</p>
                  </div>
                </div>
                <div className="card-body">
                  <div className="form-stack">
                    <label className="toggle">
                      <input
                        checked={settings.manualRefreshEnabled}
                        onChange={(event) => setSettings({ ...settings, manualRefreshEnabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Allow manual sync</span>
                    </label>
                    <label className="toggle">
                      <input
                        checked={settings.scheduledEnabled}
                        onChange={(event) => setSettings({ ...settings, scheduledEnabled: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Enable scheduled collection</span>
                    </label>
                    <label className="field">
                      <span className="field-label">Interval (minutes)</span>
                      <input
                        className="field-input"
                        max={240}
                        min={1}
                        onChange={(event) => setSettings({ ...settings, intervalMinutes: Number(event.target.value) })}
                        type="number"
                        value={settings.intervalMinutes}
                      />
                    </label>
                    <div className="field-row">
                      <label className="field">
                        <span className="field-label">Start</span>
                        <input
                          className="field-input"
                          type="time"
                          value={settings.startTime}
                          onChange={(event) => setSettings({ ...settings, startTime: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">End</span>
                        <input
                          className="field-input"
                          type="time"
                          value={settings.endTime}
                          onChange={(event) => setSettings({ ...settings, endTime: event.target.value })}
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span className="field-label">Timezone</span>
                      <input
                        className="field-input"
                        value={settings.timezone}
                        onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
                      />
                    </label>
                    <div>
                      <span className="field-label">Active days</span>
                      <div className="day-picker" style={{ marginTop: 6 }}>
                        {WEEKDAYS.map((day) => (
                          <button
                            className={settings.weekdays.includes(day.value) ? "day-btn on" : "day-btn"}
                            key={day.value}
                            onClick={() => toggleWeekday(day.value)}
                            type="button"
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button className="btn btn-accent" disabled={busy} onClick={saveSettings}>
                      <Save size={14} />
                      <span>Save settings</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Run history</h2>
                    <p>Manual and scheduled job status</p>
                  </div>
                  <RefreshCw size={16} style={{ color: "var(--fg-subtle)" }} />
                </div>
                <div className="card-body">
                  <div className="run-log">
                    {dashboard.runs.map((run) => (
                      <div className="run-entry" key={run.startedAt}>
                        <strong>{run.status}</strong>
                        <span>{new Date(run.startedAt).toLocaleString()} · {run.quoteCount} quotes</span>
                        {run.error ? <span className="negative">{run.error}</span> : null}
                      </div>
                    ))}
                    {dashboard.runs.length === 0 ? (
                      <div className="empty-state">No collection runs yet.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {/* Navigation */}
      <nav className="nav" aria-label="Main navigation">
        <div className="nav-logo" aria-hidden="true">
          <AppLogo size={36} />
        </div>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "nav-item active" : "nav-item"}
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            type="button"
          >
            <Icon size={20} strokeWidth={tab === id ? 2.2 : 1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {message && !syncConsoleOpen ? <div className={toastClass} role="status">{message}</div> : null}
    </div>
  );
}

function OverviewSplitTable({
  title,
  subtitle,
  rows,
  totalLabel,
  totalValue,
  tone,
  emptyMessage
}: {
  title: string;
  subtitle: string;
  rows: DashboardData["portfolioPositions"];
  totalLabel: string;
  totalValue: number;
  tone: "positive" | "negative";
  emptyMessage: string;
}) {
  return (
    <div className="card overview-split-table">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <TrendingUp size={16} style={{ color: tone === "positive" ? "var(--positive)" : "var(--negative)" }} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th>Qty</th>
              <th>Buy</th>
              <th>Last</th>
              <th>Total</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.symbol}>
                <td className="row-num">{index + 1}</td>
                <td>
                  <strong className="symbol-tip" title={row.name || row.symbol}>
                    {row.symbol}
                  </strong>
                </td>
                <td>{formatNumber(row.position)}</td>
                <td>{formatMoney(row.purchasePrice)}</td>
                <td>{formatMoney(row.lastPrice)}</td>
                <td className={plClass(row.totalGainLoss)}>{formatSignedMoney(row.totalGainLoss)}</td>
                <td className={plClass(gainPercent(row))}>{formatSignedPercent(gainPercent(row))}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>{emptyMessage}</td>
              </tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr className="overview-table-total">
                <td colSpan={5}>{totalLabel}</td>
                <td className={tone}>{formatSignedMoney(totalValue)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function signalSideClass(side: string): string {
  if (side === "sell") return "sell";
  if (side === "buy") return "buy";
  return "watch";
}

function tickerNumberTone(signal: DashboardData["signals"][number]): "sell" | "buy" | "average" | "neutral" {
  if (/consider averaging/i.test(signal.message)) return "average";
  if (signal.side === "sell") return "sell";
  if (signal.side === "buy") return "buy";
  return "neutral";
}

function highlightTickerNumbers(text: string, tone: "sell" | "buy" | "average" | "neutral") {
  const numClass =
    tone === "sell"
      ? "ticker-num ticker-num-sell"
      : tone === "buy"
        ? "ticker-num ticker-num-buy"
        : tone === "average"
          ? "ticker-num ticker-num-avg"
          : "ticker-num";

  return text.split(/(-?\d+(?:\.\d+)?%?)/g).map((part, index) => {
    if (/^-?\d+(?:\.\d+)?%?$/.test(part)) {
      return (
        <span className={numClass} key={`${part}-${index}`}>
          {part}
        </span>
      );
    }
    return part;
  });
}

function TickerSignalLine({ signal }: { signal: DashboardData["signals"][number] }) {
  const tone = tickerNumberTone(signal);
  return (
    <>
      <strong className="ticker-symbol">{signal.symbol}</strong>
      <span className="ticker-sep"> · </span>
      <span>{signal.side}</span>
      <span className="ticker-sep"> · </span>
      <span>{highlightTickerNumbers(signal.message, tone)}</span>
    </>
  );
}

function plClass(value: number): string {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatSignedMoney(value: number): string {
  if (value > 0) return `+${formatMoney(value)}`;
  return formatMoney(value);
}

function formatSignedPercent(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}%`;
  if (value < 0) return `${value.toFixed(2)}%`;
  return `${value.toFixed(2)}%`;
}

function formatSignedNumber(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}`;
  if (value < 0) return value.toFixed(2);
  return value.toFixed(2);
}

function findSummaryMetric(metrics: DashboardData["summaryMetrics"], label: string): number | undefined {
  const match = metrics.find((metric) => metric.label.toUpperCase() === label.toUpperCase());
  return match?.value;
}

function parsePercentInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizePercentInput(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2
  }).format(value || 0);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(value || 0);
}

function gainPercent(row: { purchasePrice: number; lastPrice: number }): number {
  if (!row.purchasePrice) return 0;
  return ((row.lastPrice - row.purchasePrice) / row.purchasePrice) * 100;
}

function sortValue(row: DashboardData["portfolioPositions"][number], key: SortKey): number | string {
  if (key === "gainPercent") return gainPercent(row);
  return row[key];
}

function buildMySignalRows(
  rows: DashboardData["portfolioPositions"],
  preference: MySignalPreference
): Array<{ symbol: string; type: string; message: string; percent: number }> {
  if (!preference.enabled) return [];
  const positive = Math.abs(preference.positivePercent);
  const negative = -Math.abs(preference.negativePercent);

  return rows.flatMap((row) => {
    const percent = gainPercent(row);
    if (percent >= positive) {
      return [
        {
          symbol: row.symbol,
          type: "sell",
          percent,
          message: `Up ${percent.toFixed(2)}% from ${formatMoney(row.purchasePrice)} buy.`
        }
      ];
    }
    if (percent <= negative) {
      return [
        {
          symbol: row.symbol,
          type: "buy",
          percent,
          message: `Down ${percent.toFixed(2)}% from ${formatMoney(row.purchasePrice)} buy.`
        }
      ];
    }
    return [];
  });
}
