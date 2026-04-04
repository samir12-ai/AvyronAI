export function computeSourceAvailability(competitor) {
    const instagram = !!(competitor.profileLink && (competitor.postsCollected ?? 0) > 0);
    const website = !!(competitor.websiteUrl && competitor.websiteEnrichmentStatus !== "NONE" && competitor.websiteEnrichmentStatus !== "FAILED");
    const blog = !!(competitor.blogUrl && competitor.blogEnrichmentStatus !== "NONE" && competitor.blogEnrichmentStatus !== "FAILED");
    const availableSources = [];
    if (instagram)
        availableSources.push("instagram");
    if (website)
        availableSources.push("website");
    if (blog)
        availableSources.push("blog");
    const primarySource = website ? "website" : instagram ? "instagram" : "blog";
    return {
        instagram,
        website,
        blog,
        availableSources,
        missingSourcesCount: 3 - availableSources.length,
        primarySource,
    };
}
export function computeSourceFreshness(competitor) {
    const now = Date.now();
    const STALE_DAYS = 14;
    function calcAge(ts) {
        if (!ts)
            return { ageDays: -1, isStale: true, scrapedAt: null };
        const d = new Date(ts).getTime();
        const ageDays = (now - d) / (1000 * 60 * 60 * 24);
        return { ageDays: Math.round(ageDays * 100) / 100, isStale: ageDays > STALE_DAYS, scrapedAt: new Date(ts).toISOString() };
    }
    const ig = calcAge(competitor.lastCheckedAt);
    const web = calcAge(competitor.websiteScrapedAt);
    const blog = calcAge(competitor.blogScrapedAt);
    return [
        { sourceType: "instagram", ...ig, isAvailable: ig.scrapedAt !== null },
        { sourceType: "website", ...web, isAvailable: web.scrapedAt !== null },
        { sourceType: "blog", ...blog, isAvailable: blog.scrapedAt !== null },
    ];
}
