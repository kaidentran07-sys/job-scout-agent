import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  findOpenRoles,
  isPostingUrl,
  parseBoard,
  normalizePostingUrl,
  pickPostings,
  readScrapedPage,
  truncatePosting,
  type Board,
  type CompanyRoles,
  type FindOpenRolesDeps,
  type SavedEmployerRow,
} from "@/lib/tools/findOpenRoles";
import type { TavilySearchOptions } from "@/lib/tavily";
import type { ScrapeResult } from "@/lib/firecrawl";
import {
  LONG_POSTING_MARKDOWN,
  SPOTIFY_ROLE_RESULTS,
  VISA_ROLE_RESULTS,
  WORKDAY_CLOSED_PAGE,
  WORKDAY_LOADING_SHELL,
  WORKDAY_RENDERED_POSTING,
  result,
} from "./fixtures";

const SESSION = "00000000-0000-4000-8000-000000000000";
const board = (url: string) => parseBoard(url) as Board;

/** Fake Tavily/Firecrawl/Supabase that records every call. */
function fakeDeps(opts: {
  employers: SavedEmployerRow[];
  search?: (query: string, options: TavilySearchOptions) => Promise<ReturnType<typeof result>[]>;
  scrape?: (url: string) => Promise<ScrapeResult>;
  companyTimeoutMs?: number;
}) {
  const calls = { searches: [] as { query: string; options: TavilySearchOptions }[], scrapes: [] as string[] };
  const deps: FindOpenRolesDeps = {
    loadEmployers: async () => opts.employers,
    search: async (query, options) => {
      calls.searches.push({ query, options });
      return opts.search ? opts.search(query, options) : [];
    },
    scrape: async (url) => {
      calls.scrapes.push(url);
      return opts.scrape ? opts.scrape(url) : { markdown: `# Posting\n${"Scraped posting text. ".repeat(20)}\n${url}` };
    },
    companyTimeoutMs: opts.companyTimeoutMs ?? 2_000,
  };
  return { deps, calls };
}

// Keep tool logs out of the test output.
console.log = () => {};
console.error = () => {};

describe("posting URL filtering", () => {
  const lever = board("https://jobs.lever.co/spotify");
  const workday = board("https://visa.wd5.myworkdayjobs.com/Visa");
  const greenhouse = board("https://job-boards.greenhouse.io/airbnb");
  const own = board("https://www.lifeatspotify.com/jobs");

  const cases: [string, Board, string, boolean][] = [
    ["Lever posting", lever, "https://jobs.lever.co/spotify/0b1c2d3e-1111-4a5b-8c9d-0123456789ab", true],
    ["Lever board root", lever, "https://jobs.lever.co/spotify", false],
    ["Lever, other company", lever, "https://jobs.lever.co/otherco/0b1c2d3e-1111-4a5b-8c9d-0123456789ab", false],
    ["Workday posting", workday, "https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/Austin-Texas/Business-Analyst_REF12345", true],
    ["Workday search page", workday, "https://visa.wd5.myworkdayjobs.com/Visa?q=analyst", false],
    ["Workday, other tenant", workday, "https://otherbank.wd1.myworkdayjobs.com/en-US/Careers/job/Austin/BA_R9", false],
    ["Greenhouse posting", greenhouse, "https://boards.greenhouse.io/airbnb/jobs/7084215", true],
    ["Greenhouse listing", greenhouse, "https://job-boards.greenhouse.io/airbnb", false],
    ["Greenhouse embed posting", greenhouse, "https://boards.greenhouse.io/embed/job_app?for=airbnb&token=7084215", true],
    ["own site posting", own, "https://www.lifeatspotify.com/jobs/business-analyst-finance", true],
    ["own site listing", own, "https://www.lifeatspotify.com/jobs", false],
    ["own site search", own, "https://www.lifeatspotify.com/jobs?q=analyst", false],
    ["own site category page", own, "https://www.lifeatspotify.com/find-your-team/job-categories/product", false],
    ["own site gh_jid posting", board("https://careers.airbnb.com"), "https://careers.airbnb.com/positions/?gh_jid=7084215", true],
    ["different domain", own, "https://www.example.com/jobs/business-analyst-123", false],
  ];
  for (const [name, b, url, expected] of cases) {
    test(name, () => assert.equal(isPostingUrl(url, b), expected));
  }
});

