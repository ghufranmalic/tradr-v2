import { google } from "googleapis";
import { env, hasGoogleSheetsConfig } from "@/src/config/env";
import type { Quote } from "@/src/types/market";

export async function syncDailyQuotesToSheets(quotes: Quote[]): Promise<void> {
  if (!hasGoogleSheetsConfig || quotes.length === 0) return;

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const values = quotes.map((quote) => [
    quote.timestamp.toISOString().slice(0, 10),
    quote.symbol,
    quote.open,
    quote.high,
    quote.low,
    quote.close,
    quote.volume
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: "DailySnapshots!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}
