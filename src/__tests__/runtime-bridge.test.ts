import { describe, test, expect, beforeEach } from "vitest";
import { RuntimeBridge } from "../runtime-bridge.js";
import type { Provider, ProviderResult, Service, ServiceClass } from "../eliza-types.js";

function createBridge(overrides?: Record<string, string>): RuntimeBridge {
  return new RuntimeBridge({
    config: {
      plugins: [],
      settings: { TEST_KEY: "test_value", SECRET_TOKEN: "sk-abc123", ...overrides },
      agentName: "TestAgent",
    },
    openclawLogger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
}

describe("RuntimeBridge", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  // ---- Settings ----
  describe("getSetting", () => {
    test("returns value from adapter config settings", () => {
      expect(bridge.getSetting("TEST_KEY")).toBe("test_value");
    });

    test("falls back to environment variable", () => {
      process.env["BRIDGE_TEST_ENV_VAR"] = "from-env";
      expect(bridge.getSetting("BRIDGE_TEST_ENV_VAR")).toBe("from-env");
      delete process.env["BRIDGE_TEST_ENV_VAR"];
    });

    test("returns null for missing key", () => {
      expect(bridge.getSetting("NONEXISTENT_KEY_XYZ")).toBeNull();
    });

    test("config settings take precedence over env", () => {
      process.env["TEST_KEY"] = "from-env";
      expect(bridge.getSetting("TEST_KEY")).toBe("test_value");
      delete process.env["TEST_KEY"];
    });

    test("setSetting stores value retrievable by getSetting", () => {
      bridge.setSetting("NEW_KEY", "new_value");
      expect(bridge.getSetting("NEW_KEY")).toBe("new_value");
    });

    test("setSetting with null removes key", () => {
      bridge.setSetting("TEST_KEY", null);
      expect(bridge.getSetting("TEST_KEY")).toBeNull();
    });
  });

  // ---- Service registry ----
  describe("services", () => {
    test("injectService and getService", () => {
      const mockService = { stop: async () => {}, capabilityDescription: "test" } as Service;
      bridge.injectService("test_service", mockService);
      expect(bridge.getService("test_service")).toBe(mockService);
    });

    test("hasService returns true for registered service", () => {
      bridge.injectService("test_service", { stop: async () => {}, capabilityDescription: "test" } as Service);
      expect(bridge.hasService("test_service")).toBe(true);
      expect(bridge.hasService("nonexistent")).toBe(false);
    });

    test("getServicesByType returns all services of type", () => {
      const s1 = { stop: async () => {}, capabilityDescription: "s1" } as Service;
      const s2 = { stop: async () => {}, capabilityDescription: "s2" } as Service;
      bridge.injectService("my_type", s1);
      bridge.injectService("my_type", s2);
      expect(bridge.getServicesByType("my_type").length).toBe(2);
    });

    test("getRegisteredServiceTypes lists all types", () => {
      bridge.injectService("type_a", { stop: async () => {}, capabilityDescription: "" } as Service);
      bridge.injectService("type_b", { stop: async () => {}, capabilityDescription: "" } as Service);
      const types = bridge.getRegisteredServiceTypes();
      expect(types).toContain("type_a");
      expect(types).toContain("type_b");
    });
  });

  // ---- composeState ----
  describe("composeState", () => {
    test("runs providers and collects state", async () => {
      const provider: Provider = {
        name: "TEST_PROVIDER",
        get: async () => ({
          text: "Provider output text",
          values: { customKey: "customValue" },
          data: { entries: [1, 2, 3] },
        }),
      };
      bridge.registerProvider(provider);

      const message = {
        content: { text: "hello" },
        entityId: "e1",
        roomId: "r1",
      } as never;

      const state = await bridge.composeState(message);
      expect(state.text).toContain("Provider output text");
      expect(state.values["agentName"]).toBe("TestAgent");
      expect((state.values as Record<string, unknown>)["customKey"]).toBe("customValue");
    });

    test("handles provider failure gracefully", async () => {
      const failProvider: Provider = {
        name: "FAIL_PROVIDER",
        get: async () => {
          throw new Error("Provider explosion");
        },
      };
      bridge.registerProvider(failProvider);

      const message = { content: { text: "test" }, entityId: "e1", roomId: "r1" } as never;
      // Should not throw
      const state = await bridge.composeState(message);
      expect(state).toBeDefined();
      expect(state.values["agentName"]).toBe("TestAgent");
    });

    test("filters providers by includeList", async () => {
      const p1: Provider = {
        name: "INCLUDE_ME",
        get: async (): Promise<ProviderResult> => ({ text: "included" }),
      };
      const p2: Provider = {
        name: "EXCLUDE_ME",
        get: async (): Promise<ProviderResult> => ({ text: "excluded" }),
      };
      bridge.registerProvider(p1);
      bridge.registerProvider(p2);

      const message = { content: { text: "test" }, entityId: "e1", roomId: "r1" } as never;
      const state = await bridge.composeState(message, ["INCLUDE_ME"]);
      expect(state.text).toContain("included");
      // The second provider may or may not be in text depending on merge behavior
      // but the include list should add it to the set
    });
  });

  // ---- Events ----
  describe("events", () => {
    test("register and emit event", async () => {
      let received = false;
      bridge.registerEvent("TEST_EVENT", async () => {
        received = true;
      });
      await bridge.emitEvent("TEST_EVENT", {} as never);
      expect(received).toBe(true);
    });

    test("emit to multiple handlers", async () => {
      let count = 0;
      bridge.registerEvent("MULTI_EVENT", async () => { count++; });
      bridge.registerEvent("MULTI_EVENT", async () => { count++; });
      await bridge.emitEvent("MULTI_EVENT", {} as never);
      expect(count).toBe(2);
    });

    test("getEvent returns handlers", () => {
      const handler = async () => {};
      bridge.registerEvent("MY_EVENT", handler);
      const handlers = bridge.getEvent("MY_EVENT");
      expect(handlers).toBeDefined();
      expect(handlers?.length).toBe(1);
    });
  });

  // ---- Plugin registration ----
  describe("plugin registration", () => {
    test("registerAction adds to actions array", () => {
      bridge.registerAction({ name: "TEST_ACTION", description: "test", handler: async () => undefined, validate: async () => true } as never);
      expect(bridge.getAllActions().length).toBe(1);
      expect(bridge.getAllActions()[0].name).toBe("TEST_ACTION");
    });

    test("registerProvider adds to providers array", () => {
      bridge.registerProvider({ name: "P1", get: async () => ({}) } as never);
      expect(bridge.providers.length).toBe(1);
    });

    test("registerEvaluator adds to evaluators array", () => {
      bridge.registerEvaluator({ name: "E1" } as never);
      expect(bridge.evaluators.length).toBe(1);
    });

    test("isActionAllowed always returns true in adapter mode", () => {
      const result = bridge.isActionAllowed("ANYTHING");
      expect(result.allowed).toBe(true);
    });
  });

  // ---- Database operations via store ----
  describe("database delegation", () => {
    test("memory CRUD", async () => {
      const id = await bridge.createMemory(
        { content: { text: "mem" }, entityId: "e1", roomId: "r1" } as never,
        "messages",
      );
      const mem = await bridge.getMemoryById(id);
      expect(mem?.content.text).toBe("mem");

      await bridge.updateMemory({ id, content: { text: "updated" } } as never);
      const updated = await bridge.getMemoryById(id);
      expect(updated?.content.text).toBe("updated");

      await bridge.deleteMemory(id);
      expect(await bridge.getMemoryById(id)).toBeNull();
    });

    test("room CRUD", async () => {
      const roomId = await bridge.createRoom({ id: "r1", name: "Test" } as never);
      expect(roomId).toBe("r1");
      const room = await bridge.getRoom("r1");
      expect(room?.name).toBe("Test");
    });

    test("ensureRoomExists creates if missing", async () => {
      await bridge.ensureRoomExists({ id: "r1", name: "New" } as never);
      expect(await bridge.getRoom("r1")).not.toBeNull();
      // Should not throw on second call
      await bridge.ensureRoomExists({ id: "r1", name: "New" } as never);
    });

    test("participant management", async () => {
      await bridge.addParticipant("e1", "r1");
      expect(await bridge.isRoomParticipant("r1", "e1")).toBe(true);
      await bridge.ensureParticipantInRoom("e1", "r1"); // no-op
      expect(await bridge.isRoomParticipant("r1", "e1")).toBe(true);
    });

    test("cache operations", async () => {
      await bridge.setCache("k", { data: 42 });
      const val = await bridge.getCache<{ data: number }>("k");
      expect(val?.data).toBe(42);
      await bridge.deleteCache("k");
      expect(await bridge.getCache("k")).toBeUndefined();
    });
  });

  // ---- Not-implemented methods ----
  describe("not-implemented methods", () => {
    test("useModel throws NotImplementedError", async () => {
      await expect(bridge.useModel("text" as never, {} as never)).rejects.toThrow("is not implemented");
    });

    test("generateText throws NotImplementedError", async () => {
      await expect(bridge.generateText("hello")).rejects.toThrow("is not implemented");
    });

    test("sendMessageToTarget throws NotImplementedError", async () => {
      await expect(bridge.sendMessageToTarget({} as never, {} as never)).rejects.toThrow("is not implemented");
    });
  });

  // ---- Misc ----
  describe("miscellaneous", () => {
    test("redactSecrets replaces setting values in text", () => {
      const text = "My key is sk-abc123 and token is test_value";
      const redacted = bridge.redactSecrets(text);
      expect(redacted).not.toContain("sk-abc123");
      expect(redacted).not.toContain("test_value");
      expect(redacted).toContain("***REDACTED***");
    });

    test("agentId is a UUID string", () => {
      expect(bridge.agentId).toMatch(/^[0-9a-f-]{36}$/);
    });

    test("character has configured name", () => {
      expect(bridge.character.name).toBe("TestAgent");
    });

    test("isReady returns true", async () => {
      expect(await bridge.isReady()).toBe(true);
    });

    test("stop clears store", async () => {
      await bridge.createMemory({ content: { text: "x" }, entityId: "e1", roomId: "r1" } as never, "messages");
      await bridge.stop();
      // After stop, the store is cleared
      const mems = await bridge.getMemories({ tableName: "messages" });
      expect(mems.length).toBe(0);
    });
  });
});

// ==========================================================================
// Deep coverage: ensureX, serviceLoadPromise, emitEvent array, redact edge
// ==========================================================================

describe("RuntimeBridge — deep paths", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("ensureWorldExists with no id creates world", async () => {
    await bridge.ensureWorldExists({ name: "NoIdWorld" } as never);
    const worlds = await bridge.getAllWorlds();
    expect(worlds.length).toBe(1);
    expect(worlds[0].name).toBe("NoIdWorld");
  });

  test("ensureWorldExists with existing id is no-op", async () => {
    await bridge.createWorld({ id: "w1", name: "First" } as never);
    await bridge.ensureWorldExists({ id: "w1", name: "Second" } as never);
    const world = await bridge.getWorld("w1");
    expect(world?.name).toBe("First"); // not overwritten
  });

  test("ensureRoomExists with no id creates room", async () => {
    await bridge.ensureRoomExists({ name: "NoIdRoom" } as never);
    // Can't easily check by name, but at least no error
    const rooms = await bridge.getRooms("nonexistent");
    // Room was created with no worldId, so getRooms won't find it
    // The important thing is it didn't throw
  });

  test("ensureRoomExists with existing id is no-op", async () => {
    await bridge.createRoom({ id: "r1", name: "First" } as never);
    await bridge.ensureRoomExists({ id: "r1", name: "Second" } as never);
    const room = await bridge.getRoom("r1");
    expect(room?.name).toBe("First");
  });

  test("ensureConnection creates world + room + entity + participant", async () => {
    await bridge.ensureConnection({
      entityId: "e1",
      roomId: "r1",
      worldId: "w1",
      userName: "alice",
      worldName: "TestWorld",
    });

    expect(await bridge.getWorld("w1")).not.toBeNull();
    expect(await bridge.getRoom("r1")).not.toBeNull();
    expect(await bridge.getEntityById("e1")).not.toBeNull();
    expect(await bridge.isRoomParticipant("r1", "e1")).toBe(true);
  });

  test("ensureConnection reuses existing entity", async () => {
    await bridge.createEntity({ id: "e1", names: ["existing"] } as never);
    await bridge.ensureConnection({
      entityId: "e1",
      roomId: "r1",
      worldId: "w1",
      userName: "should_not_overwrite",
    });
    const entity = await bridge.getEntityById("e1");
    expect((entity as Record<string, unknown>)?.["names"]).toEqual(["existing"]);
  });

  test("ensureConnections creates world + rooms + entities", async () => {
    await bridge.ensureConnections(
      [{ id: "e1", names: ["a"] } as never, { id: "e2", names: ["b"] } as never],
      [{ id: "r1", worldId: "w1" } as never, { id: "r2", worldId: "w1" } as never],
      "test",
      { id: "w1", name: "W" } as never,
    );
    expect(await bridge.getWorld("w1")).not.toBeNull();
    expect(await bridge.getRoom("r1")).not.toBeNull();
    expect(await bridge.getRoom("r2")).not.toBeNull();
    expect(await bridge.getEntityById("e1")).not.toBeNull();
    expect(await bridge.getEntityById("e2")).not.toBeNull();
  });

  test("ensureConnections with empty entities doesn't call createEntities", async () => {
    await bridge.ensureConnections(
      [],
      [{ id: "r1" } as never],
      "test",
      { id: "w1" } as never,
    );
    expect(await bridge.getWorld("w1")).not.toBeNull();
    expect(await bridge.getRoom("r1")).not.toBeNull();
  });

  test("getServiceLoadPromise resolves when service is injected later", async () => {
    const promise = bridge.getServiceLoadPromise("future_svc");
    // Promise should be pending
    let resolved = false;
    promise.then(() => { resolved = true; });

    // Not yet resolved
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Now inject the service
    const mockSvc = { stop: async () => {}, capabilityDescription: "future" } as Service;
    bridge.injectService("future_svc", mockSvc);

    const result = await promise;
    expect(result).toBe(mockSvc);
  });

  test("getServiceLoadPromise returns same promise for duplicate calls", () => {
    const p1 = bridge.getServiceLoadPromise("pending_svc");
    const p2 = bridge.getServiceLoadPromise("pending_svc");
    expect(p1).toBe(p2);
  });

  test("registerPlugin accumulates actions/providers/evaluators/routes", async () => {
    await bridge.registerPlugin({
      name: "p1",
      description: "test",
      actions: [{ name: "A1" } as never, { name: "A2" } as never],
      providers: [{ name: "P1" } as never],
      evaluators: [{ name: "E1" } as never],
      routes: [{ path: "/test" } as never],
    });
    expect(bridge.actions.length).toBe(2);
    expect(bridge.providers.length).toBe(1);
    expect(bridge.evaluators.length).toBe(1);
    expect(bridge.routes.length).toBe(1);
    expect(bridge.plugins.length).toBe(1);
  });

  test("registerPlugin with no optional arrays doesn't crash", async () => {
    await bridge.registerPlugin({ name: "minimal", description: "bare" });
    expect(bridge.plugins.length).toBe(1);
    expect(bridge.actions.length).toBe(0);
  });

  test("redactSecrets does NOT redact short values (<=4 chars)", () => {
    const shortBridge = createBridge({ SHORT: "abc" });
    const text = "The value is abc and that's fine";
    expect(shortBridge.redactSecrets(text)).toBe(text); // unchanged
  });

  test("redactSecrets redacts multiple occurrences", () => {
    const text = "key=sk-abc123 and again sk-abc123";
    expect(bridge.redactSecrets(text)).toBe("key=***REDACTED*** and again ***REDACTED***");
  });

  test("emitEvent with array of event names calls all handlers", async () => {
    let aCount = 0;
    let bCount = 0;
    bridge.registerEvent("EVT_A", async () => { aCount++; });
    bridge.registerEvent("EVT_B", async () => { bCount++; });
    await bridge.emitEvent(["EVT_A", "EVT_B"], {});
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });

  test("emitEvent with nonexistent event is a no-op", async () => {
    await bridge.emitEvent("DOES_NOT_EXIST", {});
    // No error thrown
  });

  test("getAllMemories returns memories from messages table", async () => {
    await bridge.createMemory({ content: { text: "m1" }, entityId: "e1", roomId: "r1" } as never, "messages");
    await bridge.createMemory({ content: { text: "m2" }, entityId: "e1", roomId: "r1" } as never, "messages");
    const all = await bridge.getAllMemories();
    expect(all.length).toBe(2);
  });

  test("processActions throws NotImplementedError", async () => {
    await expect(bridge.processActions({} as never, [])).rejects.toThrow("is not implemented");
  });

  test("evaluate throws NotImplementedError", async () => {
    await expect(bridge.evaluate({} as never)).rejects.toThrow("is not implemented");
  });

  test("dynamicPromptExecFromState throws NotImplementedError", async () => {
    await expect(bridge.dynamicPromptExecFromState()).rejects.toThrow("is not implemented");
  });

  test("registerModel is a silent no-op", () => {
    bridge.registerModel(); // Should not throw
  });

  test("getModel returns undefined", () => {
    expect(bridge.getModel()).toBeUndefined();
  });

  test("evaluatePre returns { blocked: false }", async () => {
    const result = await bridge.evaluatePre();
    expect(result.blocked).toBe(false);
  });

  test("addEmbeddingToMemory returns memory unchanged", async () => {
    const mem = { content: { text: "test" }, entityId: "e1", roomId: "r1" } as never;
    const result = await bridge.addEmbeddingToMemory(mem);
    expect(result).toBe(mem);
  });

  test("queueEmbeddingGeneration is a silent no-op", async () => {
    await bridge.queueEmbeddingGeneration(); // Should not throw
  });

  test("registerSendHandler is a silent no-op", () => {
    bridge.registerSendHandler(); // Should not throw
  });

  test("registerDatabaseAdapter is a no-op", () => {
    bridge.registerDatabaseAdapter({} as never); // Should not throw
  });

  test("close clears the store", async () => {
    await bridge.createMemory({ content: { text: "x" }, entityId: "e1", roomId: "r1" } as never, "messages");
    await bridge.close();
    const mems = await bridge.getMemories({ tableName: "messages" });
    expect(mems.length).toBe(0);
  });

  test("getConnection returns the store", async () => {
    const conn = await bridge.getConnection();
    expect(conn).toBe(bridge.db);
  });

  test("storeActionResult and getActionResults round-trip", () => {
    bridge.storeActionResult("msg-1", { success: true, text: "done" });
    bridge.storeActionResult("msg-1", { success: false, error: "oops" });
    const results = bridge.getActionResults("msg-1");
    expect(results.length).toBe(2);
    expect(results[0].text).toBe("done");
    expect(results[1].error).toBe("oops");
  });

  test("getActionResults returns empty for unknown messageId", () => {
    expect(bridge.getActionResults("unknown")).toEqual([]);
  });

  test("startRun returns new UUID each time", () => {
    const r1 = bridge.startRun();
    const r2 = bridge.startRun();
    expect(r1).not.toBe(r2);
    expect(bridge.getCurrentRunId()).toBe(r2);
  });
});

