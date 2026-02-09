/**
 * Converts Eliza ActionParameterSchema (JSON Schema subset) to TypeBox schemas.
 */

import { Type, type TSchema } from "@sinclair/typebox";
import type { ActionParameter, ActionParameterSchema } from "./eliza-types.js";

/** Convert one Eliza schema node to TypeBox. */
export function convertSchema(schema: ActionParameterSchema): TSchema {
  const desc = schema.description;

  // Enum values take priority over type
  const enumVals = schema.enumValues ?? schema.enum;
  if (enumVals && enumVals.length > 0) {
    const literals = enumVals.map((v) => Type.Literal(v));
    return literals.length === 1 ? literals[0] : Type.Union(literals, desc ? { description: desc } : {});
  }

  switch (schema.type) {
    case "string":
      return Type.String({
        ...(desc && { description: desc }),
        ...(schema.minLength !== undefined && { minLength: schema.minLength }),
        ...(schema.maxLength !== undefined && { maxLength: schema.maxLength }),
        ...(schema.pattern && { pattern: schema.pattern }),
        ...(schema.format && { format: schema.format }),
        ...(schema.default != null && { default: schema.default }),
      });

    case "number":
      return Type.Number({
        ...(desc && { description: desc }),
        ...(schema.minimum !== undefined && { minimum: schema.minimum }),
        ...(schema.maximum !== undefined && { maximum: schema.maximum }),
        ...(schema.default != null && { default: schema.default }),
      });

    case "integer":
      return Type.Integer({
        ...(desc && { description: desc }),
        ...(schema.minimum !== undefined && { minimum: schema.minimum }),
        ...(schema.maximum !== undefined && { maximum: schema.maximum }),
        ...(schema.default != null && { default: schema.default }),
      });

    case "boolean":
      return Type.Boolean({
        ...(desc && { description: desc }),
        ...(schema.default != null && { default: schema.default }),
      });

    case "array":
      return Type.Array(
        schema.items ? convertSchema(schema.items) : Type.Unknown(),
        desc ? { description: desc } : {},
      );

    case "object":
      if (schema.properties) {
        const props: Record<string, TSchema> = {};
        for (const [key, child] of Object.entries(schema.properties)) {
          props[key] = convertSchema(child);
        }
        return Type.Object(props, desc ? { description: desc } : {});
      }
      return Type.Record(Type.String(), Type.Unknown(), desc ? { description: desc } : {});

    default:
      return Type.String({
        ...(desc && { description: desc }),
        ...(schema.default != null && { default: schema.default }),
      });
  }
}

/** Convert ActionParameter[] to a single TypeBox Object schema. */
export function convertActionParameters(params: ActionParameter[]): TSchema {
  const props: Record<string, TSchema> = {};
  for (const param of params) {
    const field = convertSchema(param.schema);
    props[param.name] = param.required ? field : Type.Optional(field);
  }
  return Type.Object(props);
}

/** Pre-built schemas for well-known Eliza actions without explicit parameters. */
export const KNOWN_ACTION_SCHEMAS: Record<string, TSchema> = {
  SEND_TOKENS: Type.Object({
    toAddress: Type.String({ description: "Recipient wallet address" }),
    amount: Type.String({ description: "Amount to transfer (e.g. '1.5')" }),
    token: Type.Optional(Type.String({ description: "Token symbol or address. Omit for native token." })),
    chain: Type.Optional(Type.String({ description: "Chain name (e.g. 'ethereum', 'base')." })),
  }),
  SWAP_TOKENS: Type.Object({
    inputToken: Type.String({ description: "Token to swap from" }),
    outputToken: Type.String({ description: "Token to swap to" }),
    amount: Type.String({ description: "Amount of input token" }),
    chain: Type.Optional(Type.String({ description: "Chain name" })),
    slippage: Type.Optional(Type.Number({ description: "Max slippage %", minimum: 0, maximum: 100 })),
  }),
  CROSS_CHAIN_TRANSFER: Type.Object({
    token: Type.String({ description: "Token to bridge" }),
    amount: Type.String({ description: "Amount to bridge" }),
    fromChain: Type.String({ description: "Source chain" }),
    toChain: Type.String({ description: "Destination chain" }),
    toAddress: Type.Optional(Type.String({ description: "Destination address (defaults to sender)" })),
  }),
  TRANSFER_SOL: Type.Object({
    toAddress: Type.String({ description: "Recipient Solana address" }),
    amount: Type.String({ description: "Amount of SOL" }),
    mint: Type.Optional(Type.String({ description: "SPL token mint. Omit for native SOL." })),
  }),
  SWAP_SOL: Type.Object({
    inputMint: Type.String({ description: "Input token mint" }),
    outputMint: Type.String({ description: "Output token mint" }),
    amount: Type.String({ description: "Amount of input token" }),
    slippage: Type.Optional(Type.Number({ description: "Slippage in basis points" })),
  }),
};

/** Fallback schema for unknown actions. */
export function fallbackActionSchema(description: string): TSchema {
  return Type.Object({
    input: Type.String({ description: description || "Natural language instruction" }),
  });
}
