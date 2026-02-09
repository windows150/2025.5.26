import { describe, test, expect, beforeEach } from "vitest";
import type { Provider, ProviderResult } from "../eliza-types.js";
import { RuntimeBridge } from "../runtime-bridge.js";
import { adaptProviderToHook } from "../provider-to-hook.js";

function createBridge(): RuntimeBridge {
  return new RuntimeBridge({
    config: { plugins: [], settings: {}, agentName: "Test" },
    openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
}

describe("adaptProviderToHook", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("creates before_agent_start hook", () => {
    const provider: Provider = {
      name: "WALLET",
      get: async (): Promise<ProviderResult> => ({ text: "Balance: 100 ETH" }),
    };
    const adapted = adaptProviderToHook(provider, bridge);
    expect(adapted.hookName).toBe("before_agent_start");
    expect(adapted.providerName).toBe("WALLET");
  });

  test("hook returns prependContext with provider text", async () => {
    const provider: Provider = {
      name: "BALANCE",
      get: async (): Promise<ProviderResult> => ({ text: "Wallet balance: 42 ETH" }),
    };
    const adapted = adaptProviderToHook(provider, bridge);
    const result = await adapted.handler(
      { prompt: "What is my balance?" },
      {},
    );
    expect(result).toBeDefined();
    const ctx = result as { prependContext: string };
    expect(ctx.prependContext).toContain("Wallet balance: 42 ETH");
    expect(ctx.prependContext).toContain('eliza-provider name="BALANCE"');
  });

  test("hook returns void when provider returns empty text", async () => {
    const provider: Provider = {
      name: "EMPTY",
      get: async (): Promise<ProviderResult> => ({ text: "" }),
    };
    const adapted = adaptProviderToHook(provider, bridge);
    const result = await adapted.handler({ prompt: "test" }, {});
    expect(result).toBeUndefined();
  });

  test("hook returns void when provider returns no text", async () => {
    const provider: Provider = {
      name: "NO_TEXT",
      get: async (): Promise<ProviderResult> => ({ values: { key: "val" } }),
    };
    const adapted = adaptProviderToHook(provider, bridge);
    const result = await adapted.handler({ prompt: "test" }, {});
    expect(result).toBeUndefined();
  });

  test("hook handles provider error gracefully", async () => {
    const provider: Provider = {
      name: "BROKEN",
      get: async (): Promise<ProviderResult> => {
        throw new Error("Connection failed");
      },
    };
    const adapted = adaptProviderToHook(provider, bridge);
    // Should not throw
    const result = await adapted.handler({ prompt: "test" }, {});
    expect(result).toBeUndefined();
  });

  test("hook passes prompt text to provider via message", async () => {
    let receivedText = "";
    const provider: Provider = {
      name: "ECHO",
      get: async (_runtime, message): Promise<ProviderResult> => {
        receivedText = message.content.text ?? "";
        return { text: "echoed" };
      },
    };
    const adapted = adaptProviderToHook(provider, bridge);
    await adapted.handler({ prompt: "hello world" }, {});
    expect(receivedText).toBe("hello world");
  });
});
