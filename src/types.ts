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

export class NotImplementedError extends Error {
  constructor(methodName: string) {
    super(`RuntimeBridge.${methodName}() is not implemented.`);
    this.name = "NotImplementedError";
  }
}
