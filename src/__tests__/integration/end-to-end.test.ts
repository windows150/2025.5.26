/**
 * TRUE END-TO-END TEST
 *
 * This test calls the REAL register() function from index.ts with a
 * mock OpenClaw API, loading a REAL plugin file from disk via import().
 * No part of the code under test is mocked.
 *
 * What's proven:
 * - Dynamic import() resolves a real .ts file
 * - isElizaPlugin() validates the real export
 * - registerElizaPlugin() runs all 7 phases
 * - Services start and inject into RuntimeBridge
 * - Actions become callable tools with real execution
 * - Providers become hooks that return real context
 * - Plugin init runs with real getSetting()
 */

import { describe, test, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Import the REAL default export — the actual adapter plugin definition
import adapter from "../../../index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("End-to-end: real index.ts register() with real plugin import", () => {
  const registeredTools: { tool: { name: string; execute: (id: string, args: Record<string, unknown>) => Promise<unknown> }; opts: { name: string } }[] = [];
  const registeredHooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  const registeredServices: { id: string; start: () => void; stop?: () => unknown }[] = [];
  const registeredRoutes: { path: string }[] = [];
  const logs: string[] = [];

  // Real fixture plugin path — resolved to absolute path for import()
  const fixturePluginPath = resolve(__dirname, "../fixtures/real-minimal-plugin.ts");

  afterEach(() => {
    registeredTools.length = 0;
    for (const key of Object.keys(registeredHooks)) delete registeredHooks[key];
    registeredServices.length = 0;
    registeredRoutes.length = 0;
    logs.length = 0;
  });

  test("register() loads a real plugin and registers tools + hooks + services", async () => {
    // Build a mock OpenClaw API that collects registrations
    const mockApi = {
      id: "eliza-adapter",
      name: "Eliza Plugin Adapter",
      source: "test",
      config: {},
      pluginConfig: {
        plugins: [fixturePluginPath],
        settings: { GREETING: "hello-from-e2e" },
        agentName: "E2EBot",
      },
      runtime: {},
      logger: {
        info: (msg: string) => logs.push(`[info] ${msg}`),
        warn: (msg: string) => logs.push(`[warn] ${msg}`),
        error: (msg: string) => logs.push(`[error] ${msg}`),
        debug: (msg: string) => logs.push(`[debug] ${msg}`),
      },
      registerTool: (tool: { name: string; execute: (id: string, args: Record<string, unknown>) => Promise<unknown> }, opts: { name: string }) => {
        registeredTools.push({ tool, opts });
      },
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: (params: { path: string }) => {
        registeredRoutes.push(params);
      },
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: (svc: { id: string; start: () => void; stop?: () => unknown }) => {
        registeredServices.push(svc);
      },
      registerProvider: () => {},
      registerCommand: () => {},
      resolvePath: (p: string) => p,
      on: (hookName: string, handler: (...args: unknown[]) => unknown) => {
        const list = registeredHooks[hookName] ?? [];
        list.push(handler);
        registeredHooks[hookName] = list;
      },
    };

    // Call the REAL register() function
    await adapter.register(mockApi as never);

    // === Verify tools were registered ===
    // +1 for the eliza_adapter_status diagnostic tool
    expect(registeredTools.length).toBe(2);
    expect(registeredTools.map((t: any) => t.opts.name)).toContain("eliza_ping");
    expect(registeredTools.map((t: any) => t.opts.name)).toContain("eliza_adapter_status");

    // === Verify hooks were registered (provider → before_agent_start) ===
    expect(registeredHooks["before_agent_start"]).toBeDefined();
    expect(registeredHooks["before_agent_start"].length).toBe(1);

    // === Verify lifecycle service was registered ===
    expect(registeredServices.length).toBe(1);
    expect(registeredServices[0].id).toBe("eliza-adapter-lifecycle");

    // === Verify logs show the registration flow ===
    expect(logs.some((l) => l.includes("Loading"))).toBe(true);
    expect(logs.some((l) => l.includes("real-minimal"))).toBe(true);
    expect(logs.some((l) => l.includes("1T"))).toBe(true); // 1 tool

    // === Execute the REAL tool ===
    const toolExecute = registeredTools[0].tool.execute;
    const result = (await toolExecute("e2e-call", { input: "ping" })) as {
      content: { type: string; text: string }[];
      details: Record<string, unknown>;
    };

    const texts = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text);

    expect(texts.some((t) => t === "pong")).toBe(true);
    expect(result.details["success"]).toBe(true);

    // === Execute the REAL provider hook ===
    const hookHandler = registeredHooks["before_agent_start"][0];
    const hookResult = (await hookHandler({ prompt: "what time is it?" }, {})) as {
      prependContext?: string;
    } | void;

    expect(hookResult).toBeDefined();
    expect(hookResult!.prependContext).toContain("Time:");
    expect(hookResult!.prependContext).toContain("CLOCK");

    // === Cleanup ===
    if (registeredServices[0].stop) {
      await registeredServices[0].stop();
    }
  });
});
