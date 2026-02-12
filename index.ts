/**
 * Eliza Plugin Adapter for OpenClaw.
 *
 * ASSUMPTIONS & LIMITATIONS:
 * - Eliza plugins must be importable from this context (npm-installed or path-resolvable)
 * - eliza-types.ts manually mirrors @elizaos/core types — must be updated when Eliza core changes
 * - InMemoryStore is ephemeral with no persistence and no eviction (unbounded growth)
 * - Services are started eagerly during register(), not deferred to OpenClaw lifecycle
 * - LLM methods (useModel, generateText) throw NotImplementedError — actions needing LLM extraction won't work
 * - Connector plugins (Discord, Telegram) register as tools only, not as OpenClaw channels
 * - Database adapter plugins are not bridged — the InMemoryStore is the only database
 * - One RuntimeBridge per adapter registration — no multi-tenant support
 */
import type { OpenClawPluginApi, Plugin as ElizaPlugin, EventPayload } from "./src/eliza-types.js";
import { parseAdapterConfig } from "./src/config.js";
import { RuntimeBridge } from "./src/runtime-bridge.js";
import { adaptActionToTool } from "./src/action-to-tool.js";
import { adaptProviderToHook } from "./src/provider-to-hook.js";
import { adaptService } from "./src/service-adapter.js";
import { adaptRoute } from "./src/route-adapter.js";
import { adaptEvaluatorToHook } from "./src/evaluator-to-hook.js";
import { mapElizaEventToOpenClawHook } from "./src/event-mapper.js";
import { createStatusTool } from "./src/status-tool.js";
import type { AdapterStatus, PluginLoadError, PluginRegistrationRecord } from "./src/types.js";

async function loadElizaPlugin(specifier: string, logger: OpenClawPluginApi["logger"]): Promise<ElizaPlugin> {
  logger.info(`[eliza-adapter] Loading: ${specifier}`);
  const mod = (await import(specifier)) as Record<string, unknown>;
  if (mod["default"] && isPlugin(mod["default"])) return mod["default"] as ElizaPlugin;
  if (mod["plugin"] && isPlugin(mod["plugin"])) return mod["plugin"] as ElizaPlugin;
  for (const v of Object.values(mod)) { if (isPlugin(v)) return v as ElizaPlugin; }
  throw new Error(`[eliza-adapter] "${specifier}" has no valid Eliza Plugin export.`);
}

function isPlugin(v: unknown): v is ElizaPlugin {
  return !!v && typeof v === "object" && typeof (v as Record<string, unknown>)["name"] === "string" && typeof (v as Record<string, unknown>)["description"] === "string";
}

async function registerElizaPlugin(plugin: ElizaPlugin, bridge: RuntimeBridge, api: OpenClawPluginApi): Promise<PluginRegistrationRecord> {
  const r: PluginRegistrationRecord = { pluginName: plugin.name, toolCount: 0, hookCount: 0, serviceCount: 0, routeCount: 0 };

  // Start services immediately — Eliza plugins call getService() during init
  for (const sc of plugin.services ?? []) {
    const adapted = adaptService(sc, bridge);
    await adapted.start({ stateDir: "", logger: bridge.logger, config: {} });
    api.registerService({ id: adapted.id, start() {}, stop: adapted.stop });
    r.serviceCount++;
  }

  if (plugin.init) {
    await plugin.init(((api.pluginConfig as Record<string, unknown> | undefined)?.["settings"] ?? {}) as Record<string, string>, bridge);
  }

  for (const action of plugin.actions ?? []) { const t = adaptActionToTool(action, bridge); api.registerTool(t, { name: t.name }); bridge.registerAction(action); r.toolCount++; }
  for (const prov of plugin.providers ?? []) { const a = adaptProviderToHook(prov, bridge); api.on(a.hookName, a.handler); bridge.registerProvider(prov); r.hookCount++; }
  for (const ev of plugin.evaluators ?? []) { const a = adaptEvaluatorToHook(ev, bridge); api.on(a.hookName, a.handler); bridge.registerEvaluator(ev); r.hookCount++; }
  for (const route of plugin.routes ?? []) { const a = adaptRoute(route, bridge); if (a) { api.registerHttpRoute(a); r.routeCount++; } }

  for (const [eventName, handlers] of Object.entries(plugin.events ?? {})) {
    if (!handlers) continue;
    const hookName = mapElizaEventToOpenClawHook(eventName);
    if (!hookName) { api.logger.debug?.(`[eliza-adapter] Unmapped event: ${eventName}`); continue; }
    for (const handler of handlers) { api.on(hookName, async () => { await handler({} as EventPayload); }); r.hookCount++; }
  }

  return r;
}

export default {
  id: "eliza-adapter",
  name: "Eliza Plugin Adapter",
  description: "Wraps Eliza plugins as OpenClaw extensions",

  async register(api: OpenClawPluginApi): Promise<void> {
    const config = parseAdapterConfig(api.pluginConfig as Record<string, unknown> | undefined);
    api.logger.info(`[eliza-adapter] Loading ${config.plugins.length} plugin(s): ${config.plugins.join(", ")}`);

    const bridge = new RuntimeBridge({ config, openclawLogger: api.logger });
    await bridge.initialize();

    const status: AdapterStatus = {
      plugins: [],
      errors: [],
      totals: { tools: 0, hooks: 0, services: 0, routes: 0 },
      startedAt: Date.now(),
    };

    for (const spec of config.plugins) {
      try {
        const plugin = await loadElizaPlugin(spec, api.logger);
        const r = await registerElizaPlugin(plugin, bridge, api);
        status.plugins.push(r);
        status.totals.tools += r.toolCount;
        status.totals.hooks += r.hookCount;
        status.totals.services += r.serviceCount;
        status.totals.routes += r.routeCount;
        api.logger.info(`[eliza-adapter] "${plugin.name}": ${r.toolCount}T ${r.hookCount}H ${r.serviceCount}S ${r.routeCount}R`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const loadError: PluginLoadError = { specifier: spec, error: errorMsg, timestamp: Date.now() };
        status.errors.push(loadError);
        api.logger.error(`[eliza-adapter] Failed to load "${spec}": ${errorMsg}`);
      }
    }

    // Register the diagnostic status tool
    const statusTool = createStatusTool(status);
    api.registerTool(statusTool, { name: statusTool.name });

    if (status.errors.length > 0) {
      api.logger.warn(`[eliza-adapter] ${status.errors.length} plugin(s) failed to load. Use eliza_adapter_status tool for details.`);
    }

    const { tools, hooks, services, routes } = status.totals;
    api.logger.info(`[eliza-adapter] Ready: ${tools}T ${hooks}H ${services}S ${routes}R (${status.errors.length} error(s))`);
    api.registerService({ id: "eliza-adapter-lifecycle", start() {}, stop: () => bridge.stop() });
  },
};