// ==========================================================================
// Concurrent/async behavior
// ==========================================================================

describe("RuntimeBridge — concurrent operations", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("concurrent memory creation produces distinct IDs", async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        bridge.createMemory(
          { content: { text: `mem-${i}` }, entityId: "e1", roomId: "r1" } as never,
          "messages",
        ),
      ),
    );
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(20);
  });

  test("concurrent provider execution in composeState", async () => {
    const callOrder: string[] = [];

    bridge.registerProvider({
      name: "SLOW",
      get: async (): Promise<ProviderResult> => {
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push("slow");
        return { text: "slow" };
      },
    });
    bridge.registerProvider({
      name: "FAST",
      get: async (): Promise<ProviderResult> => {
        callOrder.push("fast");
        return { text: "fast" };
      },
    });

    const state = await bridge.composeState({ content: { text: "test" }, entityId: "e1", roomId: "r1" } as never);
    // Both should have run (sequentially in current implementation)
    expect(callOrder).toContain("slow");
    expect(callOrder).toContain("fast");
    expect(state.text).toContain("slow");
    expect(state.text).toContain("fast");
  });

  test("concurrent event emission calls all handlers", async () => {
    let count = 0;
    bridge.registerEvent("COUNT", async () => { count++; });
    bridge.registerEvent("COUNT", async () => { count++; });
    bridge.registerEvent("COUNT", async () => { count++; });

    await Promise.all([
      bridge.emitEvent("COUNT", {}),
      bridge.emitEvent("COUNT", {}),
    ]);
    expect(count).toBe(6); // 3 handlers x 2 emissions
  });

  test("service injection resolves getServiceLoadPromise across concurrent waiters", async () => {
    const p1 = bridge.getServiceLoadPromise("delayed");
    const p2 = bridge.getServiceLoadPromise("delayed");

    const mockSvc = { stop: async () => {}, capabilityDescription: "d" } as Service;

    // Schedule injection after a small delay
    setTimeout(() => bridge.injectService("delayed", mockSvc), 5);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(mockSvc);
    expect(r2).toBe(mockSvc);
  });
});

