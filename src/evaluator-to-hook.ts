import type {
  Evaluator, State, PluginHookMessageReceivedEvent, PluginHookMessageContext,
  PluginHookAgentEndEvent, PluginHookAgentContext,
} from "./eliza-types.js";
import type { RuntimeBridge } from "./runtime-bridge.js";
import { buildMemory } from "./memory-builder.js";

export type AdaptedEvaluatorHook =
  | { hookName: "message_received"; evaluatorName: string; handler: (event: PluginHookMessageReceivedEvent, ctx: PluginHookMessageContext) => Promise<void> }
  | { hookName: "agent_end"; evaluatorName: string; handler: (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => Promise<void> };

function minState(bridge: RuntimeBridge, text: string): State {
  return { values: { agentName: bridge.character.name ?? "Eliza" }, data: {}, text } as State;
}

export function adaptEvaluatorToHook(evaluator: Evaluator, bridge: RuntimeBridge): AdaptedEvaluatorHook {
  if ((evaluator.phase ?? "post") === "pre") {
    return {
      hookName: "message_received",
      evaluatorName: evaluator.name,
      async handler(event: PluginHookMessageReceivedEvent): Promise<void> {
        const message = buildMemory({ text: event.content, agentId: bridge.agentId, source: event.from });
        const state = minState(bridge, event.content);
        if (!evaluator.alwaysRun && !(await evaluator.validate(bridge, message, state))) return;
        const result = await evaluator.handler(bridge, message, state, {}, undefined, undefined);
        if (result && typeof result === "object" && "blocked" in result && (result as { blocked: boolean }).blocked) {
          bridge.logger.warn(`[eliza-adapter] Pre-evaluator "${evaluator.name}" blocked message: ${(result as { reason?: string }).reason ?? "no reason"}`);
        }
      },
    };
  }

  return {
    hookName: "agent_end",
    evaluatorName: evaluator.name,
    async handler(event: PluginHookAgentEndEvent): Promise<void> {
      if (!event.success) return;
      const message = buildMemory({ text: "Agent conversation ended", agentId: bridge.agentId });
      const state = minState(bridge, "");
      if (!evaluator.alwaysRun && !(await evaluator.validate(bridge, message, state))) return;
      await evaluator.handler(bridge, message, state, {}, undefined, undefined);
    },
  };
}
