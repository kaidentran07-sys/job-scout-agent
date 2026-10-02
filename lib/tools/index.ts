import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { updateEmployerList, updateEmployerListTool } from "@/lib/tools/updateEmployerList";

export const TOOLS: Anthropic.Beta.BetaToolUnion[] = [updateEmployerListTool];

/** Context supplied by the server, never by the model. */
export type ToolContext = { sessionId: string };

export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case "update_employer_list":
      return updateEmployerList(ctx.sessionId, input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
