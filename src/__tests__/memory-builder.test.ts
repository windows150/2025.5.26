import { describe, test, expect } from "vitest";
import { buildMemory, buildMemoryFromToolParams } from "../memory-builder.js";

describe("buildMemory", () => {
  test("creates memory with required fields", () => {
    const mem = buildMemory({ text: "hello world" });
    expect(mem.id).toBeDefined();
    expect(mem.content.text).toBe("hello world");
    expect(mem.entityId).toBeDefined();
    expect(mem.roomId).toBeDefined();
    expect(mem.createdAt).toBeGreaterThan(0);
    expect(mem.content.source).toBe("openclaw-adapter");
  });

  test("uses provided entityId and roomId", () => {
    const mem = buildMemory({
      text: "test",
      entityId: "my-entity-id",
      roomId: "my-room-id",
    });
    expect(mem.entityId).toBe("my-entity-id");
    expect(mem.roomId).toBe("my-room-id");
  });

  test("sets action in content.actions", () => {
    const mem = buildMemory({ text: "test", action: "SEND_TOKENS" });
    expect(mem.content.actions).toEqual(["SEND_TOKENS"]);
  });

  test("sets metadata type to message", () => {
    const mem = buildMemory({ text: "test" });
    expect(mem.metadata?.type).toBe("message");
  });
});

describe("buildMemoryFromToolParams", () => {
  test("serializes params into text", () => {
    const mem = buildMemoryFromToolParams(
      { toAddress: "0x123", amount: "1.5" },
      "SEND_TOKENS",
    );
    expect(mem.content.text).toContain("toAddress: 0x123");
    expect(mem.content.text).toContain("amount: 1.5");
    expect(mem.content.actions).toEqual(["SEND_TOKENS"]);
  });

  test("skips undefined and null params", () => {
    const mem = buildMemoryFromToolParams(
      { key1: "val", key2: undefined, key3: null, key4: "" },
      "TEST",
    );
    expect(mem.content.text).toContain("key1: val");
    expect(mem.content.text).not.toContain("key2");
    expect(mem.content.text).not.toContain("key3");
    expect(mem.content.text).not.toContain("key4");
  });

  test("uses action name as text when no params", () => {
    const mem = buildMemoryFromToolParams({}, "EMPTY_ACTION");
    expect(mem.content.text).toBe("EMPTY_ACTION");
  });

  test("sets agentId when provided", () => {
    const mem = buildMemoryFromToolParams({ x: "1" }, "TEST", "agent-id-123");
    expect(mem.agentId).toBe("agent-id-123");
  });
});
