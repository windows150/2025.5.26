import type { ElizaAdapterConfig } from "./types.js";

const ENV_VAR_RE = /\$\{([^}]+)\}/g;

function resolveEnvVars(value: string): string {
  return value.replace(ENV_VAR_RE, (match, name: string) => process.env[name.trim()] ?? match);
}

export function parseAdapterConfig(raw: Record<string, unknown> | undefined): ElizaAdapterConfig {
  if (!raw) throw new Error('eliza-adapter: missing config. Provide { "plugins": [...] }.');

  const rawPlugins = raw["plugins"];
  if (!Array.isArray(rawPlugins) || rawPlugins.length === 0) {
    throw new Error('eliza-adapter: "plugins" must be a non-empty array.');
  }
  const plugins: string[] = [];
  for (let i = 0; i < rawPlugins.length; i++) {
    const entry = rawPlugins[i];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`eliza-adapter: plugins[${i}] must be a non-empty string, got ${typeof entry}.`);
    }
    plugins.push(entry.trim());
  }

  let settings: Record<string, string> = {};
  const rawSettings = raw["settings"];
  if (rawSettings !== undefined && rawSettings !== null) {
    if (typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
      throw new Error('eliza-adapter: "settings" must be an object mapping string keys to string values.');
    }
    for (const [key, value] of Object.entries(rawSettings as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new Error(`eliza-adapter: settings["${key}"] must be a string, got ${typeof value}.`);
      }
      settings[key] = resolveEnvVars(value);
    }
  }

  const rawName = raw["agentName"];
  const agentName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "Eliza";

  return { plugins, settings, agentName };
}
