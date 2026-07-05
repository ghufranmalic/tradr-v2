"use client";

import { Activity, BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type AllocationRow = {
  symbol: string;
  position: number;
  purchasePrice: number;
  lastPrice: number;
  percentage: number;
  value: number;
  color: string;
};

export default function OverviewCharts({
  chartSymbol,
  chartData,
  allocationRows,
  darkMode
}: {
  chartSymbol?: string;
  chartData: Array<{ date: string; close: number }>;
  allocationRows: AllocationRow[];
  darkMode: boolean;
}) {
  const chartTheme = darkMode
    ? { grid: "rgba(255,255,255,0.08)", tick: "#a8adc4", stroke: "#4d94ff", fillStart: "#4d94ff", fillEnd: "#060608", tooltipBg: "#12121c", tooltipFg: "#eef0f8", tooltipBorder: "rgba(255,255,255,0.1)" }
    : { grid: "rgba(10,11,16,0.06)", tick: "#5c6178", stroke: "#0066ff", fillStart: "#0066ff", fillEnd: "#f8f9fc", tooltipBg: "#ffffff", tooltipFg: "#0a0b10", tooltipBorder: "rgba(10,11,16,0.1)" };

  return (
    <>
      <div className="card chart-card-narrow">
        <div className="card-head">
          <div>
            <h2>{chartSymbol ? `${chartSymbol} price` : "Price history"}</h2>
            <p>Daily close snapshots</p>
          </div>
          <Activity size={16} style={{ color: "var(--fg-subtle)" }} />
        </div>
        <div className="card-body">
          <div className="chart-box tall">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="priceFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={chartTheme.fillStart} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chartTheme.fillEnd} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: chartTheme.tick }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: chartTheme.tick }} width={52} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: chartTheme.tooltipBg, color: chartTheme.tooltipFg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: chartTheme.tooltipFg }} itemStyle={{ color: chartTheme.tooltipFg }} />
                <Area type="monotone" dataKey="close" stroke={chartTheme.stroke} fill="url(#priceFill)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Allocation</h2>
            <p>Weight by holding</p>
          </div>
          <BarChart3 size={16} style={{ color: "var(--fg-subtle)" }} />
        </div>
        <div className="card-body">
          {allocationRows.length > 0 ? (
            <div className="alloc-chart-wrap">
              <div className="alloc-pie-only">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                    <Pie
                      cx="50%"
                      cy="50%"
                      data={allocationRows}
                      dataKey="value"
                      innerRadius="50%"
                      outerRadius="88%"
                      strokeWidth={0}
                      nameKey="symbol"
                      label={renderAllocLabel(darkMode)}
                      labelLine={{ stroke: darkMode ? "#7a7f99" : "#9499ad", strokeWidth: 1 }}
                    >
                      {allocationRows.map((row) => (
                        <Cell fill={row.color} key={row.symbol} />
                      ))}
                    </Pie>
                    <Tooltip content={<AllocationTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="empty-state">No holdings yet. Sync to fetch data.</div>
          )}
        </div>
      </div>
    </>
  );
}

function renderAllocLabel(darkMode: boolean) {
  const fill = darkMode ? "#eef0f8" : "#0a0b10";
  return (props: {
    symbol?: string;
    percentage?: number;
    cx?: number;
    cy?: number;
    midAngle?: number;
    outerRadius?: number;
  }) => {
    if (!props.cx || !props.cy || props.midAngle === undefined || !props.outerRadius || !props.symbol) return null;
    if ((props.percentage ?? 0) < 1.8) return null;
    const radian = Math.PI / 180;
    const radius = props.outerRadius + 14;
    const x = props.cx + radius * Math.cos(-props.midAngle * radian);
    const y = props.cy + radius * Math.sin(-props.midAngle * radian);

    return (
      <text
        dominantBaseline="central"
        fill={fill}
        fontSize={10}
        fontWeight={600}
        textAnchor={x > props.cx ? "start" : "end"}
        x={x}
        y={y}
      >
        {`${props.symbol} ${(props.percentage ?? 0).toFixed(1)}%`}
      </text>
    );
  };
}

function AllocationTooltip({
  active,
  payload
}: {
  active?: boolean;
  payload?: Array<{ payload: AllocationRow }>;
}) {
  if (!active || !payload?.[0]) return null;
  const row = payload[0].payload;
  const gain = row.purchasePrice ? ((row.lastPrice - row.purchasePrice) / row.purchasePrice) * 100 : 0;

  return (
    <div className="alloc-tooltip">
      <strong>{row.symbol}</strong>
      <div>Shares: {new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(row.position)}</div>
      <div>Weight: {row.percentage.toFixed(1)}%</div>
      <div>Buy: {formatMoney(row.purchasePrice)}</div>
      <div>Current: {formatMoney(row.lastPrice)}</div>
      <div className={gain >= 0 ? "positive" : "negative"}>Change: {gain.toFixed(2)}%</div>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2
  }).format(value || 0);
}
