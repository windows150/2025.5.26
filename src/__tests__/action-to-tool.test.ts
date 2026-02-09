import { describe, test, expect, beforeEach } from "vitest";
import type { Action, ActionResult, Memory, IAgentRuntime, ProviderResult } from "../eliza-types.js";
import { RuntimeBridge } from "../runtime-bridge.js";
import { adaptActionToTool } from "../action-to-tool.js";

function createBridge(): RuntimeBridge {
  return new RuntimeBridge({
    config: { plugins: [], settings: { EVM_PRIVATE_KEY: "0xtest" }, agentName: "Test" },
    openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
}

describe("adaptActionToTool", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("creates tool with correct name and description", () => {
    const action: Action = {
      name: "SEND_TOKENS",
      description: "Send tokens to an address",
      handler: async () => ({ success: true }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    expect(tool.name).toBe("eliza_send_tokens");
    expect(tool.description).toBe("Send tokens to an address");
    expect(tool.parameters).toBeDefined();
  });

  test("uses known schema for SEND_TOKENS", () => {
    const action: Action = {
      name: "SEND_TOKENS",
      description: "Send tokens",
      handler: async () => ({ success: true }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    // The schema should have toAddress and amount fields
    const schemaProps = (tool.parameters as Record<string, unknown>)["properties"] as Record<string, unknown>;
    expect(schemaProps).toBeDefined();
    expect(schemaProps["toAddress"]).toBeDefined();
    expect(schemaProps["amount"]).toBeDefined();
  });

  test("uses explicit parameters when defined", () => {
    const action: Action = {
      name: "CUSTOM_ACTION",
      description: "Custom",
      handler: async () => ({ success: true }),
      validate: async () => true,
      parameters: [
        { name: "target", description: "Target", required: true, schema: { type: "string" } },
        { name: "count", description: "Count", required: false, schema: { type: "number" } },
      ],
    };
    const tool = adaptActionToTool(action, bridge);
    const schemaProps = (tool.parameters as Record<string, unknown>)["properties"] as Record<string, unknown>;
    expect(schemaProps["target"]).toBeDefined();
    expect(schemaProps["count"]).toBeDefined();
  });

  test("uses fallback schema for unknown action without parameters", () => {
    const action: Action = {
      name: "UNKNOWN_ACTION",
      description: "Does something",
      handler: async () => ({ success: true }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const schemaProps = (tool.parameters as Record<string, unknown>)["properties"] as Record<string, unknown>;
    expect(schemaProps["input"]).toBeDefined();
  });

  test("execute returns error when validate fails", async () => {
    const action: Action = {
      name: "GUARDED_ACTION",
      description: "Requires validation",
      handler: async () => ({ success: true }),
      validate: async () => false,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("call-1", { input: "test" });
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("validation failed");
    expect((result.details as Record<string, unknown>)?.["error"]).toBe("validation_failed");
  });

  test("execute calls handler and returns result", async () => {
    const action: Action = {
      name: "GOOD_ACTION",
      description: "Works fine",
      handler: async (_runtime, _msg, _state, _opts, callback) => {
        if (callback) {
          await callback({ text: "Response from action" });
        }
        return { success: true, text: "Action completed successfully" } as ActionResult;
      },
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("call-1", { input: "do it" });
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    expect(texts.some((t) => t.includes("Action completed successfully"))).toBe(true);
    expect(texts.some((t) => t.includes("Response from action"))).toBe(true);
    expect((result.details as Record<string, unknown>)?.["success"]).toBe(true);
  });

  test("execute handles handler errors", async () => {
    const action: Action = {
      name: "BAD_ACTION",
      description: "Throws",
      handler: async () => {
        throw new Error("Handler exploded");
      },
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    await expect(tool.execute("call-1", { input: "boom" })).rejects.toThrow("Handler exploded");
  });

  test("tool name sanitizes special characters", () => {
    const action: Action = {
      name: "MY-SPECIAL.ACTION",
      description: "Special chars",
      handler: async () => ({ success: true }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    expect(tool.name).toBe("eliza_my_special_action");
  });
});

// ==========================================================================
// Deep coverage: formatResult edge cases, callback behavior, state flow
// ==========================================================================

describe("adaptActionToTool — formatResult edge paths", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("handler returning undefined produces 'completed' status text", async () => {
    const action: Action = {
      name: "VOID_ACTION",
      description: "Returns nothing",
      handler: async () => undefined,
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("c1", { input: "go" });
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    expect(texts[0]).toContain("VOID_ACTION");
    expect(texts[0]).toContain("completed");
    expect((result.details as Record<string, unknown>)?.["success"]).toBe(true);
  });

  test("handler returning { success: false, error: Error } formats Error.message", async () => {
    const action: Action = {
      name: "ERROR_OBJ_ACTION",
      description: "Returns error object",
      handler: async (): Promise<ActionResult> => ({
        success: false,
        error: new Error("RPC timeout"),
      }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("c1", { input: "go" });
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    expect(texts[0]).toContain("RPC timeout");
    expect(texts[0]).toContain("failed");
    expect((result.details as Record<string, unknown>)?.["success"]).toBe(false);
  });

  test("handler returning { success: false, error: 'string' } uses string", async () => {
    const action: Action = {
      name: "ERROR_STR_ACTION",
      description: "Returns error string",
      handler: async (): Promise<ActionResult> => ({
        success: false,
        error: "Insufficient funds",
      }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("c1", { input: "go" });
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    expect(texts[0]).toContain("Insufficient funds");
  });

  test("handler returning data but no text includes data in details", async () => {
    const action: Action = {
      name: "DATA_ONLY",
      description: "Returns only data",
      handler: async (): Promise<ActionResult> => ({
        success: true,
        data: { txHash: "0xabc", blockNumber: 12345 },
      }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("c1", { input: "go" });
    const details = result.details as Record<string, unknown>;
    const data = details["data"] as Record<string, unknown>;
    expect(data["txHash"]).toBe("0xabc");
    expect(data["blockNumber"]).toBe(12345);
    // Should have fallback text since no text was returned
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe("text");
  });

  test("callback response with no text field is skipped in content", async () => {
    const action: Action = {
      name: "NO_TEXT_CB",
      description: "Callback with no text",
      handler: async (_rt, _msg, _state, _opts, callback) => {
        if (callback) {
          await callback({ source: "test" }); // no text field
          await callback({ text: "real response" });
        }
        return { success: true } as ActionResult;
      },
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("c1", { input: "go" });
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    // Should only include the callback response that had text
    expect(texts).toContain("real response");
    expect(texts.length).toBe(1); // only "real response" — no fallback since content is non-empty
  });

  test("callback returns Memory array with correct shape", async () => {
    let callbackReturnedMems: Memory[] = [];
    const action: Action = {
      name: "CB_RETURN",
      description: "Tests callback return",
      handler: async (_rt, _msg, _state, _opts, callback) => {
        if (callback) {
          callbackReturnedMems = await callback({ text: "from callback" });
        }
        return { success: true } as ActionResult;
      },
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    await tool.execute("c1", { input: "go" });
    expect(callbackReturnedMems.length).toBe(1);
    expect(callbackReturnedMems[0].content.text).toBe("from callback");
    expect(callbackReturnedMems[0].entityId).toBe(bridge.agentId);
  });

  test("composeState is called with the fakeMessage and runs providers", async () => {
    let providerWasCalled = false;
    let providerReceivedRuntime: IAgentRuntime | undefined;
    bridge.registerProvider({
      name: "TRACKER",
      get: async (runtime): Promise<ProviderResult> => {
        providerWasCalled = true;
        providerReceivedRuntime = runtime;
        return { text: "tracked" };
      },
    });

    const action: Action = {
      name: "STATE_CHECK",
      description: "Checks state",
      handler: async (_rt, _msg, state): Promise<ActionResult> => ({
        success: true,
        text: `state text: ${state?.text ?? "none"}`,
      }),
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    const result = await tool.execute("c1", { input: "go" });
    expect(providerWasCalled).toBe(true);
    expect(providerReceivedRuntime).toBe(bridge);
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    expect(texts.some((t) => t.includes("tracked"))).toBe(true);
  });

  test("args are passed through to handler options.parameters", async () => {
    let receivedParams: Record<string, unknown> = {};
    const action: Action = {
      name: "PARAM_CHECK",
      description: "Checks params",
      handler: async (_rt, _msg, _state, opts): Promise<ActionResult> => {
        receivedParams = (opts?.["parameters"] ?? {}) as Record<string, unknown>;
        return { success: true };
      },
      validate: async () => true,
    };
    const tool = adaptActionToTool(action, bridge);
    await tool.execute("c1", { toAddress: "0xDEAD", amount: "3.14", chain: "base" });
    expect(receivedParams["toAddress"]).toBe("0xDEAD");
    expect(receivedParams["amount"]).toBe("3.14");
    expect(receivedParams["chain"]).toBe("base");
  });
});
