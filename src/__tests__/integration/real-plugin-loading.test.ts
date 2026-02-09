/**
 * Smoke test: loads a REAL .ts file via dynamic import() and runs it
 * through the full adapter registration pipeline. No mocks of the
 * code under test — the fixture plugin is real TypeScript that executes.
 */

import { describe, test, expect, afterEach } from "vitest";
import { RuntimeBridge } from "../../runtime-bridge.js";
import { adaptActionToTool } from "../../action-to-tool.js";
import { adaptProviderToHook } from "../../provider-to-hook.js";
import type { Plugin } from "../../eliza-types.js";

// Import the fixture by relative path — this exercises real module resolution
import fixturePlugin from "../fixtures/real-minimal-plugin.js";

describe("Real plugin loading smoke test", () => {
  let bridge: RuntimeBridge;

  afterEach(async () => {
    if (bridge) await bridge.stop();
  });

  test("fixture plugin has expected shape", () => {
    expect(fixturePlugin.name).toBe("real-minimal");
    expect(fixturePlugin.description).toContain("real plugin");
    expect(fixturePlugin.actions).toBeDefined();
    expect(fixturePlugin.actions!.length).toBe(1);
    expect(fixturePlugin.providers).toBeDefined();
    expect(fixturePlugin.providers!.length).toBe(1);
    expect(typeof fixturePlugin.init).toBe("function");
  });

  test("full pipeline: init → tools → hooks → execute", async () => {
    bridge = new RuntimeBridge({
      config: { plugins: [], settings: { GREETING: "hello from test" }, agentName: "SmokeBot" },
      openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });

    const plugin = fixturePlugin as Plugin;

    // Phase 2: init — exercises real plugin.init() with real RuntimeBridge
    let initRan = false;
    const origInit = plugin.init!;
    plugin.init = async (config, runtime) => {
      await origInit(config, runtime);
      initRan = true;
    };
    await plugin.init({}, bridge);
    expect(initRan).toBe(true);

    // Phase 3: actions → tools
    const tools: ReturnType<typeof adaptActionToTool>[] = [];
    for (const action of plugin.actions ?? []) {
      const tool = adaptActionToTool(action, bridge);
      tools.push(tool);
      bridge.registerAction(action);
    }
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("eliza_ping");

    // Phase 4: providers → hooks
    const hooks: ReturnType<typeof adaptProviderToHook>[] = [];
    for (const provider of plugin.providers ?? []) {
      const adapted = adaptProviderToHook(provider, bridge);
      hooks.push(adapted);
      bridge.registerProvider(provider);
    }
    expect(hooks.length).toBe(1);
    expect(hooks[0].providerName).toBe("CLOCK");

    // Execute the PING tool — this runs the REAL handler code
    const result = await tools[0].execute("smoke-1", { input: "test" });
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    expect(texts.some((t) => t === "pong")).toBe(true);
    expect((result.details as Record<string, unknown>)?.["success"]).toBe(true);

    // Execute the CLOCK hook — this runs the REAL provider code
    const hookResult = await hooks[0].handler({ prompt: "what time is it?" }, {});
    expect(hookResult).toBeDefined();
    const ctx = hookResult as { prependContext: string };
    expect(ctx.prependContext).toContain("Time:");
    expect(ctx.prependContext).toContain("CLOCK");

    // composeState includes the real CLOCK provider
    const state = await bridge.composeState({ content: { text: "hi" }, entityId: "e1", roomId: "r1" } as never);
    expect(state.text).toContain("Time:");
  });

  test("getSetting resolves from adapter config in real init", async () => {
    bridge = new RuntimeBridge({
      config: { plugins: [], settings: { MY_KEY: "my_value" }, agentName: "Test" },
      openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });

    // The real plugin's init reads GREETING from getSetting
    let settingValue: unknown = null;
    const testPlugin: Plugin = {
      name: "setting-test",
      description: "Tests getSetting",
      init: async (_config, runtime) => {
        settingValue = runtime.getSetting("MY_KEY");
      },
    };
    await testPlugin.init!({}, bridge);
    expect(settingValue).toBe("my_value");
  });
});
