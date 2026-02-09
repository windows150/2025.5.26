import { describe, test, expect } from "vitest";
import { parseAdapterConfig } from "../config.js";

describe("parseAdapterConfig", () => {
  test("parses valid minimal config", () => {
    const config = parseAdapterConfig({
      plugins: ["@elizaos/plugin-evm"],
    });
    expect(config.plugins).toEqual(["@elizaos/plugin-evm"]);
    expect(config.settings).toEqual({});
    expect(config.agentName).toBe("Eliza");
  });

  test("parses full config with settings and agentName", () => {
    const config = parseAdapterConfig({
      plugins: ["@elizaos/plugin-evm", "@elizaos/plugin-solana"],
      settings: {
        EVM_PRIVATE_KEY: "0xabc123",
        SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",
      },
      agentName: "MyAgent",
    });
    expect(config.plugins).toEqual(["@elizaos/plugin-evm", "@elizaos/plugin-solana"]);
    expect(config.settings["EVM_PRIVATE_KEY"]).toBe("0xabc123");
    expect(config.settings["SOLANA_RPC_URL"]).toBe("https://api.mainnet-beta.solana.com");
    expect(config.agentName).toBe("MyAgent");
  });

  test("resolves ${ENV_VAR} in settings", () => {
    process.env["TEST_ADAPTER_KEY"] = "resolved-value";
    const config = parseAdapterConfig({
      plugins: ["test-plugin"],
      settings: { MY_KEY: "${TEST_ADAPTER_KEY}" },
    });
    expect(config.settings["MY_KEY"]).toBe("resolved-value");
    delete process.env["TEST_ADAPTER_KEY"];
  });

  test("leaves unresolvable ${ENV_VAR} intact", () => {
    delete process.env["NONEXISTENT_KEY_XYZ"];
    const config = parseAdapterConfig({
      plugins: ["test-plugin"],
      settings: { MY_KEY: "${NONEXISTENT_KEY_XYZ}" },
    });
    expect(config.settings["MY_KEY"]).toBe("${NONEXISTENT_KEY_XYZ}");
  });

  test("throws on missing config", () => {
    expect(() => parseAdapterConfig(undefined)).toThrow("missing config");
  });

  test("throws on empty plugins array", () => {
    expect(() => parseAdapterConfig({ plugins: [] })).toThrow("non-empty array");
  });

  test("throws on non-array plugins", () => {
    expect(() => parseAdapterConfig({ plugins: "not-an-array" })).toThrow("non-empty array");
  });

  test("throws on non-string plugin entry", () => {
    expect(() => parseAdapterConfig({ plugins: [123] })).toThrow("plugins[0] must be a non-empty string");
  });

  test("throws on non-string settings value", () => {
    expect(() =>
      parseAdapterConfig({ plugins: ["p"], settings: { key: 123 } }),
    ).toThrow('settings["key"] must be a string');
  });

  test("trims plugin names", () => {
    const config = parseAdapterConfig({ plugins: ["  @elizaos/plugin-evm  "] });
    expect(config.plugins[0]).toBe("@elizaos/plugin-evm");
  });

  test("trims agent name", () => {
    const config = parseAdapterConfig({ plugins: ["p"], agentName: "  Agent  " });
    expect(config.agentName).toBe("Agent");
  });

  test("defaults agentName for empty string", () => {
    const config = parseAdapterConfig({ plugins: ["p"], agentName: "   " });
    expect(config.agentName).toBe("Eliza");
  });
});

describe("parseAdapterConfig — additional edge cases", () => {
  test("throws when settings is an array", () => {
    expect(() => parseAdapterConfig({ plugins: ["p"], settings: [] })).toThrow("settings");
  });

  test("handles settings with multiple env vars in one value", () => {
    process.env["HOST_A"] = "alpha";
    process.env["HOST_B"] = "beta";
    const config = parseAdapterConfig({
      plugins: ["p"],
      settings: { COMBINED: "${HOST_A}:${HOST_B}" },
    });
    expect(config.settings["COMBINED"]).toBe("alpha:beta");
    delete process.env["HOST_A"];
    delete process.env["HOST_B"];
  });

  test("handles null settings gracefully", () => {
    const config = parseAdapterConfig({ plugins: ["p"], settings: null });
    expect(config.settings).toEqual({});
  });

  test("preserves non-env-var dollar signs", () => {
    const config = parseAdapterConfig({
      plugins: ["p"],
      settings: { PRICE: "$100" },
    });
    expect(config.settings["PRICE"]).toBe("$100");
  });

  test("multiple plugins all validated", () => {
    expect(() =>
      parseAdapterConfig({ plugins: ["a", "", "c"] }),
    ).toThrow("plugins[1]");
  });

  test("agentName with number is accepted", () => {
    const config = parseAdapterConfig({ plugins: ["p"], agentName: "Agent007" });
    expect(config.agentName).toBe("Agent007");
  });
});
