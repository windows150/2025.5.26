import type { PluginLogger } from "./eliza-types.js";

export interface ElizaCompatLogger {
  [key: string]: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  success: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
}

export function createElizaLogger(oc: PluginLogger): ElizaCompatLogger {
  const fmt = (...args: unknown[]): string =>
    args.map((a) =>
      typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}` : JSON.stringify(a),
    ).join(" ");

  const dbg = oc.debug ?? oc.info;
  return {
    debug: (...a: unknown[]) => dbg(fmt(...a)),
    info: (...a: unknown[]) => oc.info(fmt(...a)),
    warn: (...a: unknown[]) => oc.warn(fmt(...a)),
    error: (...a: unknown[]) => oc.error(fmt(...a)),
    log: (...a: unknown[]) => oc.info(fmt(...a)),
    success: (...a: unknown[]) => oc.info(fmt(...a)),
    trace: (...a: unknown[]) => dbg(fmt(...a)),
  };
}
