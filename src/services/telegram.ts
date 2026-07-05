import axios from "axios";
import { env, hasTelegramConfig } from "@/src/config/env";

export async function sendTelegramAlert(message: string): Promise<void> {
  if (!hasTelegramConfig) return;

  await axios.post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}
