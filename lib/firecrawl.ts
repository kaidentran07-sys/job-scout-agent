import "server-only";

// Docs: https://docs.firecrawl.dev/api-reference/endpoint/scrape
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

/**
 * `markdown` is null on any failure. `status` is the target page's HTTP
 * status when Firecrawl reached it (e.g. 404 means the posting is gone).
 */
export type ScrapeResult = { markdown: string | null; status?: number };

export type ScrapeOptions = {
  timeoutMs?: number;
  /** Extra wait for JavaScript-rendered pages (e.g. Workday). Counts toward timeoutMs. */
  waitForMs?: number;
};

/** Scrapes one URL to clean main-content markdown. Never throws. */
export async function scrapeMarkdown(
  url: string,
  { timeoutMs = 15_000, waitForMs = 0 }: ScrapeOptions = {},
): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("[firecrawl] FIRECRAWL_API_KEY is not set");
    return { markdown: null };
  }

  try {
    const res = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: timeoutMs,
        ...(waitForMs > 0 ? { waitFor: waitForMs } : {}),
        // "auto" can retry with the enhanced proxy, which costs more credits.
        proxy: "basic",
        blockAds: true,
        removeBase64Images: true,
      }),
      // A little slack over Firecrawl's own timeout for the round trip.
      signal: AbortSignal.timeout(timeoutMs + 2_000),
    });

    if (!res.ok) {
      console.error(`[firecrawl] HTTP ${res.status} scraping ${url}`);
      return { markdown: null };
    }

    const body = (await res.json()) as {
      success?: boolean;
      data?: { markdown?: string; metadata?: { statusCode?: number } };
    };
    const status = body.data?.metadata?.statusCode;
    const markdown = body.data?.markdown?.trim();
    if (!body.success || !markdown || (status !== undefined && status >= 400)) {
      return { markdown: null, status };
    }
    return { markdown, status };
  } catch (err) {
    console.error(
      `[firecrawl] failed scraping ${url}:`,
      err instanceof Error ? err.message : err,
    );
    return { markdown: null };
  }
}