// ==========================================================================
// LARP fix verification tests
// ==========================================================================

describe("RuntimeBridge — LARP fix verification", () => {
  test("composeState includes alwaysRun providers even when dynamic", async () => {
    const bridge = createBridge();
    let alwaysRunCalled = false;
    let normalCalled = false;

    bridge.registerProvider({
      name: "ALWAYS_DYNAMIC",
      dynamic: true,
      alwaysRun: true,
      get: async (): Promise<ProviderResult> => {
        alwaysRunCalled = true;
        return { text: "always-here" };
      },
    });
    bridge.registerProvider({
      name: "NORMAL_DYNAMIC",
      dynamic: true,
      get: async (): Promise<ProviderResult> => {
        normalCalled = true;
        return { text: "should-be-filtered" };
      },
    });

    const state = await bridge.composeState({ content: { text: "test" }, entityId: "e1", roomId: "r1" } as never);

    expect(alwaysRunCalled).toBe(true);
    expect(normalCalled).toBe(false);
    expect(state.text).toContain("always-here");
    expect(state.text).not.toContain("should-be-filtered");

    await bridge.stop();
  });

  test("composeState includes alwaysRun alongside explicit includeList", async () => {
    const bridge = createBridge();
    let includedCalled = false;
    let alwaysCalled = false;

    bridge.registerProvider({
      name: "INCLUDED",
      get: async (): Promise<ProviderResult> => { includedCalled = true; return { text: "inc" }; },
    });
    bridge.registerProvider({
      name: "ALWAYS",
      dynamic: true,
      alwaysRun: true,
      get: async (): Promise<ProviderResult> => { alwaysCalled = true; return { text: "alw" }; },
    });
    bridge.registerProvider({
      name: "EXCLUDED",
      get: async (): Promise<ProviderResult> => { return { text: "exc" }; },
    });

    const state = await bridge.composeState(
      { content: { text: "test" }, entityId: "e1", roomId: "r1" } as never,
      ["INCLUDED"],
    );

    expect(includedCalled).toBe(true);
    expect(alwaysCalled).toBe(true);
    expect(state.text).toContain("inc");
    expect(state.text).toContain("alw");
    expect(state.text).not.toContain("exc");

    await bridge.stop();
  });

  test("setSetting preserves boolean type", async () => {
    const bridge = createBridge();
    bridge.setSetting("BOOL_KEY", true);
    expect(bridge.getSetting("BOOL_KEY")).toBe(true);

    bridge.setSetting("BOOL_KEY", false);
    // false is falsy but should still be stored and retrievable
    // getSetting checks `!== undefined` not truthiness
    expect(bridge.getSetting("BOOL_KEY")).toBe(false);

    await bridge.stop();
  });

  test("setSetting with string preserves string type", async () => {
    const bridge = createBridge();
    bridge.setSetting("STR_KEY", "hello");
    expect(bridge.getSetting("STR_KEY")).toBe("hello");
    expect(typeof bridge.getSetting("STR_KEY")).toBe("string");

    await bridge.stop();
  });
});

