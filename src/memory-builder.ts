import { randomUUID } from "node:crypto";
import type { Content, Memory, UUID } from "./eliza-types.js";

export function buildMemory(params: {
  text: string;
  entityId?: UUID;
  agentId?: UUID;
  roomId?: UUID;
  worldId?: UUID;
  source?: string;
  action?: string;
}): Memory {
  const content: Content = { text: params.text, source: params.source ?? "openclaw-adapter" };
  if (params.action) content.actions = [params.action];

  return {
    id: randomUUID() as UUID,
    content,
    entityId: params.entityId ?? (randomUUID() as UUID),
    agentId: params.agentId,
    roomId: params.roomId ?? (randomUUID() as UUID),
    worldId: params.worldId,
    createdAt: Date.now(),
    metadata: { type: "message", source: "openclaw-adapter" },
  };
}

export function buildMemoryFromToolParams(
  params: Record<string, unknown>,
  actionName: string,
  agentId?: UUID,
): Memory {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return buildMemory({
    text: parts.length > 0 ? parts.join(", ") : actionName,
    agentId,
    action: actionName,
    source: "openclaw-adapter",
  });
}