describe("pickPostings", () => {
  test("caps at 3 per company, dedupes /apply, puts role matches first", () => {
    const picked = pickPostings(SPOTIFY_ROLE_RESULTS, board("https://jobs.lever.co/spotify"), "business analyst");
    assert.equal(picked.length, 3);
    assert.deepEqual(
      picked.map((r) => r.url),
      [
        "https://jobs.lever.co/spotify/0b1c2d3e-1111-4a5b-8c9d-0123456789ab",
        "https://jobs.lever.co/spotify/cccccccc-5555-4a5b-8c9d-0123456789ab",
        "https://jobs.lever.co/spotify/bbbbbbbb-4444-4a5b-8c9d-0123456789ab",
      ],
    );
  });

  test("drops search pages and other companies' postings", () => {
    const picked = pickPostings(VISA_ROLE_RESULTS, board("https://visa.wd5.myworkdayjobs.com/Visa"), "business analyst");
    assert.deepEqual(picked.map((r) => r.url), [
      "https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/Austin-Texas/Business-Analyst_REF12345",
    ]);
  });
});

describe("truncatePosting", () => {
  test("leaves short text alone", () => {
    assert.equal(truncatePosting("Business Analyst\nAustin, TX"), "Business Analyst\nAustin, TX");
  });

  test("cuts long text to about 2,500 chars and keeps the pay line from the tail", () => {
    assert.ok(LONG_POSTING_MARKDOWN.length > 4000);
    const out = truncatePosting(LONG_POSTING_MARKDOWN);
    assert.ok(out.length <= 2500, `length ${out.length}`);
    assert.ok(out.startsWith("# Business Analyst"));
    assert.ok(out.includes("$95,000 to $130,000"));
    assert.ok(!out.includes("![Visa logo]"), "images are stripped");
  });

  test("adds an ellipsis when there is no pay line to keep", () => {
    const out = truncatePosting("word ".repeat(1000));
    assert.ok(out.length <= 2501 && out.endsWith("…"));
  });
});

describe("findOpenRoles", () => {
  test("empty saved list: tells the model to ask, no searches", async () => {
    const { deps, calls } = fakeDeps({ employers: [] });
    const out = await findOpenRoles(SESSION, { role: "business analyst" }, deps);
    assert.ok(!Array.isArray(out) && /ask them which companies/i.test(out.message));
    assert.equal(calls.searches.length, 0);
  });

  test("null job board: note, and no search for that company", async () => {
    const { deps, calls } = fakeDeps({
      employers: [
        { company: "Qwertyzxv Labs", job_board_url: null },
        { company: "Spotify", job_board_url: "https://jobs.lever.co/spotify" },
      ],
      search: async () => SPOTIFY_ROLE_RESULTS,
    });
    const out = (await findOpenRoles(SESSION, { role: "business analyst" }, deps)) as CompanyRoles[];
    assert.deepEqual(out[0], { company: "Qwertyzxv Labs", jobBoardUrl: null, postings: [], note: "No job board found" });
    assert.equal(out[1].postings.length, 3);
    assert.equal(calls.searches.length, 1);
    assert.equal(calls.scrapes.length, 3);
  });

  test("Firecrawl failure falls back to the Tavily snippet; 404 drops the posting", async () => {
    const { deps } = fakeDeps({
      employers: [{ company: "Visa", job_board_url: "https://visa.wd5.myworkdayjobs.com/Visa" }],
      search: async () => [
        ...VISA_ROLE_RESULTS,
        result("https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/Remote/Closed-Role_REF999", "Old posting"),
      ],
      scrape: async (url) => (url.includes("Closed-Role") ? { markdown: null, status: 404 } : { markdown: null }),
    });
    const [visa] = (await findOpenRoles(SESSION, { role: "business analyst" }, deps)) as CompanyRoles[];
    assert.equal(visa.postings.length, 1);
    assert.equal(
      visa.postings[0].text,
      "Business Analyst. Austin, Texas. The annual base salary range is $95,000 to $130,000.",
    );
    assert.equal(visa.note, undefined);
  });

  test("no matching postings: note", async () => {
    const { deps } = fakeDeps({
      employers: [{ company: "Spotify", job_board_url: "https://jobs.lever.co/spotify" }],
      search: async () => [result("https://jobs.lever.co/spotify")],
    });
    const [spotify] = (await findOpenRoles(SESSION, { role: "zookeeper" }, deps)) as CompanyRoles[];
    assert.deepEqual(spotify.postings, []);
    assert.equal(spotify.note, "No matching postings found");
  });

  test("search error or timeout: 'Could not read job board', other companies still return", async () => {
    const { deps } = fakeDeps({
      employers: [
        { company: "Spotify", job_board_url: "https://jobs.lever.co/spotify" },
        { company: "Visa", job_board_url: "https://visa.wd5.myworkdayjobs.com/Visa" },
        { company: "Airbnb", job_board_url: "https://careers.airbnb.com" },
      ],
      search: async (query) => {
        if (query.startsWith("Visa")) throw new Error("Tavily 500");
        if (query.startsWith("Airbnb")) return new Promise(() => {}); // never resolves
        return SPOTIFY_ROLE_RESULTS;
      },
      companyTimeoutMs: 100,
    });
    const out = (await findOpenRoles(SESSION, { role: "business analyst" }, deps)) as CompanyRoles[];
    assert.equal(out[0].postings.length, 3);
    assert.equal(out[1].note, "Could not read job board");
    assert.equal(out[2].note, "Could not read job board");
  });

  test("query shape: ATS names the company, own domain uses include_domains", async () => {
    const { deps, calls } = fakeDeps({
      employers: [
        { company: "Spotify", job_board_url: "https://jobs.lever.co/spotify" },
        { company: "Airbnb", job_board_url: "https://careers.airbnb.com" },
      ],
    });
    await findOpenRoles(SESSION, { role: "data analyst", location: "remote" }, deps);
    const [ats, own] = calls.searches;
    assert.equal(ats.query, "Spotify data analyst remote job jobs.lever.co");
    assert.equal(ats.options.includeDomains, undefined);
    assert.deepEqual(own.options.includeDomains, ["careers.airbnb.com"]);
  });

  test("no location given: none is added to the query", async () => {
    const { deps, calls } = fakeDeps({
      employers: [{ company: "Spotify", job_board_url: "https://jobs.lever.co/spotify" }],
    });
    await findOpenRoles(SESSION, { role: "business analyst" }, deps);
    assert.equal(calls.searches[0].query, "Spotify business analyst job jobs.lever.co");
  });

  test("rejects input without a role", async () => {
    const { deps } = fakeDeps({ employers: [] });
    await assert.rejects(findOpenRoles(SESSION, { location: "remote" }, deps), /role/);
  });
});

