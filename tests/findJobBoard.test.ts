import { test } from "node:test";
import assert from "node:assert/strict";
import { pickJobBoard } from "@/lib/findJobBoard";
import { result } from "./fixtures";

// Real Tavily results for "<company> careers jobs official site" (2026-10-01).
const SPOTIFY_REAL = [
  "https://www.lifeatspotify.com/start-your-journey",
  "https://engineering.atspotify.com/jobs",
  "https://jobs.lever.co/spotify",
  "https://www.lifeatspotify.com",
  "https://www.lifeatspotify.com/find-your-team/job-categories",
  "https://www.spotify.com/us/about-us/contact",
  "https://www.lifeatspotify.com/find-your-team/job-categories/product",
  "https://www.lifeatspotify.com/find-your-team/locations/new-york",
  "https://www.upwork.com/freelance-jobs/spotify",
  "https://www.lifeatspotify.com/jobs",
];
const VISA_REAL = [
  "https://www.visa.co.in/careers.html",
  "https://visa.wd5.myworkdayjobs.com/Visa",
  "https://www.myvisajobs.com",
  "https://corporate.visa.com/content/VISA/visacorporate/global/en/home/careers.html",
  "https://corporate.visa.com/en/careers/teams/technology.html",
  "https://careers.smartrecruiters.com/visa",
  "https://corporate.visa.com/en/careers/early-careers.html",
  "https://www.visa.com/en-us/careers",
  "https://corporate.visa.com/en/careers.html",
  "https://visa.wd5.myworkdayjobs.com/Visa_Early_Careers",
];

const cases: [string, string, string[], string | null][] = [
  ["real Spotify results", "Spotify", SPOTIFY_REAL, "https://jobs.lever.co/spotify"],
  ["real Visa results", "Visa", VISA_REAL, "https://visa.wd5.myworkdayjobs.com/Visa"],
  ["skips LinkedIn, trims deep link", "Spotify", ["https://www.linkedin.com/company/spotify/jobs", "https://www.lifeatspotify.com/jobs/senior-engineer-123"], "https://www.lifeatspotify.com/jobs"],
  ["engineering blog loses to careers site", "Spotify", ["https://engineering.atspotify.com/jobs", "https://www.lifeatspotify.com/jobs"], "https://www.lifeatspotify.com/jobs"],
  ["regional site loses to .com", "Visa", ["https://www.visa.co.in/careers.html", "https://www.visa.com/en-us/careers"], "https://www.visa.com/en-us/careers"],
  ["unrelated domain containing the name", "Visa", ["https://www.myvisajobs.com"], null],
  ["Workday deep link -> site root", "Visa", ["https://visa.wd5.myworkdayjobs.com/en-US/Visa_Careers/job/Austin/BA_R123"], "https://visa.wd5.myworkdayjobs.com/Visa_Careers"],
  ["Greenhouse embed", "Airbnb", ["https://boards.greenhouse.io/embed/job_board?for=airbnb"], "https://job-boards.greenhouse.io/airbnb"],
  ["Ashby", "Notion", ["https://jobs.ashbyhq.com/notion/abc-123"], "https://jobs.ashbyhq.com/notion"],
  ["Lever, legal suffix dropped", "Palantir Technologies", ["https://jobs.lever.co/palantir/xyz"], "https://jobs.lever.co/palantir"],
  ["first word of multi-word name", "JPMorgan Chase & Co.", ["https://careers.jpmorgan.com/us/en/students"], "https://careers.jpmorgan.com/us/en/students"],
  ["other company's ATS board", "Stripe", ["https://jobs.lever.co/otherco/1", "https://en.wikipedia.org/wiki/Stripe,_Inc."], null],
  ["generic first word", "Bank of America", ["https://www.bankrate.com/careers"], null],
  ["company page without careers signal", "Visa", ["https://visa.com/about"], null],
  ["host seen most often wins a tie", "Visa", ["https://careers.smartrecruiters.com/visa", "https://visa.wd5.myworkdayjobs.com/Visa", "https://visa.wd5.myworkdayjobs.com/Visa_Early_Careers"], "https://visa.wd5.myworkdayjobs.com/Visa"],
  ["community forum is too weak", "Spotify", ["https://community.spotify.com/t5/Social-Random/Job-opportunities/td-p/1"], null],
];

for (const [name, company, urls, expected] of cases) {
  test(`pickJobBoard: ${name}`, () => {
    assert.equal(pickJobBoard(company, urls.map((u) => result(u))), expected);
  });
}
