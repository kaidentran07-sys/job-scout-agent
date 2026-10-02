import "server-only";
import { tavilySearch, type TavilyResult } from "@/lib/tavily";

// Job aggregators and review sites: never the company's own board.
const EXCLUDED_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "monster.com",
  "builtin.com",
  "wellfound.com",
  "levels.fyi",
  "comparably.com",
];

// Legal suffixes that rarely appear in a company's domain.
const SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company",
  "llc", "ltd", "limited", "plc", "group", "holdings",
]);

const CAREERS_SIGNAL = /career|jobs?\b|jobs\.|join|talent|hiring|opportunit|work-?with/i;
const CAREERS_SEGMENT =
  /^(careers?|jobs?|job-search|search-jobs|openings|positions|join-us|work-with-us)$/i;
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2})?$/i;

/** Known applicant-tracking systems. `slug` returns the company identifier in the URL. */
const ATS_HOSTS: {
  test: (host: string) => boolean;
  slug: (url: URL) => string | null;
  boardRoot: (url: URL, slug: string) => string;
}[] = [
  {
    // boards.greenhouse.io/spotify, job-boards.greenhouse.io/spotify, .../embed/job_board?for=spotify
    test: (h) => h.endsWith("greenhouse.io"),
    slug: (u) => {
      const first = pathSegments(u)[0];
      return first === "embed" ? u.searchParams.get("for") : (first ?? null);
    },
    boardRoot: (_u, slug) => `https://job-boards.greenhouse.io/${slug}`,
  },
  {
    test: (h) => h.endsWith("lever.co"),
    slug: (u) => pathSegments(u)[0] ?? null,
    boardRoot: (u, slug) => `${u.origin}/${slug}`,
  },
  {
    test: (h) => h.endsWith("ashbyhq.com"),
    slug: (u) => pathSegments(u)[0] ?? null,
    boardRoot: (u, slug) => `${u.origin}/${slug}`,
  },
  {
    test: (h) => h.endsWith("smartrecruiters.com"),
    slug: (u) => pathSegments(u)[0] ?? null,
    boardRoot: (u, slug) => `${u.origin}/${slug}`,
  },
  {
    // visa.wd5.myworkdayjobs.com/en-US/Visa_Careers/job/... -> tenant "visa", site "Visa_Careers"
    test: (h) => h.endsWith("myworkdayjobs.com"),
    slug: (u) => u.hostname.split(".")[0] ?? null,
    boardRoot: (u) => {
      const site = pathSegments(u).find((s) => !LOCALE_SEGMENT.test(s));
      return site ? `${u.origin}/${site}` : u.origin;
    },
  },
];

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function companyTokens(company: string): string[] {
  return company
    .toLowerCase()
    .replace(/&/g, "and")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !SUFFIXES.has(t));
}

/** True if `text` starts with the company name ("spotify", "jpmorgan..."). */
function startsWithCompany(text: string, tokens: string[]): boolean {
  const s = squash(text);
  const full = tokens.join("");
  if (full.length >= 3 && s.startsWith(full)) return true;
  // "JPMorgan Chase" -> jpmorgan.com. Short first words ("bank") are too generic.
  return tokens.length > 1 && tokens[0].length >= 5 && s.startsWith(tokens[0]);
}

// Two-part public suffixes, so "visa.co.in" -> label "visa".
const TWO_PART_SUFFIX = /\.(co|com|org|net|ac|gov)\.[a-z]{2}$/;
// Careers-site naming patterns: lifeatspotify.com, careersatfoo.com, joinfoo.com
const LABEL_PREFIXES = ["lifeat", "careersat", "jobsat", "workat", "join"];
// Company subdomains that are not job boards.
const NON_CAREERS_SUBDOMAIN =
  /^(engineering|blog|news|newsroom|community|support|help|investors?|ir|press|developer|developers|shop|store)$/;
// Generic TLDs; anything else two letters long is treated as a regional site.
const GLOBAL_TLDS = new Set(["com", "io", "co", "ai", "org", "net", "jobs", "careers"]);

