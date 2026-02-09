/**
 * Integration test: verifies the full registration flow using a mock
 * OpenClaw API, matching the pattern from OpenClaw's own extension tests.
 */

import { describe, test, expect } from "vitest";
import type { Plugin as ElizaPlugin, Action, Provider, ProviderResult, Service } from "../eliza-types.js";

// We test the registration logic by importing the individual adapters
// and simulating what index.ts does, without needing the actual OpenClaw runtime.
import { RuntimeBridge } from "../runtime-bridge.js";
import { adaptActionToTool } from "../action-to-tool.js";
import { adaptProviderToHook } from "../provider-to-hook.js";
import { adaptService, type AdaptedService } from "../service-adapter.js";
import { adaptEvaluatorToHook } from "../evaluator-to-hook.js";

function createMockLogger() {
  const logs: string[] = [];
  return {
    logger: {
      info: (msg: string) => logs.push(`[info] ${msg}`),
      warn: (msg: string) => logs.push(`[warn] ${msg}`),
      error: (msg: string) => logs.push(`[error] ${msg}`),
      debug: (msg: string) => logs.push(`[debug] ${msg}`),
    },
    logs,
  };
}

describe("Full adapter registration flow", () => {
  test("registers a complete Eliza plugin with tools, hooks, and services", async () => {
    const { logger } = createMockLogger();

    // Create a mock Eliza plugin with all component types
    const mockPlugin: ElizaPlugin = {
      name: "test-plugin",
      description: "A test plugin with all component types",
      actions: [
        {
          name: "TEST_ACTION",
          description: "A test action",
          handler: async () => ({ success: true, text: "done" }),
          validate: async () => true,
          parameters: [
            { name: "input", description: "Input text", required: true, schema: { type: "string" } },
          ],
        } as Action,
      ],
      providers: [
        {
          name: "TEST_PROVIDER",
          get: async (): Promise<ProviderResult> => ({ text: "Provider context data" }),
        } as Provider,
      ],
      evaluators: [
        {
          name: "TEST_EVALUATOR",
          description: "Test evaluator",
          handler: async () => undefined,
          validate: async () => true,
          examples: [],
          phase: "post",
        },
      ],
      services: [
        {
          serviceType: "test_service",
          start: async (runtime) => ({
            stop: async () => {},
            capabilityDescription: "test",
            runtime,
          }) as unknown as Service,
          new: () => ({} as Service),
        } as unknown as import("../eliza-types.js").ServiceClass,
      ],
    };

    // Create bridge
    const bridge = new RuntimeBridge({
      config: { plugins: [], settings: { TEST_KEY: "val" }, agentName: "TestBot" },
      openclawLogger: logger,
    });

    // Simulate what index.ts does: adapt each component
    const registeredTools: { tool: ReturnType<typeof adaptActionToTool>; opts: { name: string } }[] = [];
    const registeredHooks: Record<string, unknown[]> = {};
    const registeredServices: AdaptedService[] = [];

    // -- Services first
    if (mockPlugin.services) {
      for (const serviceClass of mockPlugin.services) {
        const adapted = adaptService(serviceClass, bridge);
        registeredServices.push(adapted);
        // Start the service
        await adapted.start({} as never);
      }
    }

    // Verify service was injected into bridge
    expect(bridge.hasService("test_service")).toBe(true);

    // -- Init
    if (mockPlugin.init) {
      await mockPlugin.init({}, bridge);
    }

    // -- Actions → Tools
    if (mockPlugin.actions) {
      for (const action of mockPlugin.actions) {
        const tool = adaptActionToTool(action, bridge);
        registeredTools.push({ tool, opts: { name: tool.name } });
        bridge.registerAction(action);
      }
    }

    // -- Providers → Hooks
    if (mockPlugin.providers) {
      for (const provider of mockPlugin.providers) {
        const adapted = adaptProviderToHook(provider, bridge);
        const hookList = registeredHooks[adapted.hookName] ?? [];
        hookList.push(adapted.handler);
        registeredHooks[adapted.hookName] = hookList;
        bridge.registerProvider(provider);
      }
    }

    // -- Evaluators → Hooks
    if (mockPlugin.evaluators) {
      for (const evaluator of mockPlugin.evaluators) {
        const adapted = adaptEvaluatorToHook(evaluator, bridge);
        const hookList = registeredHooks[adapted.hookName] ?? [];
        hookList.push(adapted.handler);
        registeredHooks[adapted.hookName] = hookList;
      }
    }

    // --- Verify registrations ---
    expect(registeredTools.length).toBe(1);
    expect(registeredTools[0].opts.name).toBe("eliza_test_action");

    expect(registeredHooks["before_agent_start"]).toBeDefined();
    expect(registeredHooks["before_agent_start"]!.length).toBe(1);

    expect(registeredHooks["agent_end"]).toBeDefined();
    expect(registeredHooks["agent_end"]!.length).toBe(1);

    expect(registeredServices.length).toBe(1);
    expect(registeredServices[0].id).toBe("eliza:test_service");

    // --- Verify tool execution works ---
    const toolResult = await registeredTools[0].tool.execute("call-1", { input: "hello" });
    expect(toolResult.content.length).toBeGreaterThan(0);
    expect(
      toolResult.content.some(
        (c) => c.type === "text" && (c as { text: string }).text.includes("done"),
      ),
    ).toBe(true);

    // --- Verify provider hook works ---
    const providerHook = registeredHooks["before_agent_start"]![0] as (
      event: { prompt: string },
      ctx: Record<string, unknown>,
    ) => Promise<{ prependContext?: string } | void>;
    const hookResult = await providerHook({ prompt: "test query" }, {});
    expect(hookResult).toBeDefined();
    expect((hookResult as { prependContext: string }).prependContext).toContain("Provider context data");
    expect((hookResult as { prependContext: string }).prependContext).toContain('eliza-provider name="TEST_PROVIDER"');

    // --- Verify composeState includes registered providers ---
    const state = await bridge.composeState({ content: { text: "test" }, entityId: "e1", roomId: "r1" } as never);
    expect(state.text).toContain("Provider context data");
    expect(state.values["agentName"]).toBe("TestBot");

    // --- Cleanup ---
    for (const service of registeredServices) {
      if (service.stop) await service.stop({} as never);
    }
    await bridge.stop();
  });

  test("handles plugin with no optional components", async () => {
    const { logger } = createMockLogger();

    const minimalPlugin: ElizaPlugin = {
      name: "minimal",
      description: "Just a name and description",
    };

    const bridge = new RuntimeBridge({
      config: { plugins: [], settings: {}, agentName: "Min" },
      openclawLogger: logger,
    });

    // No services to register
    expect(minimalPlugin.services ?? []).toHaveLength(0);
    // No actions
    expect(minimalPlugin.actions ?? []).toHaveLength(0);
    // No providers
    expect(minimalPlugin.providers ?? []).toHaveLength(0);

    // Bridge should still be functional
    expect(bridge.character.name).toBe("Min");
    await bridge.stop();
  });

  test("multiple plugins register without collision", async () => {
    const { logger } = createMockLogger();

    const plugin1: ElizaPlugin = {
      name: "plugin-1",
      description: "First plugin",
      actions: [
        { name: "ACTION_A", description: "A", handler: async () => ({ success: true }), validate: async () => true } as Action,
      ],
    };

    const plugin2: ElizaPlugin = {
      name: "plugin-2",
      description: "Second plugin",
      actions: [
        { name: "ACTION_B", description: "B", handler: async () => ({ success: true }), validate: async () => true } as Action,
      ],
    };

    const bridge = new RuntimeBridge({
      config: { plugins: [], settings: {}, agentName: "Multi" },
      openclawLogger: logger,
    });

    const tools: string[] = [];

    for (const plugin of [plugin1, plugin2]) {
      for (const action of plugin.actions ?? []) {
        const tool = adaptActionToTool(action, bridge);
        tools.push(tool.name);
        bridge.registerAction(action);
      }
    }

    expect(tools).toEqual(["eliza_action_a", "eliza_action_b"]);
    expect(bridge.getAllActions().length).toBe(2);

    await bridge.stop();
  });
});

