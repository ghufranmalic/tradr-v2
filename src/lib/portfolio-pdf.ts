import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type PortfolioRow = {
  symbol: string;
  name: string;
  market: string;
  position: number;
  purchasePrice: number;
  lastPrice: number;
  todayGainLoss: number;
  totalGainLoss: number;
  change: number;
};

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

function formatSignedMoney(value: number): string {
  if (value > 0) return `+${formatMoney(value)}`;
  return formatMoney(value);
}

function formatSignedPercent(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}%`;
  return `${value.toFixed(2)}%`;
}

function formatSignedNumber(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}`;
  return value.toFixed(2);
}

const POSITIVE_RGB: [number, number, number] = [0, 168, 107];
const NEGATIVE_RGB: [number, number, number] = [224, 36, 58];
const NEUTRAL_RGB: [number, number, number] = [92, 97, 120];

function plColor(value: number): [number, number, number] {
  if (value > 0) return POSITIVE_RGB;
  if (value < 0) return NEGATIVE_RGB;
  return NEUTRAL_RGB;
}

function formatDownloadTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

export function downloadPortfolioPdf(rows: PortfolioRow[]): void {
  const downloadedAt = new Date();
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("All positions", 40, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Sortable custody data from Tradr", 40, 52);
  doc.text(`Downloaded: ${formatDownloadTimestamp(downloadedAt)}`, 40, 66);

  autoTable(doc, {
    startY: 78,
    head: [["#", "Symbol", "Business", "Market", "Qty", "Buy", "Last", "Today", "Total", "%", "Chg"]],
    body: rows.map((row, index) => [
      String(index + 1),
      row.symbol,
      row.name || "—",
      row.market,
      formatNumber(row.position),
      formatMoney(row.purchasePrice),
      formatMoney(row.lastPrice),
      formatSignedMoney(row.todayGainLoss),
      formatSignedMoney(row.totalGainLoss),
      formatSignedPercent(gainPercent(row)),
      formatSignedNumber(row.change)
    ]),
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 4
    },
    headStyles: {
      fillColor: [240, 242, 246],
      textColor: NEUTRAL_RGB,
      fontStyle: "bold",
      fontSize: 8
    },
    alternateRowStyles: {
      fillColor: [248, 249, 252]
    },
    margin: { left: 40, right: 40 },
    didParseCell(data) {
      if (data.section !== "body") return;

      const row = rows[data.row.index];
      if (!row) return;

      const valueByColumn: Record<number, number> = {
        7: row.todayGainLoss,
        8: row.totalGainLoss,
        9: gainPercent(row),
        10: row.change
      };

      const value = valueByColumn[data.column.index];
      if (value === undefined) return;

      data.cell.styles.textColor = plColor(value);
    }
  });

  const stamp = downloadedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  doc.save(`tradr-positions-${stamp}.pdf`);
}
