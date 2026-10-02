import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { TOOLS, runTool } from "@/lib/tools";

export const maxDuration = 60;

const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 2000;
const MAX_ITERATIONS = 6;
const MAX_HISTORY = 40; // most recent messages sent to the model
const MAX_MESSAGE_CHARS = 8000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROR_REPLY =
  "Coach Reed here. My line to headquarters just dropped, and that one's on me, not you. Give it a few seconds and send that again.";
const BAD_REQUEST_REPLY =
  "Hmm, that message didn't come through right. Refresh the page and try me again.";
const REFUSAL_REPLY =
  "That's one I can't help with. Let's get back to your job search. What role or company are you chasing?";
const LOOP_LIMIT_REPLY =
  "I went down a rabbit hole on that one and ran out of steps. Try asking again, maybe a bit more specific.";
const CUT_OFF_NOTE =
  "\n\n_(I ran long and got cut off. Say \"keep going\" and I'll finish.)_";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatRequest = { sessionId: string; messages: ChatMessage[] };

function reply(text: string, toolsUsed: string[] = [], status = 200) {
  return Response.json({ reply: text, toolsUsed }, { status });
}

function parseBody(body: unknown): ChatRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { messages, sessionId } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) return null;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const parsed: ChatMessage[] = [];
  for (const m of messages) {
    if (
      typeof m !== "object" ||
      m === null ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      m.content.trim() === "" ||
      m.content.length > MAX_MESSAGE_CHARS
    ) {
      return null;
    }
    parsed.push({ role: m.role, content: m.content });
  }

  const recent = parsed.slice(-MAX_HISTORY);
  // The conversation must start with a user turn and end with one.
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();
  if (recent.length === 0 || recent[recent.length - 1].role !== "user") {
    return null;
  }
  return { sessionId, messages: recent };
}

/** Runs every tool_use block in parallel and returns one tool_result per block. */
async function runToolCalls(
  blocks: Anthropic.Beta.BetaToolUseBlock[],
  sessionId: string,
): Promise<Anthropic.Beta.BetaToolResultBlockParam[]> {
  return Promise.all(
    blocks.map(async (block) => {
      console.log(`[tool] ${block.name}`, JSON.stringify(block.input));
      try {
        // sessionId comes from the request body, never from the model.
        const output = await runTool(block.name, block.input, { sessionId });
        console.log(`[tool] ${block.name} result`, JSON.stringify(output));
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(output),
        };
      } catch (err) {
        console.error(`[tool] ${block.name} failed:`, err);
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: err instanceof Error ? err.message : "The tool failed.",
          is_error: true,
        };
      }
    }),
  );
}

export async function POST(request: Request) {
  let parsed: ChatRequest | null;
  try {
    parsed = parseBody(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return reply(BAD_REQUEST_REPLY, [], 400);
  const { sessionId } = parsed;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[chat] ANTHROPIC_API_KEY is not set");
    return reply(ERROR_REPLY, [], 500);
  }

  const toolsUsed: string[] = [];
  try {
    const client = new Anthropic({ apiKey });
    const messages: Anthropic.Beta.BetaMessageParam[] = [...parsed.messages];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.beta.messages.create({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
        // Chat replies don't need deep reasoning; low effort also keeps
        // thinking from eating into the 2000-token budget.
        output_config: { effort: "low" },
        // If a safety classifier declines, retry server-side on Anthropic's
        // recommended fallback model instead of returning the refusal.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        console.error("[chat] refusal", response.stop_details);
        return reply(REFUSAL_REPLY, toolsUsed);
      }

      if (response.stop_reason === "tool_use") {
        const toolCalls = response.content.filter(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
        );
        for (const call of toolCalls) {
          if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);
        }
        // Append the assistant turn unchanged, then all results in ONE user turn.
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: await runToolCalls(toolCalls, sessionId),
        });
        continue;
      }

      let text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n\n")
        .trim();

      if (!text) {
        console.error("[chat] empty reply, stop_reason:", response.stop_reason);
        return reply(ERROR_REPLY, toolsUsed, 500);
      }
      if (response.stop_reason === "max_tokens") text += CUT_OFF_NOTE;

      return reply(text, toolsUsed);
    }

    console.error(`[chat] stopped after ${MAX_ITERATIONS} iterations`);
    return reply(LOOP_LIMIT_REPLY, toolsUsed);
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(
        `[chat] Anthropic API error ${error.status}:`,
        error.message,
        "request_id:",
        error.requestID,
      );
    } else {
      console.error("[chat] unexpected error:", error);
    }
    return reply(ERROR_REPLY, toolsUsed, 500);
  }
}