describe("Phase 7 event registration", () => {
  test("plugin events are mapped and registered as OpenClaw hooks", async () => {
    const { logger } = createMockLogger();

    let eventHandlerCalled = false;
    const pluginWithEvents: ElizaPlugin = {
      name: "event-plugin",
      description: "Has events",
      events: {
        MESSAGE_RECEIVED: [
          async () => { eventHandlerCalled = true; },
        ],
        NONEXISTENT_EVENT: [
          async () => { /* should be silently skipped */ },
        ],
      },
    };

    const bridge = new RuntimeBridge({
      config: { plugins: [], settings: {}, agentName: "Test" },
      openclawLogger: logger,
    });

    // Simulate the registration flow
    const registeredHooks: { hookName: string; handler: (...args: unknown[]) => unknown }[] = [];
    const mockApi = {
      pluginConfig: {},
      logger,
      registerTool: () => {},
      registerService: () => {},
      registerHttpRoute: () => {},
      on: (hookName: string, handler: (...args: unknown[]) => unknown) => {
        registeredHooks.push({ hookName, handler });
      },
    };

    // Manually replicate Phase 7 from index.ts
    const { mapElizaEventToOpenClawHook } = await import("../../src/event-mapper.js");

    for (const [eventName, handlers] of Object.entries(pluginWithEvents.events ?? {})) {
      if (!handlers) continue;
      const hookName = mapElizaEventToOpenClawHook(eventName);
      if (!hookName) continue;
      for (const handler of handlers) {
        mockApi.on(hookName, async () => { await handler({} as never); });
      }
    }

    // MESSAGE_RECEIVED should map to message_received
    expect(registeredHooks.length).toBe(1);
    expect(registeredHooks[0].hookName).toBe("message_received");

    // Call the registered handler and verify it invokes the original
    await registeredHooks[0].handler();
    expect(eventHandlerCalled).toBe(true);

    await bridge.stop();
  });
});

