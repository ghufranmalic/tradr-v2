# Deploy Tradr Cloud (Vercel + Neon, local sync-watcher)

The dashboard runs on **Vercel** and the database is **Neon** Postgres — both fully
cloud. KTrade collection (Playwright login/scraping) runs from a small **local
process on your own PC**, not from GitHub Actions or any other datacenter host.

This is intentional: KTrade brokers can flag or throttle logins from unfamiliar
datacenter IP ranges (which is exactly what GitHub-hosted runners use), and it also
raises real account-security risk. Logging in from your own home network — the same
network you'd use to log in manually — avoids both problems. Everything else
(dashboard, database, order approvals, settings) stays fully cloud and works from
any device.

```
Your PC                              Cloud
────────                              ─────
sync-watcher (Playwright + KTrade)     Vercel (Next.js dashboard, no KTrade)
        │                                    │
        ▼                                    ▼
              Neon Postgres (shared)
```

## 1. Neon (database)

1. Create a project in the [Neon console](https://console.neon.tech).
2. Copy the **pooled** connection string (has `-pooler` in the host, `?sslmode=require`).
3. Apply the schema once:

   ```bash
   npm install
   DATABASE_URL="<neon-pooled-url>" npx prisma db push
   ```

## 2. Vercel

1. Push this repo to GitHub, then import it into [Vercel](https://vercel.com).
2. Add one environment variable: `DATABASE_URL` (same Neon pooled string).
3. Deploy. Do **not** add any `KTRADE_*` secrets to Vercel — Playwright/Chromium isn't
   available in the Vercel serverless runtime, and KTrade login should only ever
   happen from your PC anyway.

## 3. Local sync-watcher (your PC)

1. Copy `.env.example` to `.env` and fill in the same `DATABASE_URL` plus your
   `KTRADE_*` credentials.
2. Install dependencies and the browser once:

   ```bash
   npm install
   npm run playwright:install
   ```
3. Start the watcher:

   ```bash
   npm run sync-watcher
   ```

   It polls Neon every 15 seconds for Sync requests from the live dashboard, and also
   runs the scheduled collection (per the dashboard's Settings tab — weekdays,
   time window, interval) while it's running.

4. **Keep it running automatically:** from an elevated PowerShell prompt in the
   project folder, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\register-windows-task.ps1
   ```

   This registers a Windows Scheduled Task that starts `npm run sync-watcher` at
   login and restarts it if it crashes. The watcher only needs to be running during
   the hours you want syncs to happen — if your PC is off, the dashboard falls back
   to showing the last synced data and queues any Sync button presses until the
   watcher comes back online (shown as "PC offline" in a banner).

## Auto buy/sell (optional)

The **Trading** tab turns your existing +/- % thresholds into orders:

1. Turn on **Enable auto-trade engine** — the collector will propose orders (not place them) each run.
2. Approve/reject proposals from the dashboard, or turn on **Auto-approve** to skip manual confirmation.
3. To actually place orders with the broker, set `KTRADE_ORDER_SELECTORS_JSON` (CSS selectors for
   KTrade's order ticket — inspect the page once to fill these in) **and** set `AUTO_TRADE_LIVE=true`
   in your local `.env` **and** turn on **Place live orders** in the dashboard. All three gates must
   be on — this is intentional so a config mistake can't silently start trading.
4. Guardrails (max order value, max orders/day, one order per symbol/side/day, market-hours-only)
   are enforced server-side regardless of the above.

Start in confirm-only mode and watch it for a while before enabling auto-approve or live execution.

## Troubleshooting

| Issue | Fix |
|---|---|
| Dashboard build fails on Prisma | Ensure `DATABASE_URL` is set in Vercel before deploy |
| Sync button says "queued" but nothing happens | Make sure `npm run sync-watcher` is running on your PC; check its console output |
| Dashboard shows "PC offline" | The watcher hasn't reported in within 90s — start/restart it, or check the Scheduled Task status |
| KTrade login fails | Check `KTRADE_*` values in your local `.env`; MFA/TOTP still needs a provider-specific handler in `src/services/ktrade/client.ts` |
| DB connection errors | Use Neon's **pooler** URL with `?sslmode=require` |
