import { describe, test, expect } from "vitest";
import { mapElizaEventToOpenClawHook, getSupportedElizaEvents } from "../event-mapper.js";

describe("event-mapper", () => {
  test("maps MESSAGE_RECEIVED to message_received", () => {
    expect(mapElizaEventToOpenClawHook("MESSAGE_RECEIVED")).toBe("message_received");
  });

  test("maps MESSAGE_SENT to message_sent", () => {
    expect(mapElizaEventToOpenClawHook("MESSAGE_SENT")).toBe("message_sent");
  });

  test("maps RUN_STARTED to before_agent_start", () => {
    expect(mapElizaEventToOpenClawHook("RUN_STARTED")).toBe("before_agent_start");
  });

  test("maps RUN_ENDED to agent_end", () => {
    expect(mapElizaEventToOpenClawHook("RUN_ENDED")).toBe("agent_end");
  });

  test("returns undefined for unmapped events", () => {
    expect(mapElizaEventToOpenClawHook("ENTITY_JOINED")).toBeUndefined();
    expect(mapElizaEventToOpenClawHook("WORLD_JOINED")).toBeUndefined();
    expect(mapElizaEventToOpenClawHook("NONEXISTENT")).toBeUndefined();
  });

  test("getSupportedElizaEvents returns all mapped event names", () => {
    const events = getSupportedElizaEvents();
    expect(events).toContain("MESSAGE_RECEIVED");
    expect(events).toContain("MESSAGE_SENT");
    expect(events).toContain("RUN_STARTED");
    expect(events).toContain("RUN_ENDED");
    expect(events.length).toBeGreaterThanOrEqual(4);
  });
});
