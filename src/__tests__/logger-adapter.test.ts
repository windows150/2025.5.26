import { describe, test, expect } from "vitest";
import { createElizaLogger } from "../logger-adapter.js";
import type { PluginLogger } from "../eliza-types.js";

describe("createElizaLogger", () => {
  function createCapture() {
    const captured: { level: string; message: string }[] = [];
    const ocLogger: PluginLogger = {
      debug: (msg: string) => captured.push({ level: "debug", message: msg }),
      info: (msg: string) => captured.push({ level: "info", message: msg }),
      warn: (msg: string) => captured.push({ level: "warn", message: msg }),
      error: (msg: string) => captured.push({ level: "error", message: msg }),
    };
    return { captured, ocLogger };
  }

  test("info forwards to openclaw info", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.info("test message");
    expect(captured.length).toBe(1);
    expect(captured[0].level).toBe("info");
    expect(captured[0].message).toBe("test message");
  });

  test("warn forwards to openclaw warn", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.warn("warning!");
    expect(captured[0].level).toBe("warn");
  });

  test("error forwards to openclaw error", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.error("something broke");
    expect(captured[0].level).toBe("error");
    expect(captured[0].message).toBe("something broke");
  });

  test("debug forwards to openclaw debug", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.debug("debug info");
    expect(captured[0].level).toBe("debug");
  });

  test("log maps to info", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.log("log message");
    expect(captured[0].level).toBe("info");
  });

  test("success maps to info", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.success("success message");
    expect(captured[0].level).toBe("info");
  });

  test("trace maps to debug", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.trace("trace message");
    expect(captured[0].level).toBe("debug");
  });

  test("handles multiple arguments by joining", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.info("hello", "world", 42);
    expect(captured[0].message).toBe("hello world 42");
  });

  test("stringifies objects", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.info("data:", { key: "value" });
    expect(captured[0].message).toContain('"key":"value"');
  });

  test("formats Error objects", () => {
    const { captured, ocLogger } = createCapture();
    const logger = createElizaLogger(ocLogger);
    logger.error("failed:", new Error("boom"));
    expect(captured[0].message).toContain("Error: boom");
  });

  test("falls back to info when debug is undefined", () => {
    const captured: { level: string; message: string }[] = [];
    const ocLogger: PluginLogger = {
      info: (msg: string) => captured.push({ level: "info", message: msg }),
      warn: (msg: string) => captured.push({ level: "warn", message: msg }),
      error: (msg: string) => captured.push({ level: "error", message: msg }),
    };
    const logger = createElizaLogger(ocLogger);
    logger.debug("fallback");
    expect(captured[0].level).toBe("info");
    expect(captured[0].message).toBe("fallback");
  });
});
