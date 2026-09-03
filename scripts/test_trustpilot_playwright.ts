import { chromium } from "playwright-chromium";

async function main() {
  console.log("Launching Playwright Chromium...");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    console.log("Navigating to Trustpilot...");
    const res = await page.goto("https://www.trustpilot.com/review/abayasboutique.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("Status:", res?.status());
    
    // Evaluate reviews from page
    const reviews = await page.evaluate(() => {
      const nextDataEl = document.getElementById("__NEXT_DATA__");
      if (nextDataEl) {
        try {
          const nextData = JSON.parse(nextDataEl.textContent || "{}");
          const revs = nextData.props?.pageProps?.reviews || [];
          return revs.map((r: any) => ({
            author: r.consumer?.displayName,
            rating: r.rating,
            title: r.title,
            text: r.text,
            date: r.dates?.publishedDate,
          }));
        } catch {}
      }
      return [];
    });

    console.log(`Playwright extracted ${reviews.length} reviews from Trustpilot!`);
    if (reviews.length > 0) {
      console.log("Sample review:", reviews[0]);
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
