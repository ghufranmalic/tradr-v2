import { z } from "zod";
import "dotenv/config";

/** Some environments pass unset optional vars as "" rather than undefined — treat "" as unset before URL validation. */
const optionalUrl = () => z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  KTRADE_LOGIN_URL: z.string().url().default("https://example.ktrade.local/login"),
  KTRADE_DASHBOARD_URL: optionalUrl(),
  KTRADE_USERNAME: z.string().optional().default(""),
  KTRADE_PASSWORD: z.string().optional().default(""),
  KTRADE_TOTP_SECRET: z.string().optional().default(""),
  KTRADE_HEADLESS: z.coerce.boolean().default(true),
  KTRADE_SESSION_STATE_PATH: z.string().default("playwright/.auth/ktrade.json"),
  KTRADE_USERNAME_SELECTOR: z.string().default("input[placeholder='Userid']"),
  KTRADE_PASSWORD_SELECTOR: z.string().default("input[placeholder='Password']"),
  KTRADE_SUBMIT_SELECTOR: z.string().default("#login-btn"),
  KTRADE_SECOND_LEVEL_PASSWORD: z.string().optional().default(""),
  KTRADE_SECOND_LEVEL_PASSWORD_SELECTOR: z.string().default("#second-lvl-pwd-id"),
  KTRADE_SECOND_LEVEL_SUBMIT_SELECTOR: z.string().default("#auth2-pwd-btn"),
  KTRADE_WATCHLIST_URL_PATTERN: z.string().default("watchlist"),
  KTRADE_PORTFOLIO_URL_PATTERN: z.string().default("portfolio"),
  KTRADE_QUOTES_URL_PATTERN: z.string().default("TopSectorStocksFull"),
  /** Optional direct JSON endpoint for quotes — skips page scraping entirely when set. */
  KTRADE_QUOTES_API_URL: optionalUrl(),
  /** JSON map of CSS selectors for the KTrade order ticket; live order placement stays off without it. */
  KTRADE_ORDER_SELECTORS_JSON: z.string().optional().default(""),
  /** Master switch for live order execution. Orders stay in confirm/dry-run mode unless "true". */
  AUTO_TRADE_LIVE: z.coerce.boolean().default(false),
  /** Advisory reasoning layer — tried in order: Groq, then Gemini, then local Ollama. All three optional. */
  GROQ_API_KEY: z.string().optional().default(""),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:7b"),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional().default(""),
  GOOGLE_SHEETS_CLIENT_EMAIL: z.string().optional().default(""),
  GOOGLE_SHEETS_PRIVATE_KEY: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  MARKET_TIMEZONE: z.string().default("Asia/Karachi"),
  PRICE_DROP_ALERT_PERCENT: z.coerce.number().default(5)
});

export const env = envSchema.parse(process.env);

export const hasKTradeCredentials = Boolean(env.KTRADE_USERNAME && env.KTRADE_PASSWORD);
export const hasGoogleSheetsConfig = Boolean(
  env.GOOGLE_SHEETS_SPREADSHEET_ID &&
    env.GOOGLE_SHEETS_CLIENT_EMAIL &&
    env.GOOGLE_SHEETS_PRIVATE_KEY
);
export const hasTelegramConfig = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

export type OrderTicketSelectors = {
  openTicket: string;
  symbolInput: string;
  quantityInput: string;
  priceInput?: string;
  buySide: string;
  sellSide: string;
  submit: string;
  confirm?: string;
  errorBanner?: string;
};

const orderSelectorsSchema = z.object({
  openTicket: z.string().min(1),
  symbolInput: z.string().min(1),
  quantityInput: z.string().min(1),
  priceInput: z.string().optional(),
  buySide: z.string().min(1),
  sellSide: z.string().min(1),
  submit: z.string().min(1),
  confirm: z.string().optional(),
  errorBanner: z.string().optional()
});

export function orderSelectors(): OrderTicketSelectors | null {
  if (!env.KTRADE_ORDER_SELECTORS_JSON) return null;
  try {
    return orderSelectorsSchema.parse(JSON.parse(env.KTRADE_ORDER_SELECTORS_JSON));
  } catch (error) {
    console.warn("KTRADE_ORDER_SELECTORS_JSON is invalid; live order placement disabled.", error);
    return null;
  }
}
