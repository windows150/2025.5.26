import { describe, it, expect } from "vitest";
import { createStatusTool } from "../status-tool.js";
import type { AdapterStatus } from "../types.js";

function makeStatus(overrides?: Partial<AdapterStatus>): AdapterStatus {
  return {
    plugins: [],
    errors: [],
    totals: { tools: 0, hooks: 0, services: 0, routes: 0 },
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("createStatusTool", () => {
  it("returns a tool with expected shape", () => {
    const tool = createStatusTool(makeStatus());
    expect(tool.name).toBe("eliza_adapter_status");
    expect(tool.label).toBe("Eliza Adapter Status");
    expect(typeof tool.description).toBe("string");
    expect(typeof tool.execute).toBe("function");
    expect(tool.parameters).toBeDefined();
  });

  it("reports healthy status with no plugins", async () => {
    const tool = createStatusTool(makeStatus());
    const result = await tool.execute("call-1", {});

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Totals: 0 tools, 0 hooks, 0 services, 0 routes");
    expect(result.content[0].text).toContain("No plugins loaded successfully.");
    expect(result.details?.healthy).toBe(true);
    expect(result.details?.errors).toEqual([]);
  });

  it("reports loaded plugins with counts", async () => {
    const status = makeStatus({
      plugins: [
        { pluginName: "test-plugin", toolCount: 3, hookCount: 2, serviceCount: 1, routeCount: 0 },
        { pluginName: "other-plugin", toolCount: 1, hookCount: 0, serviceCount: 0, routeCount: 1 },
      ],
      totals: { tools: 4, hooks: 2, services: 1, routes: 1 },
    });
    const tool = createStatusTool(status);
    const result = await tool.execute("call-2", {});

    expect(result.content[0].text).toContain("Loaded plugins (2):");
    expect(result.content[0].text).toContain("✓ test-plugin: 3T 2H 1S 0R");
    expect(result.content[0].text).toContain("✓ other-plugin: 1T 0H 0S 1R");
    expect(result.content[0].text).toContain("Totals: 4 tools, 2 hooks, 1 services, 1 routes");
    expect(result.details?.healthy).toBe(true);
  });

  it("reports errors for failed plugins", async () => {
    const status = makeStatus({
      plugins: [{ pluginName: "good-plugin", toolCount: 1, hookCount: 0, serviceCount: 0, routeCount: 0 }],
      errors: [{ specifier: "bad-plugin", error: "Module not found", timestamp: Date.now() - 5000 }],
      totals: { tools: 1, hooks: 0, services: 0, routes: 0 },
    });
    const tool = createStatusTool(status);
    const result = await tool.execute("call-3", {});

    expect(result.content[0].text).toContain("Loaded plugins (1):");
    expect(result.content[0].text).toContain("Failed plugins (1):");
    expect(result.content[0].text).toContain("✗ bad-plugin: Module not found");
    expect(result.details?.healthy).toBe(false);
    expect(result.details?.errors).toHaveLength(1);
  });

  it("includes uptime in output", async () => {
    const status = makeStatus({ startedAt: Date.now() - 60000 });
    const tool = createStatusTool(status);
    const result = await tool.execute("call-4", {});

    expect(result.content[0].text).toMatch(/uptime: \d+s/);
    const uptime = result.details?.uptimeSeconds as number;
    expect(uptime).toBeGreaterThanOrEqual(59);
    expect(uptime).toBeLessThanOrEqual(62);
  });

  it("details include structured plugin and error data", async () => {
    const plugins = [{ pluginName: "p1", toolCount: 2, hookCount: 1, serviceCount: 0, routeCount: 0 }];
    const errors = [{ specifier: "p2", error: "fail", timestamp: Date.now() }];
    const status = makeStatus({ plugins, errors, totals: { tools: 2, hooks: 1, services: 0, routes: 0 } });
    const tool = createStatusTool(status);
    const result = await tool.execute("call-5", {});

    expect(result.details?.plugins).toEqual(plugins);
    expect(result.details?.errors).toEqual(errors);
    expect(result.details?.totals).toEqual({ tools: 2, hooks: 1, services: 0, routes: 0 });
  });
});
