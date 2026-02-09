import { describe, test, expect, beforeEach } from "vitest";
import type { Evaluator } from "../eliza-types.js";
import { RuntimeBridge } from "../runtime-bridge.js";
import { adaptEvaluatorToHook } from "../evaluator-to-hook.js";

function createBridge(): RuntimeBridge {
  return new RuntimeBridge({
    config: { plugins: [], settings: {}, agentName: "Test" },
    openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
}

describe("adaptEvaluatorToHook", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    bridge = createBridge();
  });

  test("pre-evaluator maps to message_received hook", () => {
    const evaluator: Evaluator = {
      name: "SECURITY_GATE",
      description: "Blocks bad messages",
      handler: async () => undefined,
      validate: async () => true,
      examples: [],
      phase: "pre",
    };
    const adapted = adaptEvaluatorToHook(evaluator, bridge);
    expect(adapted.hookName).toBe("message_received");
    expect(adapted.evaluatorName).toBe("SECURITY_GATE");
  });

  test("post-evaluator maps to agent_end hook", () => {
    const evaluator: Evaluator = {
      name: "REFLECT",
      description: "Post-conversation reflection",
      handler: async () => undefined,
      validate: async () => true,
      examples: [],
      phase: "post",
    };
    const adapted = adaptEvaluatorToHook(evaluator, bridge);
    expect(adapted.hookName).toBe("agent_end");
  });

  test("default phase (undefined) maps to agent_end", () => {
    const evaluator: Evaluator = {
      name: "DEFAULT_PHASE",
      description: "No phase specified",
      handler: async () => undefined,
      validate: async () => true,
      examples: [],
    };
    const adapted = adaptEvaluatorToHook(evaluator, bridge);
    expect(adapted.hookName).toBe("agent_end");
  });

  test("pre-evaluator handler runs when validate returns true", async () => {
    let handlerCalled = false;
    const evaluator: Evaluator = {
      name: "PRE_EVAL",
      description: "Pre eval",
      handler: async () => { handlerCalled = true; return undefined; },
      validate: async () => true,
      examples: [],
      phase: "pre",
    };
    const adapted = adaptEvaluatorToHook(evaluator, bridge);
    if (adapted.hookName === "message_received") {
      await adapted.handler(
        { from: "user", content: "hello", timestamp: Date.now() },
        { channelId: "ch1" },
      );
    }
    expect(handlerCalled).toBe(true);
  });

  test("pre-evaluator handler skips when validate returns false", async () => {
    let handlerCalled = false;
    const evaluator: Evaluator = {
      name: "SKIP_EVAL",
      description: "Skips",
      handler: async () => { handlerCalled = true; return undefined; },
      validate: async () => false,
      examples: [],
      phase: "pre",
    };
    const adapted = adaptEvaluatorToHook(evaluator, bridge);
    if (adapted.hookName === "message_received") {
      await adapted.handler(
        { from: "user", content: "hello" },
        { channelId: "ch1" },
      );
    }
    expect(handlerCalled).toBe(false);
  });

  test("alwaysRun evaluator skips validation", async () => {
    let handlerCalled = false;
    const evaluator: Evaluator = {
      name: "ALWAYS_RUN",
      description: "Always runs",
      handler: async () => { handlerCalled = true; return undefined; },
      validate: async () => false, // Would normally skip
      examples: [],
      phase: "pre",
      alwaysRun: true,
    };
    const adapted = adaptEvaluatorToHook(evaluator, bridge);
    if (adapted.hookName === "message_received") {
      await adapted.handler(
        { from: "user", content: "test" },
        { channelId: "ch1" },
      );
    }
    expect(handlerCalled).toBe(true);
  });

  test("post-evaluator skips on failed agent run", async () => {
    let handlerCalled = false;
    const evaluator: Evaluator = {
      name: "POST_EVAL",
      description: "Post eval",
      handler: async () => { handlerCalled = true; return undefined; },
      validate: async () => true,
      examples: [],
      phase: "post",
    };
    const adapted = adaptEvaluatorToHook(evaluator, bridge);
    if (adapted.hookName === "agent_end") {
      await adapted.handler(
        { messages: [], success: false, durationMs: 100 },
        {},
      );
    }
    expect(handlerCalled).toBe(false);
  });
});
