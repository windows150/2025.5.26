import { describe, test, expect, beforeEach } from "vitest";
import type { Service, ServiceClass, IAgentRuntime } from "../eliza-types.js";
import { RuntimeBridge } from "../runtime-bridge.js";
import { adaptService } from "../service-adapter.js";

function createBridge(): RuntimeBridge {
  return new RuntimeBridge({
    config: { plugins: [], settings: {}, agentName: "Test" },
    openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
}

describe("adaptService", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("creates service with correct id", () => {
    const serviceClass = {
      serviceType: "evm",
      start: async () => ({ stop: async () => {}, capabilityDescription: "EVM" }) as unknown as Service,
      new: () => ({} as Service),
    } as unknown as ServiceClass;

    const adapted = adaptService(serviceClass, bridge);
    expect(adapted.id).toBe("eliza:evm");
    expect(adapted.elizaServiceType).toBe("evm");
  });

  test("start calls ServiceClass.start and injects into bridge", async () => {
    let startCalled = false;
    const mockInstance = { stop: async () => {}, capabilityDescription: "test" } as unknown as Service;

    const serviceClass = {
      serviceType: "test_svc",
      start: async (runtime: IAgentRuntime) => {
        startCalled = true;
        expect(runtime).toBe(bridge);
        return mockInstance;
      },
      new: () => ({} as Service),
    } as unknown as ServiceClass;

    const adapted = adaptService(serviceClass, bridge);
    await adapted.start({} as never);

    expect(startCalled).toBe(true);
    expect(bridge.getService("test_svc")).toBe(mockInstance);
  });

  test("stop calls instance.stop and static stopRuntime", async () => {
    let instanceStopped = false;
    let staticStopped = false;

    const serviceClass = {
      serviceType: "stoppable",
      start: async () =>
        ({
          stop: async () => { instanceStopped = true; },
          capabilityDescription: "stop test",
        }) as unknown as Service,
      stopRuntime: async () => { staticStopped = true; },
      new: () => ({} as Service),
    } as unknown as ServiceClass;

    const adapted = adaptService(serviceClass, bridge);
    await adapted.start({} as never);
    await adapted.stop!({} as never);

    expect(instanceStopped).toBe(true);
    expect(staticStopped).toBe(true);
  });

  test("stop is safe when service was never started", async () => {
    const serviceClass = {
      serviceType: "never_started",
      start: async () => ({ stop: async () => {}, capabilityDescription: "" }) as unknown as Service,
      new: () => ({} as Service),
    } as unknown as ServiceClass;

    const adapted = adaptService(serviceClass, bridge);
    // Should not throw when stopping without starting
    await adapted.stop!({} as never);
  });

  test("calls registerSendHandlers if present", async () => {
    let handlersRegistered = false;
    const mockInstance = { stop: async () => {}, capabilityDescription: "test" } as unknown as Service;

    const serviceClass = {
      serviceType: "with_handlers",
      start: async () => mockInstance,
      registerSendHandlers: (_runtime: IAgentRuntime, _service: Service) => {
        handlersRegistered = true;
      },
      new: () => ({} as Service),
    } as unknown as ServiceClass;

    const adapted = adaptService(serviceClass, bridge);
    await adapted.start({} as never);
    expect(handlersRegistered).toBe(true);
  });
});
