import type { PluginHookName } from "./eliza-types.js";

const ELIZA_TO_OPENCLAW: Record<string, PluginHookName> = {
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_SENT: "message_sent",
  VOICE_MESSAGE_RECEIVED: "message_received",
  VOICE_MESSAGE_SENT: "message_sent",
  INTERACTION_RECEIVED: "message_received",
  RUN_STARTED: "before_agent_start",
  RUN_ENDED: "agent_end",
};

export function mapElizaEventToOpenClawHook(name: string): PluginHookName | undefined {
  return ELIZA_TO_OPENCLAW[name];
}

export function getSupportedElizaEvents(): string[] {
  return Object.keys(ELIZA_TO_OPENCLAW);
}
