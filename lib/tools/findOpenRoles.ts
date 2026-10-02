import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { tavilySearch, type TavilyResult, type TavilySearchOptions } from "@/lib/tavily";
import { scrapeMarkdown, type ScrapeResult } from "@/lib/firecrawl";
import { AGGREGATOR_DOMAINS } from "@/lib/findJobBoard";

const TABLE = "job_scout_employers";
const MAX_POSTINGS_PER_COMPANY = 3;
const MAX_POSTING_CHARS = 2500;
const COMPANY_TIMEOUT_MS = 35_000;
const MAX_INPUT_LENGTH = 100;

export const findOpenRolesTool: Anthropic.Beta.BetaTool = {
  name: "find_open_roles",
  description:
    "Call this when the user asks about a type of job or role (for example 'business analyst', 'data analyst', 'product manager') and wants to see open positions at their saved companies. Searches each saved company's job board and returns the raw text and link of matching postings so you can build a comparison table of title, company, location, pay, and link. Do NOT call this for general career advice, and do NOT call it if the user has not saved any companies yet.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      role: {
        type: "string",
        description: 'The job or role the user asked about, e.g. "business analyst".',
      },
      location: {
        type: "string",
        description:
          'Only if the user mentioned a location, e.g. "remote" or "Oklahoma". Omit it otherwise. Never invent one.',
      },
    },
    required: ["role"],
    additionalProperties: false,
  },
};

export type SavedEmployerRow = { company: string; job_board_url: string | null };
export type Posting = { url: string; text: string };
export type CompanyRoles = {
  company: string;
  jobBoardUrl: string | null;
  postings: Posting[];
  note?: string;
};
export type FindOpenRolesResult = CompanyRoles[] | { message: string };

/** External calls, injectable so tests can run offline. */
export type FindOpenRolesDeps = {
  loadEmployers: (sessionId: string) => Promise<SavedEmployerRow[]>;
  search: (query: string, options: TavilySearchOptions) => Promise<TavilyResult[]>;
  scrape: (url: string) => Promise<ScrapeResult>;
  companyTimeoutMs: number;
};

