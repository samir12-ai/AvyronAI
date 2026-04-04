export const SGL_VERSION = 2;
export const MIN_SIGNALS_PER_CATEGORY = {
    pain: 2,
    desire: 2,
    objection: 1,
    pattern: 1,
    root_cause: 1,
    psychological_driver: 1,
};
export const MIN_TOTAL_SIGNALS = 5;
export const SIGNAL_CONFIDENCE_FLOOR = 0.20;
export const LEAKAGE_PATTERNS = [
    /^https?:\/\//i,
    /\b(raw|unprocessed|todo|fixme|hack)\b/i,
    /^\s*\/\//,
    /^\s*#/,
    /\{\{.*\}\}/,
    /\$\{.*\}/,
    /<script/i,
    /password|api_key|secret/i,
];
export const RAW_COMMENT_PATTERNS = [
    /\$\d+/i,
    /charged me/i,
    /refund/i,
    /rip[\s-]?off/i,
    /scam/i,
    /do not use/i,
    /don't use/i,
    /worst (company|service|experience|product)/i,
    /i (need|want|got|paid|lost|spent|called|emailed|contacted|waited)/i,
    /they (charged|took|stole|lied|refused|ignored|scammed|ripped)/i,
    /my (money|account|order|payment|card|refund)/i,
    /customer (service|support|care) (is|was|sucks|terrible)/i,
    /gave.*(star|rating|review)/i,
    /never (again|buying|ordering|going back)/i,
    /stay away/i,
    /waste of (time|money)/i,
    /horrible|terrible|awful|disgusting/i,
    /\b(lol|smh|wtf|omg|tbh|imo)\b/i,
    /@\w{2,}/,
    /^\s*".{5,}"\s*$/,
    /said\s+(that|they|he|she|it)/i,
    /told (me|us|them)/i,
];
