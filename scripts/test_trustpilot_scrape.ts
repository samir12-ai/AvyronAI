import * as cheerio from "cheerio";

async function scrapeTrustpilot(url: string) {
  console.log(`Fetching Trustpilot URL: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    console.log(`Response status: ${res.status}`);
    const html = await res.text();
    console.log(`HTML length: ${html.length}`);

    // Check for JSON-LD schema or script tag with review data
    const $ = cheerio.load(html);
    
    // Look for JSON-LD scripts
    const jsonLdScripts = $('script[type="application/ld+json"]');
    console.log(`Found ${jsonLdScripts.length} JSON-LD script tags`);
    
    const reviews: any[] = [];
    jsonLdScripts.each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || "{}");
        // Check if array or object
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item["@type"] === "LocalBusiness" || item["@type"] === "Organization" || item["@type"] === "Product") {
            if (Array.isArray(item.review)) {
              for (const r of item.review) {
                reviews.push({
                  author: r.author?.name || "Anonymous",
                  rating: r.reviewRating?.ratingValue || 5,
                  headline: r.headline || "",
                  body: r.reviewBody || "",
                  datePublished: r.datePublished || new Date().toISOString(),
                });
              }
            }
          }
        }
      } catch (e) {
        console.error("JSON-LD parse error:", e);
      }
    });

    // Also parse review cards from HTML if JSON-LD has few
    $('[data-service-review-card-paper="true"], article, .review-card').each((_, el) => {
      const card = $(el);
      const text = card.find('[data-service-review-text-typography="true"], p').text().trim();
      const title = card.find('[data-service-review-title-typography="true"], h2').text().trim();
      const author = card.find('[data-consumer-name-typography="true"]').text().trim();
      const ratingImg = card.find('img[alt*="star"]');
      const ratingAlt = ratingImg.attr("alt") || "";
      const ratingMatch = ratingAlt.match(/(\d+)/);
      const rating = ratingMatch ? parseInt(ratingMatch[1]) : 5;
      const date = card.find('time').attr('datetime') || new Date().toISOString();

      if (text.length > 5 || title.length > 5) {
        reviews.push({
          author: author || "Customer",
          rating,
          headline: title,
          body: text,
          datePublished: date,
        });
      }
    });

    console.log(`Extracted ${reviews.length} reviews from Trustpilot!`);
    if (reviews.length > 0) {
      console.log("Sample review:", reviews[0]);
    }
    return reviews;
  } catch (err) {
    console.error("Trustpilot fetch failed:", err);
    return [];
  }
}

scrapeTrustpilot("https://www.trustpilot.com/review/abayasboutique.com");
