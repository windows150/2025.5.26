import { describe, test, expect } from "vitest";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { convertSchema, convertActionParameters, KNOWN_ACTION_SCHEMAS, fallbackActionSchema } from "../schema-converter.js";

describe("convertSchema", () => {
  test("converts string type", () => {
    const schema = convertSchema({ type: "string", description: "A name" });
    expect(Value.Check(schema, "hello")).toBe(true);
    expect(Value.Check(schema, 123)).toBe(false);
  });

  test("converts number type with constraints", () => {
    const schema = convertSchema({ type: "number", minimum: 0, maximum: 100 });
    expect(Value.Check(schema, 50)).toBe(true);
    expect(Value.Check(schema, -1)).toBe(false);
    expect(Value.Check(schema, 101)).toBe(false);
  });

  test("converts integer type", () => {
    const schema = convertSchema({ type: "integer" });
    expect(Value.Check(schema, 5)).toBe(true);
    expect(Value.Check(schema, 5.5)).toBe(false);
  });

  test("converts boolean type", () => {
    const schema = convertSchema({ type: "boolean" });
    expect(Value.Check(schema, true)).toBe(true);
    expect(Value.Check(schema, "true")).toBe(false);
  });

  test("converts enum values", () => {
    const schema = convertSchema({ type: "string", enum: ["a", "b", "c"] });
    expect(Value.Check(schema, "a")).toBe(true);
    expect(Value.Check(schema, "d")).toBe(false);
  });

  test("converts enumValues field", () => {
    const schema = convertSchema({ type: "string", enumValues: ["x", "y"] });
    expect(Value.Check(schema, "x")).toBe(true);
    expect(Value.Check(schema, "z")).toBe(false);
  });

  test("converts object type with properties", () => {
    const schema = convertSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    });
    expect(Value.Check(schema, { name: "Alice", age: 30 })).toBe(true);
  });

  test("converts array type", () => {
    const schema = convertSchema({
      type: "array",
      items: { type: "string" },
    });
    expect(Value.Check(schema, ["a", "b"])).toBe(true);
    expect(Value.Check(schema, [1, 2])).toBe(false);
  });

  test("falls back to string for unknown type", () => {
    const schema = convertSchema({} as never);
    // Should accept strings
    expect(Value.Check(schema, "anything")).toBe(true);
  });
});

describe("convertActionParameters", () => {
  test("converts required and optional parameters", () => {
    const schema = convertActionParameters([
      { name: "to", description: "Recipient", required: true, schema: { type: "string" } },
      { name: "amount", description: "Amount", required: false, schema: { type: "number" } },
    ]);
    expect(Value.Check(schema, { to: "0x123", amount: 1.5 })).toBe(true);
    expect(Value.Check(schema, { to: "0x123" })).toBe(true); // amount is optional
  });

  test("required parameter must be present", () => {
    const schema = convertActionParameters([
      { name: "to", description: "Recipient", required: true, schema: { type: "string" } },
    ]);
    expect(Value.Check(schema, {})).toBe(false);
  });
});

describe("KNOWN_ACTION_SCHEMAS", () => {
  test("SEND_TOKENS schema validates correct input", () => {
    const schema = KNOWN_ACTION_SCHEMAS["SEND_TOKENS"];
    expect(schema).toBeDefined();
    expect(
      Value.Check(schema, {
        toAddress: "0x123",
        amount: "1.5",
      }),
    ).toBe(true);
  });

  test("SEND_TOKENS schema with optional fields", () => {
    const schema = KNOWN_ACTION_SCHEMAS["SEND_TOKENS"];
    expect(
      Value.Check(schema, {
        toAddress: "0x123",
        amount: "1.5",
        token: "USDC",
        chain: "ethereum",
      }),
    ).toBe(true);
  });

  test("SWAP_TOKENS schema validates", () => {
    const schema = KNOWN_ACTION_SCHEMAS["SWAP_TOKENS"];
    expect(
      Value.Check(schema, {
        inputToken: "ETH",
        outputToken: "USDC",
        amount: "1.0",
      }),
    ).toBe(true);
  });
});

describe("fallbackActionSchema", () => {
  test("creates schema with input field", () => {
    const schema = fallbackActionSchema("Do something");
    expect(Value.Check(schema, { input: "hello" })).toBe(true);
    expect(Value.Check(schema, {})).toBe(false);
  });
});

// ==========================================================================
// Deep coverage: nested objects, single enum, defaults, missing desc
// ==========================================================================

describe("convertSchema — deep edge cases", () => {
  test("single enum value produces Literal not Union", () => {
    const schema = convertSchema({ type: "string", enum: ["only"] });
    expect(Value.Check(schema, "only")).toBe(true);
    expect(Value.Check(schema, "other")).toBe(false);
  });

  test("nested object with mixed types", () => {
    const schema = convertSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        config: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            count: { type: "integer" },
          },
        },
      },
    });
    expect(Value.Check(schema, { name: "test", config: { enabled: true, count: 5 } })).toBe(true);
    expect(Value.Check(schema, { name: "test", config: { enabled: "yes", count: 5 } })).toBe(false);
  });

  test("array of objects", () => {
    const schema = convertSchema({
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          value: { type: "number" },
        },
      },
    });
    expect(Value.Check(schema, [{ id: "a", value: 1 }, { id: "b", value: 2 }])).toBe(true);
  });

  test("string with default value", () => {
    const schema = convertSchema({ type: "string", default: "hello" });
    // TypeBox's Default decorator — the schema itself accepts strings
    expect(Value.Check(schema, "hello")).toBe(true);
    expect(Value.Check(schema, "other")).toBe(true);
  });

  test("number with default value", () => {
    const schema = convertSchema({ type: "number", default: 42 });
    expect(Value.Check(schema, 42)).toBe(true);
    expect(Value.Check(schema, 0)).toBe(true);
  });

  test("object with no properties produces open record", () => {
    const schema = convertSchema({ type: "object" });
    expect(Value.Check(schema, {})).toBe(true);
    expect(Value.Check(schema, { anything: "goes" })).toBe(true);
  });

  test("array with no items schema uses Unknown", () => {
    const schema = convertSchema({ type: "array" });
    expect(Value.Check(schema, [1, "two", true])).toBe(true);
    expect(Value.Check(schema, [])).toBe(true);
  });

  test("enumValues takes priority over type", () => {
    const schema = convertSchema({ type: "number", enumValues: ["a", "b"] });
    // Should be string enum, not number
    expect(Value.Check(schema, "a")).toBe(true);
    expect(Value.Check(schema, 1)).toBe(false);
  });

  test("schema with no type and no enum defaults to string", () => {
    const schema = convertSchema({ description: "just a desc" });
    expect(Value.Check(schema, "hello")).toBe(true);
    expect(Value.Check(schema, 123)).toBe(false);
  });

  test("convertActionParameters with empty array produces empty object", () => {
    const schema = convertActionParameters([]);
    expect(Value.Check(schema, {})).toBe(true);
  });
});
