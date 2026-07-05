import { chromium } from "playwright";
import { env } from "@/src/config/env";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(env.KTRADE_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  const controls = await page.evaluate(`(() => {
    const summarize = (element) => {
      const input = element;
      return {
        tag: element.tagName.toLowerCase(),
        type: input.type || "",
        id: input.id || "",
        name: input.name || "",
        placeholder: input.placeholder || "",
        text: element.textContent?.trim().replace(/\\s+/g, " ").slice(0, 80) || "",
        classes: element.getAttribute("class") || "",
        ariaLabel: element.getAttribute("aria-label") || ""
      };
    };

    return {
      url: location.href,
      title: document.title,
      inputs: Array.from(document.querySelectorAll("input, textarea")).map(summarize),
      buttons: Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a")).map(summarize)
    };
  })()`);

  console.log(JSON.stringify(controls, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
