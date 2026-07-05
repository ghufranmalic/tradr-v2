"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { PriceLogEntry } from "@/src/ui/DashboardClient";

type MonthDay = {
  date: string;
  dayNumber: number;
  dayLabel: string;
  close: number | null;
};

type MonthWeek = {
  id: string;
  label: string;
  rangeLabel: string;
  days: MonthDay[];
  loggedCount: number;
};

type PriceLogViewProps = {
  entries: PriceLogEntry[];
  darkMode: boolean;
};

export default function PriceLogView({ entries, darkMode }: PriceLogViewProps) {
  const monthOptions = useMemo(() => buildMonthOptions(entries), [entries]);
  const [selectedMonth, setSelectedMonth] = useState(() => monthOptions[0] ?? currentMonthKey());

  const chartTheme = darkMode
    ? { grid: "rgba(255,255,255,0.08)", tick: "#a8adc4", stroke: "#4d94ff", buy: "#34d399", tooltipBg: "#12121c", tooltipFg: "#eef0f8", tooltipBorder: "rgba(255,255,255,0.1)" }
    : { grid: "rgba(10,11,16,0.06)", tick: "#5c6178", stroke: "#0066ff", buy: "#00a86b", tooltipBg: "#ffffff", tooltipFg: "#0a0b10", tooltipBorder: "rgba(10,11,16,0.1)" };

  if (entries.length === 0) {
    return <div className="empty-state">No holdings yet. Sync to start logging daily prices.</div>;
  }

  return (
    <div className="panel-view price-log-view">
      <div className="price-log-toolbar card">
        <div>
          <h2>Daily price log</h2>
          <p>Each sync saves the last fetched price for that calendar day.</p>
        </div>
        <label className="field price-log-month-field">
          <span className="field-label">Month</span>
          <select className="field-input" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {formatMonthLabel(month)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {entries.map((entry) => (
        <PriceLogCard entry={entry} key={entry.symbol} month={selectedMonth} theme={chartTheme} />
      ))}
    </div>
  );
}

function PriceLogCard({
  entry,
  month,
  theme
}: {
  entry: PriceLogEntry;
  month: string;
  theme: {
    grid: string;
    tick: string;
    stroke: string;
    buy: string;
    tooltipBg: string;
    tooltipFg: string;
    tooltipBorder: string;
  };
}) {
  const monthDays = useMemo(() => buildMonthDays(entry.dailyPrices, month), [entry.dailyPrices, month]);
  const weeks = useMemo(() => buildMonthWeeks(monthDays), [monthDays]);
  const chartRows = monthDays.filter((day) => day.close !== null);
  const loggedDays = chartRows.length;

  return (
    <article className="card price-log-card">
      <div className="card-head">
        <div>
          <h2>{entry.symbol}</h2>
          <p>{entry.name || "—"} · Buy {formatMoney(entry.purchasePrice)}</p>
        </div>
        <span className="price-log-count">{loggedDays} day{loggedDays === 1 ? "" : "s"} logged</span>
      </div>

      <div className="price-log-chart">
        {chartRows.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="dayLabel" tick={{ fontSize: 10, fill: theme.tick }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: theme.tick }} width={52} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: theme.tooltipBg, color: theme.tooltipFg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8, fontSize: 12 }}
                formatter={(value: number) => [formatMoney(value), "Close"]}
                labelFormatter={(label) => `Day ${label}`}
              />
              <ReferenceLine y={entry.purchasePrice} stroke={theme.buy} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="close" stroke={theme.stroke} strokeWidth={1.8} dot={{ r: 2 }} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">No prices logged for {formatMonthLabel(month)} yet.</div>
        )}
      </div>

      <details className="price-log-weeks">
        <summary className="price-log-weeks-summary">
          <span>Weekly prices · {weeks.length} weeks</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="price-log-weeks-body">
          {weeks.map((week) => (
            <details className="price-log-week" key={`${entry.symbol}-${week.id}`}>
              <summary className="price-log-week-summary">
                <span>
                  {week.label} · {week.rangeLabel}
                </span>
                <span className="price-log-week-meta">
                  {week.loggedCount} logged
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </summary>
              <div className="table-wrap price-log-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Close</th>
                      <th>vs Buy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {week.days.map((day) => {
                      const delta = day.close === null ? null : day.close - entry.purchasePrice;
                      return (
                        <tr key={day.date}>
                          <td>{formatDayDate(day.date)}</td>
                          <td>{day.close === null ? "—" : formatMoney(day.close)}</td>
                          <td className={delta === null ? "neutral" : delta >= 0 ? "positive" : "negative"}>
                            {delta === null ? "—" : formatSignedMoney(delta)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </details>
    </article>
  );
}

function buildMonthWeeks(monthDays: MonthDay[]): MonthWeek[] {
  const weekRanges = [
    { id: "w1", label: "Week 1", start: 1, end: 7 },
    { id: "w2", label: "Week 2", start: 8, end: 14 },
    { id: "w3", label: "Week 3", start: 15, end: 21 },
    { id: "w4", label: "Week 4", start: 22, end: 31 }
  ];

  return weekRanges.map((range) => {
    const days = monthDays.filter((day) => day.dayNumber >= range.start && day.dayNumber <= range.end);
    const lastDay = days.at(-1)?.dayNumber ?? range.end;
    const rangeLabel = `${range.start}–${Math.min(range.end, lastDay)}`;

    return {
      id: range.id,
      label: range.label,
      rangeLabel,
      days,
      loggedCount: days.filter((day) => day.close !== null).length
    };
  });
}

function buildMonthOptions(entries: PriceLogEntry[]): string[] {
  const months = new Set<string>([currentMonthKey()]);
  for (const entry of entries) {
    for (const price of entry.dailyPrices) {
      months.add(price.date.slice(0, 7));
    }
  }
  return Array.from(months).sort((left, right) => right.localeCompare(left));
}

function buildMonthDays(dailyPrices: Array<{ date: string; close: number }>, month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const byDate = new Map(dailyPrices.map((price) => [price.date, price.close]));

  return Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${month}-${String(dayNumber).padStart(2, "0")}`;
    const close = byDate.get(date) ?? null;
    return {
      date,
      dayNumber,
      dayLabel: String(dayNumber),
      close
    };
  });
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [yearText, monthText] = month.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1, 1);
  return new Intl.DateTimeFormat("en-PK", { month: "long", year: "numeric" }).format(date);
}

function formatDayDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat("en-PK", { day: "numeric", month: "short" }).format(parsed);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 2 }).format(value);
}

function formatSignedMoney(value: number): string {
  if (value > 0) return `+${formatMoney(value)}`;
  return formatMoney(value);
}
