/**
 * Tests for the main index.ts entry point.
 *
 * Verifies the plugin definition shape, the loadElizaPlugin logic,
 * and the registerElizaPlugin orchestration using the mock API pattern
 * from OpenClaw's own extension tests.
 */

import { describe, test, expect } from "vitest";

// Import the plugin definition — this is the default export
import elizaAdapterPlugin from "../../index.js";

describe("eliza-adapter plugin definition", () => {
  test("has correct id", () => {
    expect(elizaAdapterPlugin.id).toBe("eliza-adapter");
  });

  test("has correct name", () => {
    expect(elizaAdapterPlugin.name).toBe("Eliza Plugin Adapter");
  });

  test("has description", () => {
    expect(elizaAdapterPlugin.description).toBeDefined();
    expect(elizaAdapterPlugin.description.length).toBeGreaterThan(0);
  });

  test("has register function", () => {
    expect(typeof elizaAdapterPlugin.register).toBe("function");
  });
});

describe("register with mock OpenClaw API", () => {
  test("register throws on missing config", async () => {
    const mockApi = {
      id: "eliza-adapter",
      name: "Eliza Plugin Adapter",
      source: "test",
      config: {},
      pluginConfig: undefined, // No config provided
      runtime: {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: () => {},
      resolvePath: (p: string) => p,
      on: () => {},
    };

    await expect(
      elizaAdapterPlugin.register(mockApi as never),
    ).rejects.toThrow("missing config");
  });

  test("register throws on empty plugins array", async () => {
    const mockApi = {
      id: "eliza-adapter",
      name: "Eliza Plugin Adapter",
      source: "test",
      config: {},
      pluginConfig: { plugins: [] },
      runtime: {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: () => {},
      resolvePath: (p: string) => p,
      on: () => {},
    };

    await expect(
      elizaAdapterPlugin.register(mockApi as never),
    ).rejects.toThrow("non-empty array");
  });

  test("register handles missing plugin gracefully without throwing", async () => {
    const errorMessages: string[] = [];
    const registeredTools: { name: string }[] = [];

    const mockApi = {
      id: "eliza-adapter",
      name: "Eliza Plugin Adapter",
      source: "test",
      config: {},
      pluginConfig: {
        plugins: ["@nonexistent/plugin-that-does-not-exist"],
        settings: {},
      },
      runtime: {},
      logger: {
        info: () => {},
        warn: () => {},
        error: (msg: string) => errorMessages.push(msg),
        debug: () => {},
      },
      registerTool: (tool: { name: string }) => registeredTools.push(tool),
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: () => {},
      resolvePath: (p: string) => p,
      on: () => {},
    };

    // Should NOT throw — graceful degradation logs the error instead
    await elizaAdapterPlugin.register(mockApi as never);

    // Error should be logged
    expect(errorMessages.some((m) => m.includes("Failed to load"))).toBe(true);

    // Status tool should still be registered for diagnostics
    expect(registeredTools.some((t) => t.name === "eliza_adapter_status")).toBe(true);
  });
});
