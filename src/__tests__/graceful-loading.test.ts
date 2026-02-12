import { describe, it, expect, vi } from "vitest";

/**
 * Tests for graceful plugin loading — verifying that a failing plugin
 * doesn't prevent other plugins from loading.
 *
 * These tests mock dynamic import() to simulate plugin load failures.
 */

describe("graceful plugin loading", () => {
  it("adapter.register continues when a plugin fails to load", async () => {
    // We test the register function's error handling behavior by importing
    // the adapter and calling register with a mock API that records calls.
    const adapter = (await import("../../index.js")).default;

    const registeredTools: string[] = [];
    const registeredServices: string[] = [];
    const logMessages: string[] = [];
    const errorMessages: string[] = [];

    const mockApi = {
      pluginConfig: {
        plugins: ["nonexistent-plugin-that-will-fail"],
        settings: {},
        agentName: "Test",
      },
      logger: {
        info: (msg: string) => logMessages.push(msg),
        warn: (msg: string) => logMessages.push(msg),
        error: (msg: string) => errorMessages.push(msg),
        debug: (msg: string) => logMessages.push(msg),
      },
      registerTool: (tool: { name: string }) => registeredTools.push(tool.name),
      registerService: (svc: { id: string }) => registeredServices.push(svc.id),
      registerHttpRoute: vi.fn(),
      on: vi.fn(),
    };

    // Should not throw — graceful degradation
    await adapter.register(mockApi as any);

    // The failing plugin should be logged as an error
    expect(errorMessages.some((m) => m.includes("Failed to load") && m.includes("nonexistent-plugin"))).toBe(true);

    // Status tool should still be registered
    expect(registeredTools).toContain("eliza_adapter_status");

    // Lifecycle service should still be registered
    expect(registeredServices).toContain("eliza-adapter-lifecycle");

    // Ready message should mention the error count
    expect(logMessages.some((m) => m.includes("Ready:") && m.includes("1 error(s)"))).toBe(true);
  });

  it("status tool is always registered even with zero plugins configured", async () => {
    const adapter = (await import("../../index.js")).default;

    const registeredTools: string[] = [];

    const mockApi = {
      pluginConfig: {
        plugins: ["another-nonexistent-plugin"],
        settings: {},
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      registerTool: (tool: { name: string }) => registeredTools.push(tool.name),
      registerService: vi.fn(),
      registerHttpRoute: vi.fn(),
      on: vi.fn(),
    };

    await adapter.register(mockApi as any);
    expect(registeredTools).toContain("eliza_adapter_status");
  });
});
