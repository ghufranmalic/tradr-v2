# Deploy Tradr Cloud (GitHub Actions + Vercel + Neon)

This is the fully cloud version of Tradr — nothing needs to run on your own machine.
KTrade collection runs on **GitHub Actions**, the dashboard runs on **Vercel**, and
both talk to the same **Neon** Postgres database.

```
GitHub Actions (cron + on-demand)      Vercel
──────────────────────────────         ──────
Playwright + KTrade login               Next.js dashboard
  │                                       │
  ▼                                       ▼
        Neon Postgres (shared)
```

## 1. Neon (database)

1. Create a project in the [Neon console](https://console.neon.tech).
2. Copy the **pooled** connection string (has `-pooler` in the host, `?sslmode=require`).
3. Run the schema against it once from your machine (this is the only local step, and it's optional if you'd rather run it via a one-off GitHub Actions job):

   ```bash
   npm install
   DATABASE_URL="<neon-pooled-url>" npx prisma db push
   ```

   This project uses `prisma db push` rather than tracked migrations — simplest for a
   single-environment app. If you'd rather have migration history, run
   `npx prisma migrate dev --name init` once locally against Neon and commit the
   generated `prisma/migrations` folder, then use `migrate deploy` in step 3 instead.

## 2. GitHub repository + secrets

Push this project to a new GitHub repo, then add these under
**Settings → Secrets and variables → Actions**:

| Secret | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection string |
| `KTRADE_LOGIN_URL` | yes | KTrade login page |
| `KTRADE_DASHBOARD_URL` | recommended | Post-login dashboard URL |
| `KTRADE_USERNAME` / `KTRADE_PASSWORD` | yes | KTrade credentials |
| `KTRADE_SECOND_LEVEL_PASSWORD` | if applicable | Second-level login password |
| `KTRADE_TOTP_SECRET` | if applicable | Not auto-generated; see client.ts |
| `KTRADE_QUOTES_API_URL` | optional | Direct JSON quotes endpoint — skips page scraping if set |
| `KTRADE_ORDER_SELECTORS_JSON` | optional | Enables live order placement (see below) |
| `AUTO_TRADE_LIVE` | optional | Master switch for live order execution, `true`/`false` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | optional | Alerts |
| `GOOGLE_SHEETS_*` | optional | Daily snapshot sync |

The workflow at [.github/workflows/collect.yml](.github/workflows/collect.yml) runs:

- On a cron schedule (PSX hours, Mon–Fri) — respects the dashboard's collection-window settings.
- On `workflow_dispatch` — fired automatically when you press **Sync** on the live dashboard.

It caches the logged-in KTrade session (`playwright/.auth`) between runs via `actions/cache`, so it
doesn't need to log in from scratch every 5 minutes.

## 3. Vercel

1. Import the GitHub repo into [Vercel](https://vercel.com).
2. Add one environment variable: `DATABASE_URL` (same Neon pooled string).
3. To let the **Sync** button on the dashboard dispatch the GitHub Actions workflow immediately
   instead of waiting for the next cron tick, also add:
   - `GITHUB_REPO` — `yourname/your-repo`
   - `GITHUB_WORKFLOW_TOKEN` — a [fine-grained PAT](https://github.com/settings/tokens?type=beta) with `Actions: write` on that repo
4. Deploy. Do **not** add any `KTRADE_*` secrets to Vercel — Playwright/Chromium isn't available in
   the Vercel serverless runtime, so KTrade login only ever happens in GitHub Actions.

## Auto buy/sell (optional)

The **Trading** tab turns your existing +/- % thresholds into orders:

1. Turn on **Enable auto-trade engine** — the collector will propose orders (not place them) each run.
2. Approve/reject proposals from the dashboard, or turn on **Auto-approve** to skip manual confirmation.
3. To actually place orders with the broker, set `KTRADE_ORDER_SELECTORS_JSON` (CSS selectors for
   KTrade's order ticket — inspect the page once to fill these in) **and** set `AUTO_TRADE_LIVE=true`
   **and** turn on **Place live orders** in the dashboard. All three gates must be on — this is
   intentional so a config mistake can't silently start trading.
4. Guardrails (max order value, max orders/day, one order per symbol/side/day, market-hours-only)
   are enforced server-side regardless of the above.

Start in confirm-only mode and watch it for a while before enabling auto-approve or live execution.

## Troubleshooting

| Issue | Fix |
|---|---|
| Dashboard build fails on Prisma | Ensure `DATABASE_URL` is set in Vercel before deploy |
| Sync button says "queued" but nothing happens | Check the repo's **Actions** tab for the `Collect KTrade data` workflow run/logs |
| Sync button doesn't trigger a workflow run immediately | Set `GITHUB_REPO` + `GITHUB_WORKFLOW_TOKEN` on Vercel; otherwise it waits for the next cron tick |
| KTrade login fails in Actions | Check `KTRADE_*` secrets; MFA/TOTP still needs a provider-specific handler in `src/services/ktrade/client.ts` |
| DB connection errors | Use Neon's **pooler** URL with `?sslmode=require` |
