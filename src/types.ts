export type ElizaAdapterConfig = {
  plugins: string[];
  settings: Record<string, string>;
  agentName: string;
};

export type PluginRegistrationRecord = {
  pluginName: string;
  toolCount: number;
  hookCount: number;
  serviceCount: number;
  routeCount: number;
};

export type PluginLoadError = {
  specifier: string;
  error: string;
  timestamp: number;
};

export type AdapterStatus = {
  plugins: PluginRegistrationRecord[];
  errors: PluginLoadError[];
  totals: { tools: number; hooks: number; services: number; routes: number };
  startedAt: number;
};

export class NotImplementedError extends Error {
  constructor(methodName: string) {
    super(`RuntimeBridge.${methodName}() is not implemented.`);
    this.name = "NotImplementedError";
  }
}