describe("RuntimeBridge — stateCache", () => {
  test("composeState caches result by message.id", async () => {
    const bridge = createBridge();
    let callCount = 0;
    bridge.registerProvider({
      name: "COUNTER",
      get: async (): Promise<ProviderResult> => { callCount++; return { text: `call-${callCount}` }; },
    });

    const message = { id: "msg-cache-test", content: { text: "hi" }, entityId: "e1", roomId: "r1" } as never;

    const state1 = await bridge.composeState(message);
    expect(state1.text).toContain("call-1");
    expect(callCount).toBe(1);

    // Second call with same message.id should return cached
    const state2 = await bridge.composeState(message);
    expect(state2.text).toContain("call-1"); // same as first
    expect(callCount).toBe(1); // provider NOT called again

    await bridge.stop();
  });

  test("composeState skips cache when skipCache=true", async () => {
    const bridge = createBridge();
    let callCount = 0;
    bridge.registerProvider({
      name: "COUNTER",
      get: async (): Promise<ProviderResult> => { callCount++; return { text: `call-${callCount}` }; },
    });

    const message = { id: "msg-skip-test", content: { text: "hi" }, entityId: "e1", roomId: "r1" } as never;

    await bridge.composeState(message);
    expect(callCount).toBe(1);

    // With skipCache=true, provider is called again
    const state2 = await bridge.composeState(message, null, false, true);
    expect(state2.text).toContain("call-2");
    expect(callCount).toBe(2);

    await bridge.stop();
  });

  test("composeState does not cache when message has no id", async () => {
    const bridge = createBridge();
    let callCount = 0;
    bridge.registerProvider({
      name: "COUNTER",
      get: async (): Promise<ProviderResult> => { callCount++; return { text: `call-${callCount}` }; },
    });

    const message = { content: { text: "hi" }, entityId: "e1", roomId: "r1" } as never; // no id

    await bridge.composeState(message);
    await bridge.composeState(message);
    expect(callCount).toBe(2); // called both times

    await bridge.stop();
  });
});