/** Splits a hostname into its registrable label and its subdomains. */
function splitHost(host: string): { label: string; subdomains: string[]; tld: string } {
  const suffixMatch = host.match(TWO_PART_SUFFIX);
  const suffix = suffixMatch ? suffixMatch[0].slice(1) : host.split(".").slice(-1)[0];
  const parts = host.slice(0, host.length - suffix.length - 1).split(".");
  const tld = suffix.split(".").slice(-1)[0];
  return { label: parts[parts.length - 1] ?? "", subdomains: parts.slice(0, -1), tld };
}

/** True if the registrable domain belongs to the company (spotify.com, lifeatspotify.com). */
function isCompanyDomain(label: string, tokens: string[]): boolean {
  if (startsWithCompany(label, tokens)) return true;
  const prefix = LABEL_PREFIXES.find((p) => label.startsWith(p));
  return prefix !== undefined && startsWithCompany(label.slice(prefix.length), tokens);
}

/** For a company-owned URL, trim deep links back to the careers section. */
function ownDomainRoot(url: URL): string {
  const segments = pathSegments(url);
  const idx = segments.findIndex((s) => CAREERS_SEGMENT.test(s));
  const kept = idx >= 0 ? segments.slice(0, idx + 1) : segments;
  return `${url.origin}${kept.length ? `/${kept.join("/")}` : ""}`;
}

type Candidate = { url: string; host: string; score: number };

// Below this, a company-domain match is too weak to call it the job board.
const MIN_SCORE = 3;

/** Scores one search result. Returns null if it is not this company's job board. */
function scoreResult(rawUrl: string, tokens: string[]): Candidate | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return null;

  // 1. A known ATS board whose slug is the company: the actual postings live here.
  const ats = ATS_HOSTS.find((a) => a.test(host));
  if (ats) {
    const slug = ats.slug(url);
    if (!slug || !startsWithCompany(slug, tokens)) return null;
    return { url: ats.boardRoot(url, slug), host, score: 10 };
  }

  // 2. The company's own domain with a careers signal.
  const { label, subdomains, tld } = splitHost(host);
  if (!isCompanyDomain(label, tokens)) return null;
  if (!CAREERS_SIGNAL.test(host + url.pathname)) return null;

  let score = 5;
  if (subdomains.some((s) => /^(careers?|jobs?)$/.test(s))) score += 2;
  if (LABEL_PREFIXES.some((p) => label.startsWith(p))) score += 2;
  if (pathSegments(url).some((s) => CAREERS_SEGMENT.test(s))) score += 1;
  if (subdomains.some((s) => NON_CAREERS_SUBDOMAIN.test(s))) score -= 4;
  if (!GLOBAL_TLDS.has(tld)) score -= 2; // visa.co.in, foo.de: regional site
  return { url: ownDomainRoot(url), host, score };
}

/**
 * Picks the most likely official job board from search results, or null.
 * Ranks every result: a known ATS board whose slug matches the company first,
 * then a company-owned careers site. Ties go to the host seen most often,
 * then to Tavily's order. Never guesses.
 */
export function pickJobBoard(company: string, results: TavilyResult[]): string | null {
  const tokens = companyTokens(company);
  if (tokens.length === 0) return null;

  const candidates = results.flatMap((r) => scoreResult(r.url, tokens) ?? []);
  // Tie-breaker: a host that shows up in several results is more likely the live board.
  const hostCount = new Map<string, number>();
  for (const c of candidates) hostCount.set(c.host, (hostCount.get(c.host) ?? 0) + 1);

  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate.score < MIN_SCORE) continue;
    const score = candidate.score + Math.min(1.5, 0.5 * ((hostCount.get(candidate.host) ?? 1) - 1));
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best?.url ?? null;
}

/** Searches the web for a company's official careers / job board URL. */
export async function findJobBoard(company: string): Promise<string | null> {
  const results = await tavilySearch(`${company} careers jobs official site`, {
    maxResults: 10,
    excludeDomains: EXCLUDED_DOMAINS,
  });
  return pickJobBoard(company, results);
}
