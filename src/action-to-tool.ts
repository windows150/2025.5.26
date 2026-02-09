import type { Action, ActionParameters, Content, HandlerCallback, Memory, State, UUID } from "./eliza-types.js";
import type { RuntimeBridge } from "./runtime-bridge.js";
import { buildMemoryFromToolParams } from "./memory-builder.js";
import { convertActionParameters, fallbackActionSchema, KNOWN_ACTION_SCHEMAS } from "./schema-converter.js";
import type { TSchema } from "@sinclair/typebox";

type ToolResultContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type ToolResult = { content: ToolResultContent[]; details?: Record<string, unknown> };

export type AdaptedTool = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute: (toolCallId: string, args: Record<string, unknown>) => Promise<ToolResult>;
};

export function adaptActionToTool(action: Action, bridge: RuntimeBridge): AdaptedTool {
  let schema: TSchema;
  if (action.parameters && action.parameters.length > 0) {
    schema = convertActionParameters(action.parameters);
  } else if (action.name in KNOWN_ACTION_SCHEMAS) {
    schema = KNOWN_ACTION_SCHEMAS[action.name];
  } else {
    schema = fallbackActionSchema(action.description);
  }

  const toolName = `eliza_${action.name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;

  return {
    name: toolName,
    label: action.name.replace(/_/g, " "),
    description: action.description,
    parameters: schema,

    async execute(_toolCallId: string, args: Record<string, unknown>): Promise<ToolResult> {
      const message = buildMemoryFromToolParams(args, action.name, bridge.agentId);

      if (!(await action.validate(bridge, message, undefined))) {
        return {
          content: [{ type: "text", text: `Action "${action.name}" validation failed. Check required settings.` }],
          details: { error: "validation_failed", action: action.name },
        };
      }

      const state: State = await bridge.composeState(message);
      const responses: Memory[] = [];
      const callback: HandlerCallback = async (response: Content): Promise<Memory[]> => {
        const mem: Memory = { content: response, entityId: bridge.agentId as UUID, roomId: message.roomId, createdAt: Date.now() };
        responses.push(mem);
        return [mem];
      };

      let result;
      try {
        result = await action.handler(bridge, message, state, { parameters: args as ActionParameters }, callback, responses);
      } catch (err) {
        bridge.logger.error(`[eliza-adapter] Action "${action.name}" threw: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
      return formatResult(action.name, result ?? undefined, responses);
    },
  };
}

function formatResult(
  actionName: string,
  result: { success: boolean; text?: string; data?: Record<string, unknown>; error?: string | Error } | undefined,
  responses: Memory[],
): ToolResult {
  const content: ToolResultContent[] = [];
  const details: Record<string, unknown> = { action: actionName };

  if (result?.text) content.push({ type: "text", text: result.text });
  for (const r of responses) {
    if (r.content.text) content.push({ type: "text", text: r.content.text });
  }

  if (content.length === 0) {
    const status = result?.success !== false ? "completed" : "failed";
    const err = result?.error instanceof Error ? result.error.message : result?.error;
    content.push({ type: "text", text: err ? `Action "${actionName}" ${status}: ${err}` : `Action "${actionName}" ${status}.` });
  }

  if (result?.data) details["data"] = result.data;
  details["success"] = result?.success !== false;
  return { content, details };
}
