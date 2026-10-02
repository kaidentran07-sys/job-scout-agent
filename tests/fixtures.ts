import type { TavilyResult } from "@/lib/tavily";

export const result = (url: string, content = "", title = ""): TavilyResult => ({
  title,
  url,
  content,
  score: 1,
});

/** Shaped like real Tavily results for "Spotify business analyst job jobs.lever.co". */
export const SPOTIFY_ROLE_RESULTS: TavilyResult[] = [
  result("https://jobs.lever.co/spotify", "Spotify jobs board", "Spotify - Jobs"),
  result(
    "https://jobs.lever.co/spotify/0b1c2d3e-1111-4a5b-8c9d-0123456789ab",
    "Business Analyst, Finance. Stockholm or New York. We are looking for a Business Analyst...",
    "Spotify - Business Analyst, Finance",
  ),
  result(
    "https://jobs.lever.co/spotify/0b1c2d3e-1111-4a5b-8c9d-0123456789ab/apply",
    "Apply for Business Analyst, Finance",
    "Spotify - Business Analyst, Finance - Apply",
  ),
  result(
    "https://jobs.lever.co/otherco/9f8e7d6c-2222-4a5b-8c9d-0123456789ab",
    "Business Analyst at OtherCo",
    "OtherCo - Business Analyst",
  ),
  result("https://www.linkedin.com/jobs/view/123456789", "Spotify Business Analyst", "LinkedIn"),
  result(
    "https://jobs.lever.co/spotify/aaaaaaaa-3333-4a5b-8c9d-0123456789ab",
    "Senior Backend Engineer...",
    "Spotify - Senior Backend Engineer",
  ),
  result(
    "https://jobs.lever.co/spotify/bbbbbbbb-4444-4a5b-8c9d-0123456789ab",
    "Data Analyst, Ads...",
    "Spotify - Data Analyst, Ads",
  ),
  result(
    "https://jobs.lever.co/spotify/cccccccc-5555-4a5b-8c9d-0123456789ab",
    "Business Analyst, Content Operations...",
    "Spotify - Business Analyst, Content Operations",
  ),
];

/** Shaped like real Tavily results for Visa on Workday. */
export const VISA_ROLE_RESULTS: TavilyResult[] = [
  result("https://visa.wd5.myworkdayjobs.com/Visa", "Visa careers", "Careers at Visa"),
  result(
    "https://visa.wd5.myworkdayjobs.com/Visa?q=business%20analyst",
    "Search results",
    "Search for jobs",
  ),
  result(
    "https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/Austin-Texas/Business-Analyst_REF12345",
    "Business Analyst. Austin, Texas. The annual base salary range is $95,000 to $130,000.",
    "Business Analyst - Visa",
  ),
  result(
    "https://otherbank.wd1.myworkdayjobs.com/en-US/Careers/job/Austin/Business-Analyst_R999",
    "Business Analyst at Other Bank",
    "Business Analyst - Other Bank",
  ),
];

/** A long scraped posting with pay info near the bottom. */
export const LONG_POSTING_MARKDOWN = [
  "# Business Analyst",
  "![Visa logo](https://example.com/logo.png)",
  "Austin, Texas · Hybrid",
  "",
  "## About the role",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(80),
  "",
  "## Pay",
  "The annual base salary range for this position is $95,000 to $130,000.",
  "",
  "## Equal opportunity",
  "We are an equal opportunity employer.",
].join("\n");

const WORKDAY_CHROME = [
  "[Skip to main content](https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/X)",
  "",
  "Visa’s career pages are provided by Workday. Workday will only use non-essential cookies at Visa’s instruction and with your permission. To view more information on Workday's cookie practices, click [here](https://example.com).",
  "",
  "Decline",
  "",
  "Accept Cookies",
  "",
];

/** Real shape of a Workday page scraped before it finished rendering. */
export const WORKDAY_LOADING_SHELL = [...WORKDAY_CHROME, "Loading", "", "#### Follow Us", "- [LinkedIn](https://www.linkedin.com/company/visa)"].join("\n");

/** Real shape of a Workday page for a removed posting (HTTP 200, not 404). */
export const WORKDAY_CLOSED_PAGE = [...WORKDAY_CHROME, "The page you are looking for doesn't exist.", "", "Search for Jobs"].join("\n");

/** A rendered Workday posting, with its cookie banner still on top. */
export const WORKDAY_RENDERED_POSTING = [
  ...WORKDAY_CHROME,
  "Sr. Business Analyst - Value-Added Services (VAS) Deal Management",
  "US - San Francisco, CA",
  "",
  "Job Description: You will partner with deal teams to ... ".repeat(8),
  "",
  "The annual base salary range for this position is $120,000 to $160,000.",
].join("\n");