describe("scraped page handling (real Workday shapes)", () => {
  test("strips /apply/applyManually so it dedupes with the posting", () => {
    assert.equal(
      normalizePostingUrl("https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/SF/BA_REF1/apply/applyManually"),
      "https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/SF/BA_REF1",
    );
    assert.equal(normalizePostingUrl("https://jobs.lever.co/spotify/abc/apply#top"), "https://jobs.lever.co/spotify/abc");
  });

  test("unrendered shell is 'empty', closed page is 'closed'", () => {
    assert.equal(readScrapedPage(WORKDAY_LOADING_SHELL).kind, "empty");
    assert.equal(readScrapedPage(WORKDAY_CLOSED_PAGE).kind, "closed");
  });

  test("rendered posting keeps the content and drops the cookie banner", () => {
    const page = readScrapedPage(WORKDAY_RENDERED_POSTING);
    assert.equal(page.kind, "ok");
    if (page.kind !== "ok") return;
    assert.ok(page.text.startsWith("Sr. Business Analyst - Value-Added Services"));
    assert.ok(!/cookie|Skip to main content|^Decline$/im.test(page.text));
    assert.ok(page.text.includes("$120,000 to $160,000"));
  });

  test("keeps real lines that merely mention cookies", () => {
    const text = `${"Bake and decorate cookies for our stores. ".repeat(10)}`;
    assert.equal(readScrapedPage(text).kind, "ok");
  });

  test("shell falls back to the Tavily snippet; closed page is dropped", async () => {
    const live = "https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/SF/Business-Analyst_REF1";
    const gone = "https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/SF/Business-Analyst_REF2";
    const { deps } = fakeDeps({
      employers: [{ company: "Visa", job_board_url: "https://visa.wd5.myworkdayjobs.com/Visa" }],
      search: async () => [
        result(live, "Business Analyst. San Francisco, CA. Salary $120,000 to $160,000."),
        result(gone, "Business Analyst (old)"),
      ],
      scrape: async (url) => ({ markdown: url === gone ? WORKDAY_CLOSED_PAGE : WORKDAY_LOADING_SHELL, status: 200 }),
    });
    const [visa] = (await findOpenRoles(SESSION, { role: "business analyst" }, deps)) as CompanyRoles[];
    assert.deepEqual(visa.postings, [
      { url: live, text: "Business Analyst. San Francisco, CA. Salary $120,000 to $160,000." },
    ]);
  });
});
