import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { findJobBoard } from "@/lib/findJobBoard";

const TABLE = "job_scout_employers";
const MAX_COMPANIES = 15;
const MAX_NAME_LENGTH = 100;

export const updateEmployerListTool: Anthropic.Beta.BetaTool = {
  name: "update_employer_list",
  description:
    "Call this when the user names one or more companies they want to watch or look for jobs at (for example: 'I'm interested in Spotify and Visa' or 'add TikTok'). Saves the companies to the user's watch list and finds each company's official job board URL from the name alone. Do NOT call this for general career questions, and do NOT call it when the user is only asking to see jobs for companies that are already saved.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      companies: {
        type: "array",
        items: { type: "string" },
        description:
          'Company names as the user said them, e.g. ["Spotify", "Visa"].',
      },
      mode: {
        type: "string",
        enum: ["replace", "add"],
        description:
          '"replace" when the user gives a fresh list of companies; "add" when they add to the existing list (e.g. "add Airbnb too").',
      },
    },
    required: ["companies", "mode"],
    additionalProperties: false,
  },
};

export type SavedEmployer = { company: string; jobBoardUrl: string | null };

type Input = { companies: string[]; mode: "replace" | "add" };

/** Case/whitespace-insensitive key so "spotify " and "Spotify" are one company. */
const keyOf = (company: string) => company.trim().toLowerCase().replace(/\s+/g, " ");

function parseInput(input: unknown): Input {
  const { companies, mode } = (input ?? {}) as Record<string, unknown>;
  if (mode !== "replace" && mode !== "add") {
    throw new Error('mode must be "replace" or "add"');
  }
  if (!Array.isArray(companies) || companies.length === 0) {
    throw new Error("companies must be a non-empty array of company names");
  }

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of companies) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_NAME_LENGTH || seen.has(keyOf(name))) continue;
    seen.add(keyOf(name));
    cleaned.push(name);
  }
  if (cleaned.length === 0) throw new Error("No valid company names were given");
  if (cleaned.length > MAX_COMPANIES) {
    throw new Error(`Too many companies (max ${MAX_COMPANIES} at once)`);
  }
  return { companies: cleaned, mode };
}

export async function updateEmployerList(
  sessionId: string,
  input: unknown,
): Promise<SavedEmployer[]> {
  const { companies, mode } = parseInput(input);
  const db = getSupabase();

  const { data: existing, error: loadError } = await db
    .from(TABLE)
    .select("id, company, job_board_url")
    .eq("session_id", sessionId);
  if (loadError) throw new Error(`Could not load the watch list: ${loadError.message}`);

  const existingByKey = new Map(existing.map((row) => [keyOf(row.company), row]));

  if (mode === "replace") {
    const keep = new Set(companies.map(keyOf));
    const staleIds = existing.filter((row) => !keep.has(keyOf(row.company))).map((row) => row.id);
    if (staleIds.length > 0) {
      const { error } = await db.from(TABLE).delete().in("id", staleIds);
      if (error) throw new Error(`Could not clear old companies: ${error.message}`);
    }
  }

  const rows = await Promise.all(
    companies.map(async (name) => {
      const prior = existingByKey.get(keyOf(name));
      // Reuse the saved spelling so the (session_id, company) upsert hits the same row.
      const company: string = prior?.company ?? name;
      // "add" mode only: a company that's already saved keeps its URL (saves
      // Tavily credits). "replace" always re-searches and overwrites.
      if (mode === "add" && prior?.job_board_url) {
        return { session_id: sessionId, company, job_board_url: prior.job_board_url as string };
      }
      try {
        const url = await findJobBoard(name);
        console.log(`[update_employer_list] ${name} -> ${url ?? "no job board found"}`);
        return { session_id: sessionId, company, job_board_url: url };
      } catch (err) {
        console.error(`[update_employer_list] job board search failed for ${name}:`, err);
        return { session_id: sessionId, company, job_board_url: null };
      }
    }),
  );

  const { error: upsertError } = await db
    .from(TABLE)
    .upsert(rows, { onConflict: "session_id,company" });
  if (upsertError) throw new Error(`Could not save companies: ${upsertError.message}`);

  const { data: saved, error: listError } = await db
    .from(TABLE)
    .select("company, job_board_url")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (listError) throw new Error(`Could not read the watch list: ${listError.message}`);

  return saved.map((row) => ({ company: row.company, jobBoardUrl: row.job_board_url }));
}