async function loadEmployersFromSupabase(sessionId: string): Promise<SavedEmployerRow[]> {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("company, job_board_url")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load the watch list: ${error.message}`);
  return data;
}

// Workday pages load the posting with JavaScript after the page shell;
// without a wait, Firecrawl captures only "Loading".
const WORKDAY_WAIT_MS = 4_000;

const defaultDeps: FindOpenRolesDeps = {
  loadEmployers: loadEmployersFromSupabase,
  search: tavilySearch,
  scrape: (url) =>
    scrapeMarkdown(url, {
      waitForMs: onHost(new URL(url).hostname, "myworkdayjobs.com") ? WORKDAY_WAIT_MS : 0,
    }),
  companyTimeoutMs: COMPANY_TIMEOUT_MS,
};

// ---------------------------------------------------------------------------
// Job boards and posting URLs
// ---------------------------------------------------------------------------

type AtsName = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday";

const ATS_SUFFIXES: [AtsName, string][] = [
  ["greenhouse", "greenhouse.io"],
  ["lever", "lever.co"],
  ["ashby", "ashbyhq.com"],
  ["smartrecruiters", "smartrecruiters.com"],
  ["workday", "myworkdayjobs.com"],
];

export type Board =
  | { kind: "ats"; ats: AtsName; slug: string; host: string }
  | { kind: "own"; host: string };

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
const segmentsOf = (url: URL) => url.pathname.split("/").filter(Boolean);
const onHost = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

function atsOf(host: string): AtsName | null {
  return ATS_SUFFIXES.find(([, suffix]) => onHost(host, suffix))?.[0] ?? null;
}

/** Slug identifying the company on a shared ATS host, lowercased. */
function atsSlug(ats: AtsName, url: URL): string | null {
  const first = segmentsOf(url)[0];
  if (ats === "workday") return hostOf(url).split(".")[0] ?? null; // visa.wd5.myworkdayjobs.com
  if (ats === "greenhouse" && first === "embed") return url.searchParams.get("for")?.toLowerCase() ?? null;
  return first?.toLowerCase() ?? null;
}

export function parseBoard(jobBoardUrl: string): Board | null {
  let url: URL;
  try {
    url = new URL(jobBoardUrl);
  } catch {
    return null;
  }
  const host = hostOf(url);
  const ats = atsOf(host);
  if (!ats) return { kind: "own", host };
  const slug = atsSlug(ats, url);
  return slug ? { kind: "ats", ats, slug, host } : null;
}

const ID_SEGMENT = /\d{4,}|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Segments whose child is usually a single posting: /jobs/<posting>
const POSTING_PARENT = /^(job|jobs|position|positions|opening|openings|role|roles|vacancy|vacancies|requisition|req)$/i;
// Paths that are search, category, or landing pages, never a single posting.
const LISTING_SEGMENT =
  /^(jobs?|careers?|search|search-jobs|search-results|results|openings|positions|locations?|teams?|departments?|categor(y|ies)|job-categories|find-your-team|students|early-careers|benefits|about|life|culture)$/i;
const SEARCH_PARAMS = ["q", "query", "keyword", "keywords", "search", "page", "offset", "location", "locations", "team", "department", "category"];

/**
 * Removes parts of a URL that don't identify the posting: the hash, and
 * "/apply..." application pages (".../apply", ".../apply/applyManually").
 */
export function normalizePostingUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  url.pathname = url.pathname.replace(/\/(apply|application)(\/.*)?$/i, "").replace(/\/$/, "");
  return url.toString();
}

/** True if `raw` is a single job posting on this company's board (not a search/listing page). */
export function isPostingUrl(raw: string, board: Board): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = hostOf(url);
  const segs = segmentsOf(url);
  const lower = segs.map((s) => s.toLowerCase());

  if (board.kind === "ats") {
    if (atsOf(host) !== board.ats || atsSlug(board.ats, url) !== board.slug) return false;
    switch (board.ats) {
      case "greenhouse": // /slug/jobs/123456 or /embed/job_app?for=slug&token=123456
        if (lower[0] === "embed") return lower[1] === "job_app" && /^\d+$/.test(url.searchParams.get("token") ?? "");
        return lower[1] === "jobs" && /^\d+$/.test(segs[2] ?? "");
      case "lever": // /slug/<uuid>
      case "ashby":
        return UUID_SEGMENT.test(segs[1] ?? "");
      case "smartrecruiters": // jobs.smartrecruiters.com/Slug/744000012345678-business-analyst
        return /^\d{6,}/.test(segs[1] ?? "");
      case "workday": {
        // /en-US/Site/job/Austin-TX/Business-Analyst_R12345
        const idx = lower.indexOf("job");
        return idx >= 0 && idx < segs.length - 1;
      }
    }
  }

  // Company-owned careers site.
  if (!onHost(host, board.host)) return false;
  if (url.searchParams.has("gh_jid")) return true; // Greenhouse embedded on the company site
  if (SEARCH_PARAMS.some((p) => url.searchParams.has(p))) return false;
  const last = lower[lower.length - 1];
  if (!last || LISTING_SEGMENT.test(last)) return false;
  if (lower.some((s) => /^(search|search-jobs|job-categories|find-your-team|categories|departments|teams|locations)$/.test(s))) {
    return false;
  }
  return segs.some((s, i) => ID_SEGMENT.test(s) || (i > 0 && POSTING_PARENT.test(segs[i - 1])));
}

function roleWords(role: string): string[] {
  return role.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
}

/**
 * Keeps posting URLs on this company's board, drops duplicates, puts results
 * that mention the role first, and returns at most MAX_POSTINGS_PER_COMPANY.
 */
export function pickPostings(results: TavilyResult[], board: Board, role: string): TavilyResult[] {
  const words = roleWords(role);
  const mentions = (r: TavilyResult) => {
    const hay = `${r.title} ${r.url}`.toLowerCase().replace(/[-_]/g, " ");
    return words.filter((w) => hay.includes(w)).length;
  };

  const seen = new Set<string>();
  const kept: TavilyResult[] = [];
  for (const r of results) {
    const url = normalizePostingUrl(r.url);
    if (!url || seen.has(url) || !isPostingUrl(url, board)) continue;
    seen.add(url);
    kept.push({ ...r, url });
  }
  // Stable sort: more role words in the title/URL first, otherwise Tavily's order.
  return kept
    .map((r, i) => ({ r, i, m: mentions(r) }))
    .sort((a, b) => b.m - a.m || a.i - b.i)
    .slice(0, MAX_POSTINGS_PER_COMPANY)
    .map(({ r }) => r);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

// Page text that means the posting is gone.
const CLOSED_TEXT =
  /page you are looking for (doesn't|does not) exist|no longer (available|accepting applications)|(job|position) (is|has been) (closed|filled)/i;
// Cookie banners and skip links: noise that would eat the character budget.
const BOILERPLATE_LINE =
  /\bcookies?\b.*\b(accept|consent|privacy|policy|preferences|practices|settings)\b|^\[skip to (main )?content\]|^(decline|accept( all)?( cookies)?)$/i;
// Less real text than this after cleanup means the page didn't render.
const MIN_POSTING_CHARS = 300;

/** Drops images, cookie banners, and runs of blank lines from scraped markdown. */
export function cleanPostingText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // markdown images
    .split("\n")
    .filter((line) => !BOILERPLATE_LINE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ScrapedPage = { kind: "ok"; text: string } | { kind: "closed" } | { kind: "empty" };

/** Classifies scraped markdown: usable text, a closed posting, or an unrendered shell. */
export function readScrapedPage(markdown: string): ScrapedPage {
  const text = cleanPostingText(markdown);
  if (CLOSED_TEXT.test(text)) return { kind: "closed" };
  if (text.length < MIN_POSTING_CHARS) return { kind: "empty" };
  return { kind: "ok", text };
}

const PAY_LINE =/\$\s?\d|€\s?\d|£\s?\d|salary|compensation|pay range|base pay|hourly|per hour|annual(ly)?|\bOTE\b/i;
const PAY_BUDGET = 600;

/**
 * Shortens posting text to about `max` characters. Pay details often sit at
 * the bottom of a posting, so when the text is cut, lines that mention pay
 * are kept from the tail (verbatim, nothing is parsed).
 */
export function truncatePosting(text: string, max = MAX_POSTING_CHARS): string {
  const clean = cleanPostingText(text);
  if (clean.length <= max) return clean;

  const cutAt = (s: string, n: number) => {
    if (s.length <= n) return s;
    const slice = s.slice(0, n);
    const space = slice.lastIndexOf(" ");
    return (space > n * 0.8 ? slice.slice(0, space) : slice).trimEnd();
  };

  const headBudget = max - PAY_BUDGET;
  const head = cutAt(clean, headBudget);
  const tail = clean.slice(head.length);
  const payLines = tail
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && PAY_LINE.test(l));

  if (payLines.length === 0) return `${cutAt(clean, max)}…`;
  return `${head}\n…\n${cutAt(payLines.join("\n"), PAY_BUDGET - 3)}`;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

function parseInput(input: unknown): { role: string; location?: string } {
  const { role, location } = (input ?? {}) as Record<string, unknown>;
  if (typeof role !== "string" || !role.trim()) throw new Error("role must be a non-empty string");
  if (role.length > MAX_INPUT_LENGTH) throw new Error("role is too long");
  if (location !== undefined && (typeof location !== "string" || location.length > MAX_INPUT_LENGTH)) {
    throw new Error("location must be a short string");
  }
  const loc = typeof location === "string" ? location.trim() : "";
  return { role: role.trim(), ...(loc ? { location: loc } : {}) };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

type Counters = { searches: number; scrapes: number };

async function searchCompany(
  employer: SavedEmployerRow,
  role: string,
  location: string | undefined,
  deps: FindOpenRolesDeps,
  counters: Counters,
): Promise<CompanyRoles> {
  const base = { company: employer.company, jobBoardUrl: employer.job_board_url };
  const board = parseBoard(employer.job_board_url!);
  if (!board) return { ...base, postings: [], note: "Could not read job board" };

  const terms = [role, location, "job"].filter(Boolean).join(" ");
  // Own domain: restrict the search to it. Shared ATS host: other companies
  // live there too, so name the company and filter by board path afterwards.
  const [query, options]: [string, TavilySearchOptions] =
    board.kind === "own"
      ? [`${employer.company} ${terms}`, { maxResults: 10, includeDomains: [board.host] }]
      : [`${employer.company} ${terms} ${board.host}`, { maxResults: 10, excludeDomains: AGGREGATOR_DOMAINS }];

  counters.searches++;
  const results = await deps.search(query, options);
  const picked = pickPostings(results, board, role);
  if (picked.length === 0) return { ...base, postings: [], note: "No matching postings found" };

  const postings = await Promise.all(
    picked.map(async (result): Promise<Posting | null> => {
      counters.scrapes++;
      const scraped = await deps.scrape(result.url);
      // The page answered "not found": the posting is closed. Don't show it.
      if (scraped.status === 404 || scraped.status === 410) return null;
      if (scraped.markdown) {
        const page = readScrapedPage(scraped.markdown);
        if (page.kind === "closed") return null;
        if (page.kind === "ok") return { url: result.url, text: truncatePosting(page.text) };
        // "empty": the page didn't render. Fall back to the snippet below.
      }
      const snippet = result.content?.trim();
      return snippet ? { url: result.url, text: truncatePosting(snippet) } : null;
    }),
  );

  const open = postings.filter((p): p is Posting => p !== null);
  if (open.length === 0) return { ...base, postings: [], note: "No matching postings found" };
  return { ...base, postings: open };
}

export async function findOpenRoles(
  sessionId: string,
  input: unknown,
  deps: FindOpenRolesDeps = defaultDeps,
): Promise<FindOpenRolesResult> {
  const { role, location } = parseInput(input);
  const employers = await deps.loadEmployers(sessionId);
  if (employers.length === 0) {
    return {
      message:
        "The user has no saved companies yet. Ask them which companies they want you to look at before searching for roles.",
    };
  }

  return Promise.all(
    employers.map(async (employer): Promise<CompanyRoles> => {
      const base = { company: employer.company, jobBoardUrl: employer.job_board_url };
      if (!employer.job_board_url) return { ...base, postings: [], note: "No job board found" };

      const started = Date.now();
      const counters: Counters = { searches: 0, scrapes: 0 };
      const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
      try {
        const result = await withTimeout(
          searchCompany(employer, role, location, deps, counters),
          deps.companyTimeoutMs,
        );
        console.log(
          `[find_open_roles] ${employer.company}: ${result.postings.length} postings in ${elapsed()} ` +
            `(${counters.searches} search, ${counters.scrapes} scrapes)${result.note ? ` - ${result.note}` : ""}`,
        );
        return result;
      } catch (err) {
        console.error(
          `[find_open_roles] ${employer.company}: failed after ${elapsed()} ` +
            `(${counters.searches} search, ${counters.scrapes} scrapes):`,
          err instanceof Error ? err.message : err,
        );
        return { ...base, postings: [], note: "Could not read job board" };
      }
    }),
  );
}
