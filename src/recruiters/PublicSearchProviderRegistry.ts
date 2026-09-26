export type SourceId =
  | "google-jina" | "google-direct" | "bing-jina" | "bing-direct" | "duckduckgo-jina" | "startpage-jina" | "ecosia-jina"
  | "jina-search" | "brave-api" | "mojeek-api" | "brave-direct" | "mojeek-direct"
  | "qwant-direct" | "yahoo-direct";

export interface Source {
  id: SourceId;
  url: string;
  headers?: Record<string, string>;
}

export function sourceList(query: string): Source[] {
  // Search engines frequently ignore/garble LinkedIn site operators and return
  // navigation/dictionary pages instead of the public profile/post results that
  // the query is asking for. Remove only the brittle site operator and retain a
  // LinkedIn keyword; downstream URL classification and evidence validation still
  // require a genuine public LinkedIn profile/post before anything is promoted.
  const isLinkedInRecruiterQuery = /site:linkedin\.com\/in/i.test(query);
  const isLinkedInHiringPostQuery = /site:linkedin\.com\/posts/i.test(query);
  const effectiveQuery = isLinkedInRecruiterQuery || isLinkedInHiringPostQuery
    ? query
      .replace(/site:linkedin\.com\/(?:in|posts)\s*/i, "")
      .replace(/"(?:Frontend Engineer|Frontend Developer|React Developer|React Engineer|Next\.js Developer|JavaScript Developer|TypeScript Developer|Software Engineer — Frontend|Full Stack Developer — React|Full Stack Engineer — React|Web Developer)"/gi, "React")
      .replace(/\s+/g, " ")
      .trim() + " LinkedIn"
    : query;
  const q = encodeURIComponent(effectiveQuery);
  const sources: Source[] = [
    { id: "google-direct", url: `https://www.google.com/search?q=${q}&gbv=1` },
    { id: "bing-direct", url: `https://www.bing.com/search?q=${q}` },
    { id: "google-jina", url: `https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1` },
    { id: "bing-jina", url: `https://r.jina.ai/https://www.bing.com/search?q=${q}` },
    { id: "duckduckgo-jina", url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}` },
    { id: "startpage-jina", url: `https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}` },
    { id: "ecosia-jina", url: `https://r.jina.ai/https://www.ecosia.org/search?q=${q}` },
    { id: "brave-direct", url: `https://search.brave.com/search?q=${q}&source=web` },
    { id: "mojeek-direct", url: `https://www.mojeek.com/search?q=${q}` },
    { id: "qwant-direct", url: `https://www.qwant.com/?q=${q}&t=web` },
    { id: "yahoo-direct", url: `https://search.yahoo.com/search?p=${q}` }
  ];
  if (process.env.JINA_API_KEY?.trim()) sources.push({ id: "jina-search", url: `https://s.jina.ai/${q}`, headers: { authorization: `Bearer ${process.env.JINA_API_KEY.trim()}` } });
  else sources.push({ id: "jina-search", url: `https://s.jina.ai/${q}` });
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) sources.push({ id: "brave-api", url: `https://api.search.brave.com/res/v1/web/search?q=${q}&count=20&extra_snippets=true`, headers: { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY.trim(), accept: "application/json" } });
  if (process.env.MOJEEK_API_KEY?.trim()) sources.push({ id: "mojeek-api", url: `https://api.mojeek.com/search?q=${q}&api_key=${encodeURIComponent(process.env.MOJEEK_API_KEY.trim())}&fmt=json&t=20`, headers: { accept: "application/json" } });
  return sources;
}

export function isJinaReader(id: SourceId): boolean {
  return ["google-jina", "bing-jina", "duckduckgo-jina", "startpage-jina", "ecosia-jina"].includes(id);
}
