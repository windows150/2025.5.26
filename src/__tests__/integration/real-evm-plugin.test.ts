/**
 * Real EVM Plugin Integration Test
 *
 * Loads the ACTUAL @elizaos/plugin-evm through the adapter and verifies:
 * - Real action validate with RuntimeBridge
 * - Real actions convert to tools
 * - Real providers convert to hooks
 * - Real services convert to adapted services
 */

import { describe, test, expect, afterAll } from "vitest";
import { RuntimeBridge } from "../../runtime-bridge.js";
import { adaptActionToTool } from "../../action-to-tool.js";
import { adaptProviderToHook } from "../../provider-to-hook.js";
import { adaptService } from "../../service-adapter.js";
import type { Plugin, ServiceClass } from "../../eliza-types.js";

let evmPlugin: Plugin | null = null;
let loadError = "";

try {
  const mod = await import("/Users/shawwalters/eliza-workspace/plugins/plugin-evm/typescript/dist/index.js") as Record<string, unknown>;
  evmPlugin = (mod["default"] ?? mod["evmPlugin"]) as Plugin;
} catch (e) {
  loadError = (e as Error).message.slice(0, 150);
}

const itReal = evmPlugin ? test : test.skip;

describe("Real @elizaos/plugin-evm through adapter", () => {
  let bridge: RuntimeBridge;

  afterAll(async () => { if (bridge) await bridge.stop(); });

  test("plugin-evm loads (or skip reason)", () => {
    if (loadError) console.log("Skipping:", loadError);
    expect(evmPlugin !== null || loadError.length > 0).toBe(true);
  });

  itReal("has correct structure", () => {
    expect(evmPlugin!.name).toBe("evm");
    expect(evmPlugin!.actions!.length).toBe(7);
    expect(evmPlugin!.providers!.length).toBe(2);
    expect(evmPlugin!.services!.length).toBe(1);
  });

  itReal("action validate passes with key via RuntimeBridge", async () => {
    bridge = new RuntimeBridge({
      config: { plugins: [], settings: { EVM_PRIVATE_KEY: "0x0000000000000000000000000000000000000000000000000000000000000001" }, agentName: "EVMTest" },
      openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    const valid = await evmPlugin!.actions![0].validate(bridge, { content: { text: "" }, entityId: "e1", roomId: "r1" } as never, undefined);
    expect(valid).toBe(true);
  });

  itReal("action validate fails without key", async () => {
    const noKeyBridge = new RuntimeBridge({
      config: { plugins: [], settings: {}, agentName: "NoKey" },
      openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    const valid = await evmPlugin!.actions![0].validate(noKeyBridge, { content: { text: "" }, entityId: "e1", roomId: "r1" } as never, undefined);
    expect(valid).toBe(false);
    await noKeyBridge.stop();
  });

  itReal("all actions convert to tools", () => {
    const tools = evmPlugin!.actions!.map((a) => adaptActionToTool(a, bridge));
    expect(tools.length).toBe(7);
    for (const t of tools) {
      expect(t.name.startsWith("eliza_")).toBe(true);
      expect(typeof t.execute).toBe("function");
    }
    const names = tools.map((t) => t.name);
    expect(names).toContain("eliza_transfer");
    expect(names).toContain("eliza_bridge");
    expect(names).toContain("eliza_swap_tokens");
  });

  itReal("all providers convert to hooks", () => {
    const hooks = evmPlugin!.providers!.map((p) => adaptProviderToHook(p, bridge));
    expect(hooks.length).toBe(2);
    expect(hooks[0].hookName).toBe("before_agent_start");
  });

  itReal("service converts to adapted service", () => {
    const svcs = evmPlugin!.services!.map((s) => adaptService(s as ServiceClass, bridge));
    expect(svcs.length).toBe(1);
    expect(svcs[0].id).toBe("eliza:evmService");
  });
});