describe("Service timing — services available during init and action validation", () => {
  test("service is available in bridge when plugin.init runs", async () => {
    const { logger } = createMockLogger();

    let serviceFoundDuringInit = false;
    let serviceFoundDuringValidate = false;

    const plugin: ElizaPlugin = {
      name: "timing-test",
      description: "Tests service timing",
      services: [
        {
          serviceType: "timing_svc",
          start: async (runtime) => {
            return {
              stop: async () => {},
              capabilityDescription: "timing",
              getData: () => "from-service",
            } as unknown as Service;
          },
          new: () => ({} as Service),
        } as unknown as import("../eliza-types.js").ServiceClass,
      ],
      init: async (_config, runtime) => {
        const svc = runtime.getService("timing_svc");
        serviceFoundDuringInit = svc !== null;
      },
      actions: [
        {
          name: "TIMING_ACTION",
          description: "Tests timing",
          validate: async (runtime) => {
            const svc = runtime.getService("timing_svc");
            serviceFoundDuringValidate = svc !== null;
            return true;
          },
          handler: async () => ({ success: true }),
        } as Action,
      ],
    };

    const bridge = new RuntimeBridge({
      config: { plugins: [], settings: {}, agentName: "Test" },
      openclawLogger: logger,
    });

    // Replicate the real registration flow from index.ts
    const { adaptService } = await import("../service-adapter.js");
    const { adaptActionToTool } = await import("../action-to-tool.js");

    // Phase 1: Start services immediately (the fix)
    for (const serviceClass of plugin.services ?? []) {
      const adapted = adaptService(serviceClass, bridge);
      await adapted.start({} as never);
    }

    // Phase 2: Init — service should be available now
    if (plugin.init) {
      await plugin.init({}, bridge);
    }
    expect(serviceFoundDuringInit).toBe(true);

    // Phase 3: Actions — validate should find the service
    for (const action of plugin.actions ?? []) {
      const tool = adaptActionToTool(action, bridge);
      bridge.registerAction(action);
      // Execute to trigger validate
      await tool.execute("test", { input: "go" });
    }
    expect(serviceFoundDuringValidate).toBe(true);

    await bridge.stop();
  });
});
