export const CANONICAL_MEDIA_TYPES = ['VIDEO', 'REEL', 'IMAGE', 'POSTER', 'CAROUSEL', 'POST', 'STORY'];
const NORMALIZE_MAP = {
    video: 'VIDEO',
    videos: 'VIDEO',
    reel: 'REEL',
    reels: 'REEL',
    image: 'IMAGE',
    images: 'IMAGE',
    photo: 'IMAGE',
    poster: 'POSTER',
    carousel: 'CAROUSEL',
    post: 'POST',
    caption: 'POST',
    story: 'STORY',
    stories: 'STORY',
};
export function normalizeMediaType(input) {
    if (!input || typeof input !== 'string') {
        if (typeof __DEV__ !== 'undefined' && __DEV__)
            console.warn('[normalizeMediaType] empty/null input, defaulting to IMAGE');
        return 'IMAGE';
    }
    const key = input.trim().toLowerCase();
    const mapped = NORMALIZE_MAP[key];
    if (mapped)
        return mapped;
    const upper = key.toUpperCase();
    if (CANONICAL_MEDIA_TYPES.includes(upper))
        return upper;
    if (typeof __DEV__ !== 'undefined' && __DEV__)
        console.warn(`[normalizeMediaType] unknown value "${input}", defaulting to IMAGE`);
    return 'IMAGE';
}
export function getBranchForMediaType(mediaType) {
    const normalized = normalizeMediaType(mediaType);
    switch (normalized) {
        case 'VIDEO':
        case 'REEL':
            return 'REELS';
        case 'IMAGE':
        case 'POSTER':
        case 'CAROUSEL':
        case 'POST':
            return 'POSTS';
        case 'STORY':
            return 'STORIES';
        default:
            return 'POSTS';
    }
}
export function createRouteForContentType(contentType) {
    const normalized = normalizeMediaType(contentType);
    switch (normalized) {
        case 'VIDEO':
        case 'REEL':
            return { tab: 'content', contentType: 'reel', label: 'Reels Creation' };
        case 'IMAGE':
        case 'POSTER':
        case 'CAROUSEL':
            return { tab: 'designer', contentType: 'post', label: 'Posts' };
        case 'POST':
            return { tab: 'content', contentType: 'post', label: 'Posts' };
        case 'STORY':
            return { tab: 'content', contentType: 'story', label: 'Stories' };
        default:
            return { tab: 'content', contentType: 'post', label: 'Posts' };
    }
}
