/**
 * Diagnostic tool that exposes adapter health and registration status.
 *
 * Registered automatically — agents can call `eliza_adapter_status` to see
 * which plugins loaded, what tools/hooks/services/routes were registered,
 * and any errors that occurred during initialization.
 */

import { Type } from "@sinclair/typebox";
import type { AdapterStatus } from "./types.js";

type ToolResultContent = { type: "text"; text: string };
type ToolResult = { content: ToolResultContent[]; details?: Record<string, unknown> };

export function createStatusTool(status: AdapterStatus) {
  return {
    name: "eliza_adapter_status",
    label: "Eliza Adapter Status",
    description: "Shows which Eliza plugins are loaded, registered tools/hooks/services/routes, and any errors that occurred during initialization.",
    parameters: Type.Object({}),

    async execute(_toolCallId: string, _args: Record<string, unknown>): Promise<ToolResult> {
      const lines: string[] = [];
      const uptime = Math.round((Date.now() - status.startedAt) / 1000);

      lines.push(`Eliza Adapter Status (uptime: ${uptime}s)`);
      lines.push(`─────────────────────────────────────`);

      // Totals
      const { tools, hooks, services, routes } = status.totals;
      lines.push(`Totals: ${tools} tools, ${hooks} hooks, ${services} services, ${routes} routes`);
      lines.push(``);

      // Per-plugin breakdown
      if (status.plugins.length > 0) {
        lines.push(`Loaded plugins (${status.plugins.length}):`);
        for (const p of status.plugins) {
          lines.push(`  ✓ ${p.pluginName}: ${p.toolCount}T ${p.hookCount}H ${p.serviceCount}S ${p.routeCount}R`);
        }
      } else {
        lines.push(`No plugins loaded successfully.`);
      }

      // Errors
      if (status.errors.length > 0) {
        lines.push(``);
        lines.push(`Failed plugins (${status.errors.length}):`);
        for (const e of status.errors) {
          const ago = Math.round((Date.now() - e.timestamp) / 1000);
          lines.push(`  ✗ ${e.specifier}: ${e.error} (${ago}s ago)`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          plugins: status.plugins,
          errors: status.errors,
          totals: status.totals,
          uptimeSeconds: uptime,
          healthy: status.errors.length === 0,
        },
      };
    },
  };
}
