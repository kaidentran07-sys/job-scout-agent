import "server-only";

// Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type TavilySearchOptions = {
  /** 0-20, Tavily default 10 */
  maxResults?: number;
  /** "basic" | "fast" | "ultra-fast" cost 1 credit; "advanced" costs 2 */
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
  includeDomains?: string[];
  excludeDomains?: string[];
  timeoutMs?: number;
};

export async function tavilySearch(
  query: string,
  options: TavilySearchOptions = {},
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");

  const res = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: options.searchDepth ?? "basic",
      max_results: options.maxResults ?? 10,
      include_domains: options.includeDomains ?? [],
      exclude_domains: options.excludeDomains ?? [],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily search failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { results?: TavilyResult[] };
  return data.results ?? [];
}
