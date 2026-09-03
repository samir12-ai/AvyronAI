async function scrapeTrustpilot(url: string) {
  console.log(`Fetching Trustpilot URL: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    console.log(`Response status: ${res.status}`);
    const html = await res.text();
    console.log(`HTML length: ${html.length}`);

    // Extract all JSON-LD script blocks
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/gi);
    const reviews: any[] = [];

    for (const match of jsonLdMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item["@graph"] && Array.isArray(item["@graph"])) {
            items.push(...item["@graph"]);
          }
          if (Array.isArray(item.review)) {
            for (const r of item.review) {
              reviews.push({
                author: r.author?.name || "Customer",
                rating: Number(r.reviewRating?.ratingValue || 5),
                headline: r.headline || "",
                body: r.reviewBody || "",
                datePublished: r.datePublished || new Date().toISOString(),
              });
            }
          }
        }
      } catch (e) {}
    }

    // Also look for __NEXT_DATA__
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const props = nextData.props?.pageProps;
        const pageReviews = props?.reviews || props?.businessUnit?.reviews || [];
        console.log(`Found ${pageReviews.length} reviews in __NEXT_DATA__!`);
        for (const r of pageReviews) {
          reviews.push({
            author: r.consumer?.displayName || "Customer",
            rating: Number(r.rating || 5),
            headline: r.title || "",
            body: r.text || "",
            datePublished: r.dates?.publishedDate || new Date().toISOString(),
          });
        }
      } catch (e) {}
    }

    console.log(`Extracted total ${reviews.length} reviews from Trustpilot!`);
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
