import type {
  Provider, State, PluginHookBeforeAgentStartEvent,
  PluginHookBeforeAgentStartResult, PluginHookAgentContext,
} from "./eliza-types.js";
import type { RuntimeBridge } from "./runtime-bridge.js";
import { buildMemory } from "./memory-builder.js";

export type AdaptedProviderHook = {
  hookName: "before_agent_start";
  providerName: string;
  handler: (
    event: PluginHookBeforeAgentStartEvent,
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookBeforeAgentStartResult | void>;
};

export function adaptProviderToHook(provider: Provider, bridge: RuntimeBridge): AdaptedProviderHook {
  return {
    hookName: "before_agent_start",
    providerName: provider.name,

    async handler(event: PluginHookBeforeAgentStartEvent): Promise<PluginHookBeforeAgentStartResult | void> {
      const promptText = typeof event.prompt === "string" ? event.prompt : "";
      const message = buildMemory({ text: promptText, agentId: bridge.agentId });
      const state: State = { values: { agentName: bridge.character.name ?? "Eliza" }, data: {}, text: promptText } as State;

      let result;
      try { result = await provider.get(bridge, message, state); }
      catch (err) {
        bridge.logger.warn(`[eliza-adapter] Provider "${provider.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      if (result?.text?.trim()) {
        return { prependContext: `<eliza-provider name="${provider.name}">\n${result.text}\n</eliza-provider>` };
      }
    },
  };
}
