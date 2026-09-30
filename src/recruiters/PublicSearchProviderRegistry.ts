export type SourceId =
  | "google-jina" | "google-direct" | "google-regional-direct" | "google-news" | "bing-jina" | "bing-direct" | "duckduckgo-jina" | "startpage-jina" | "ecosia-jina"
  | "jina-search" | "google-api" | "brave-api" | "mojeek-api" | "brave-direct" | "mojeek-direct"
  | "qwant-direct" | "yahoo-direct";

export interface Source {
  id: SourceId;
  url: string;
  headers?: Record<string, string>;
}

export function sourceList(query: string): Source[] {
  // Preserve explicit LinkedIn site operators. The downstream parser already
  // unwraps search-engine redirects and validates public profile URLs, so
  // removing the operator here destroys the strongest discovery constraint and
  // turns a targeted recruiter search into generic search-engine navigation.
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const q = encodeURIComponent(normalizedQuery);
  const jinaApiKey = process.env.JINA_API_KEY?.trim();
  const jinaHeaders = jinaApiKey ? { authorization: `Bearer ${jinaApiKey}` } : undefined;
  const sources: Source[] = [
    // Google web HTML is retained as a best-effort fallback. In production
    // Google may challenge automated traffic, so an existing Custom Search
    // JSON API configuration is preferred when supplied.
    // Google web search: use several legitimate regional surfaces because
    // Google Search can vary by country/region and one hostname can challenge
    // automated traffic independently of the others.
    { id: "google-direct", url: `https://www.google.com/search?q=${q}&gbv=1&hl=en&gl=in&num=20&filter=0`, headers: { "accept-language": "en-IN,en;q=0.9" } },
    { id: "google-regional-direct", url: `https://www.google.co.in/search?q=${q}&gbv=1&hl=en&gl=in&num=20&filter=0`, headers: { "accept-language": "en-IN,en;q=0.9" } },
    { id: "google-regional-direct", url: `https://www.google.co.uk/search?q=${q}&gbv=1&hl=en&gl=gb&num=20&filter=0`, headers: { "accept-language": "en-GB,en;q=0.9" } },
    // Google News is a separate Google index surface and can expose indexed
    // LinkedIn hiring posts even when ordinary web HTML is challenged.
    { id: "google-news", url: `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`, headers: { accept: "application/rss+xml,application/xml,text/xml,*/*;q=0.8", "accept-language": "en-IN,en;q=0.9" } },
    ...(process.env.GOOGLE_SEARCH_API_KEY?.trim() && process.env.GOOGLE_SEARCH_CX?.trim()
      ? [{
          id: "google-api" as SourceId,
          url: `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_SEARCH_API_KEY.trim())}&cx=${encodeURIComponent(process.env.GOOGLE_SEARCH_CX.trim())}&q=${q}&num=10&siteSearch=linkedin.com&siteSearchFilter=i&hl=en&gl=in`,
          headers: { accept: "application/json" }
        }]
      : []),
    { id: "bing-direct", url: `https://www.bing.com/search?format=rss&q=${q}` },
    { id: "google-jina", url: `https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1`, headers: jinaHeaders },
    { id: "bing-jina", url: `https://r.jina.ai/https://www.bing.com/search?format=rss&q=${q}`, headers: jinaHeaders },
    { id: "duckduckgo-jina", url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}`, headers: jinaHeaders },
    { id: "startpage-jina", url: `https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}`, headers: jinaHeaders },
    { id: "ecosia-jina", url: `https://r.jina.ai/https://www.ecosia.org/search?q=${q}`, headers: jinaHeaders },
    { id: "brave-direct", url: `https://search.brave.com/search?q=${q}&source=web` },
    { id: "mojeek-direct", url: `https://www.mojeek.com/search?q=${q}` },
    { id: "yahoo-direct", url: `https://search.yahoo.com/rss?p=${q}` },
    { id: "qwant-direct", url: `https://www.qwant.com/?q=${q}&t=web` }
  ];
  // Jina Search currently blocks unauthenticated search requests. Do not
  // spend a discovery slot on a guaranteed 401; enable it automatically when
  // the user supplies a JINA_API_KEY.
  if (jinaApiKey) {
    sources.push({ id: "jina-search", url: `https://s.jina.ai/${q}`, headers: jinaHeaders });
  }
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) {
    sources.push({ id: "brave-api", url: `https://api.search.brave.com/res/v1/web/search?q=${q}&count=20&extra_snippets=true`, headers: { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY.trim(), accept: "application/json" } });
  }
  if (process.env.MOJEEK_API_KEY?.trim()) {
    sources.push({ id: "mojeek-api", url: `https://api.mojeek.com/search?q=${q}&api_key=${encodeURIComponent(process.env.MOJEEK_API_KEY.trim())}&fmt=json&t=20`, headers: { accept: "application/json" } });
  }
  return sources;
}

export function isJinaReader(id: SourceId): boolean {
  return ["google-jina", "bing-jina", "duckduckgo-jina", "startpage-jina", "ecosia-jina"].includes(id);
}
