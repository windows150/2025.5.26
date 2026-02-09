/**
 * A real, loadable Eliza plugin (not a mock) for smoke-testing import().
 * This file is imported by path in the smoke test to verify the actual
 * dynamic import code path in index.ts works end-to-end.
 */

const realPlugin = {
  name: "real-minimal",
  description: "A real plugin loaded by file path",
  actions: [
    {
      name: "PING",
      description: "Returns pong",
      validate: async () => true,
      handler: async (
        _runtime: unknown,
        _message: unknown,
        _state: unknown,
        _options: unknown,
        callback?: (response: { text: string }) => Promise<unknown[]>,
      ) => {
        if (callback) await callback({ text: "pong" });
        return { success: true, text: "pong" };
      },
    },
  ],
  providers: [
    {
      name: "CLOCK",
      get: async () => ({ text: `Time: ${new Date().toISOString()}` }),
    },
  ],
  init: async (_config: Record<string, string>, runtime: { getSetting: (k: string) => unknown }) => {
    const greeting = runtime.getSetting("GREETING");
    if (greeting) {
      // Plugin init ran and could read settings
    }
  },
};

export default realPlugin;
