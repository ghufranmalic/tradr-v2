import { prisma } from "@/src/lib/prisma";

async function main() {
  const [runs, tickers, prices, holdings, watchlists, signals, holdingRows, tickerRows] = await Promise.all([
    prisma.collectionRun.findMany({ orderBy: { startedAt: "desc" }, take: 3 }),
    prisma.ticker.count(),
    prisma.priceBar.count(),
    prisma.holding.count(),
    prisma.watchlist.count(),
    prisma.signal.count(),
    prisma.holding.findMany({ include: { ticker: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.ticker.findMany({ orderBy: { createdAt: "desc" }, take: 10 })
  ]);

  console.log(
    JSON.stringify(
      {
        runs,
        counts: {
          tickers,
          prices,
          holdings,
          watchlists,
          signals
        },
        holdings: holdingRows.map((holding) => ({
          symbol: holding.ticker.symbol,
          quantity: Number(holding.quantity),
          averageBuy: Number(holding.averageBuy)
        })),
        tickers: tickerRows.map((ticker) => ticker.symbol)
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
