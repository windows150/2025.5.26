/**
 * Integration test: EVM wallet plugin adapter flow.
 *
 * This test creates a realistic mock of @elizaos/plugin-evm that matches
 * the actual plugin's structure (actions, providers, services), and
 * verifies the complete adapter flow: loading, registration, tool execution,
 * provider injection, and service lifecycle.
 *
 * We cannot import the actual plugin-evm here because it depends on
 * @elizaos/core and viem — but this mock faithfully reproduces its shape
 * and behavior patterns.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import type {
  Plugin,
  Action,
  ActionResult,
  Provider,
  ProviderResult,
  Service,
  ServiceClass,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "../../eliza-types.js";
import { RuntimeBridge } from "../../runtime-bridge.js";
import { adaptActionToTool } from "../../action-to-tool.js";
import { adaptProviderToHook } from "../../provider-to-hook.js";
import { adaptService, type AdaptedService } from "../../service-adapter.js";
import { adaptRoute } from "../../route-adapter.js";

// ---------------------------------------------------------------------------
// Realistic EVM plugin mock
// ---------------------------------------------------------------------------

const EVM_SERVICE_NAME = "evm";

/** Mock WalletProvider mirroring the real one's public API */
class MockWalletProvider {
  private address: string;

  constructor(address: string) {
    this.address = address;
  }

  getAddress(): string {
    return this.address;
  }

  async getBalance(): Promise<string> {
    return "1.5";
  }

  async getFormattedPortfolio(): Promise<string> {
    return `Wallet: ${this.address}\nBalance: 1.5 ETH\nChain: ethereum`;
  }
}

/** Mock EVMService matching the real service's lifecycle */
let mockWalletProvider: MockWalletProvider | null = null;

const MockEVMService: ServiceClass = {
  serviceType: EVM_SERVICE_NAME,
  async start(runtime: IAgentRuntime): Promise<Service> {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY") as string;
    if (!privateKey || !privateKey.startsWith("0x")) {
      throw new Error("EVM_PRIVATE_KEY must be a hex string starting with 0x");
    }
    // Derive a deterministic "address" from the key (mock)
    mockWalletProvider = new MockWalletProvider("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");

    const service = {
      stop: async () => { mockWalletProvider = null; },
      capabilityDescription: "EVM blockchain wallet access",
      getCachedData: async () => ({
        address: mockWalletProvider!.getAddress(),
        chains: [{ name: "ethereum", balance: "1.5", symbol: "ETH" }],
      }),
    } as unknown as Service;

    return service;
  },
  new: (_runtime?: IAgentRuntime) => ({} as Service),
} as unknown as ServiceClass;

/** Transfer action matching the real transfer action's behavior */
const mockTransferAction: Action = {
  name: "SEND_TOKENS",
  description: "Transfer tokens from the agent's wallet to another address",
  similes: ["SEND_TOKEN", "TRANSFER_TOKEN", "TRANSFER_TOKENS", "SEND_TOKENS"],

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult | undefined> => {
    if (!state) {
      state = await runtime.composeState(message);
    }

    // Extract params (in real plugin this uses LLM, we use direct params)
    const params = (options?.["parameters"] ?? {}) as Record<string, unknown>;
    const toAddress = params["toAddress"] as string;
    const amount = params["amount"] as string;

    if (!toAddress || !amount) {
      if (callback) {
        await callback({ text: "Missing required parameters: toAddress and amount" });
      }
      return { success: false, error: "Missing toAddress or amount" };
    }

    // Mock transfer execution
    const txHash = "0x" + "a".repeat(64);

    if (callback) {
      await callback({
        text: `Successfully transferred ${amount} ETH to ${toAddress}\nTransaction: ${txHash}`,
      });
    }

    return {
      success: true,
      text: `Transfer complete: ${amount} ETH to ${toAddress}`,
      data: {
        txHash,
        from: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        to: toAddress,
        amount,
      },
    };
  },
};

/** Swap action */
const mockSwapAction: Action = {
  name: "SWAP_TOKENS",
  description: "Swap tokens on a decentralized exchange",

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult | undefined> => {
    const params = (options?.["parameters"] ?? {}) as Record<string, unknown>;
    const inputToken = params["inputToken"] as string;
    const outputToken = params["outputToken"] as string;
    const amount = params["amount"] as string;

    if (callback) {
      await callback({
        text: `Swapped ${amount} ${inputToken} for ${outputToken}`,
      });
    }

    return {
      success: true,
      text: `Swap complete: ${amount} ${inputToken} → ${outputToken}`,
    };
  },
};

/** Wallet provider matching the real EVMWalletProvider */
const mockWalletProviderDef: Provider = {
  name: "EVMWalletProvider",
  async get(runtime: IAgentRuntime): Promise<ProviderResult> {
    const evmService = runtime.getService(EVM_SERVICE_NAME);
    if (!evmService) {
      return { text: "EVM service not available" };
    }

    const serviceWithCache = evmService as {
      getCachedData?: () => Promise<{
        address: string;
        chains: Array<{ name: string; balance: string; symbol: string }>;
      } | undefined>;
    };

    if (typeof serviceWithCache.getCachedData !== "function") {
      return { text: "EVM service missing getCachedData" };
    }

    const data = await serviceWithCache.getCachedData();
    if (!data) {
      return { text: "No wallet data available" };
    }

    const chainInfo = data.chains
      .map((c) => `${c.name}: ${c.balance} ${c.symbol}`)
      .join("\n");

    return {
      text: `EVM Wallet Address: ${data.address}\n${chainInfo}`,
      values: { walletAddress: data.address },
      data: { chains: data.chains },
    };
  },
};

/** Balance provider */
const mockBalanceProvider: Provider = {
  name: "TOKEN_BALANCE",
  async get(runtime: IAgentRuntime): Promise<ProviderResult> {
    const evmService = runtime.getService(EVM_SERVICE_NAME);
    if (!evmService) {
      return { text: "" };
    }
    return {
      text: "Token balances: 1.5 ETH, 1000 USDC",
      values: { ethBalance: "1.5", usdcBalance: "1000" },
    };
  },
};

/** Route for wallet status */
const mockStatusRoute = {
  type: "GET" as const,
  path: "/wallet/status",
  public: true,
  name: "wallet-status",
  handler: async (
    _req: { body?: Record<string, unknown> },
    res: { status: (code: number) => { json: (data: unknown) => void } },
    runtime: IAgentRuntime,
  ) => {
    const evmService = runtime.getService(EVM_SERVICE_NAME);
    res.status(200).json({
      connected: !!evmService,
      address: mockWalletProvider?.getAddress() ?? null,
    });
  },
};

/** The complete mock EVM plugin */
const mockEvmPlugin: Plugin = {
  name: "evm",
  description: "EVM blockchain integration plugin",
  providers: [mockWalletProviderDef, mockBalanceProvider],
  evaluators: [],
  services: [MockEVMService],
  actions: [mockTransferAction, mockSwapAction],
  routes: [mockStatusRoute],
  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    const token = runtime.getSetting("EVM_PRIVATE_KEY");
    if (!token) {
      runtime.logger.warn(
        "EVM_PRIVATE_KEY not set — EVM plugin loaded but will not be functional",
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EVM Wallet Plugin Integration", () => {
  let bridge: RuntimeBridge;

  beforeEach(() => {
    mockWalletProvider = null;
    bridge = new RuntimeBridge({
      config: {
        plugins: [],
        settings: {
          EVM_PRIVATE_KEY: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          EVM_PROVIDER_URL: "https://mainnet.infura.io/v3/test-key",
        },
        agentName: "WalletBot",
      },
      openclawLogger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    });
  });

  afterEach(async () => {
    await bridge.stop();
  });

  test("full plugin lifecycle: services → init → tools → hooks → execution", async () => {
    // Tracking structures (simulating OpenClaw API)
    const registeredTools: { name: string; tool: ReturnType<typeof adaptActionToTool> }[] = [];
    const registeredHooks: { hookName: string; providerName: string }[] = [];
    const registeredServices: AdaptedService[] = [];
    const registeredRoutes: { path: string }[] = [];

    // ===== Phase 1: Start services =====
    for (const serviceClass of mockEvmPlugin.services!) {
      const adapted = adaptService(serviceClass, bridge);
      registeredServices.push(adapted);
      await adapted.start({ stateDir: "/tmp", logger: bridge.logger as never } as never);
    }

    // Verify EVM service is available in the bridge
    expect(bridge.hasService(EVM_SERVICE_NAME)).toBe(true);
    const evmSvc = bridge.getService(EVM_SERVICE_NAME);
    expect(evmSvc).not.toBeNull();

    // ===== Phase 2: Init =====
    await mockEvmPlugin.init!({}, bridge);

    // ===== Phase 3: Register actions as tools =====
    for (const action of mockEvmPlugin.actions!) {
      const tool = adaptActionToTool(action, bridge);
      registeredTools.push({ name: tool.name, tool });
      bridge.registerAction(action);
    }

    expect(registeredTools.length).toBe(2);
    expect(registeredTools.map((t) => t.name)).toContain("eliza_send_tokens");
    expect(registeredTools.map((t) => t.name)).toContain("eliza_swap_tokens");

    // ===== Phase 4: Register providers as hooks =====
    for (const provider of mockEvmPlugin.providers!) {
      const adapted = adaptProviderToHook(provider, bridge);
      registeredHooks.push({ hookName: adapted.hookName, providerName: adapted.providerName });
      bridge.registerProvider(provider);
    }

    expect(registeredHooks.length).toBe(2);
    expect(registeredHooks.map((h) => h.providerName)).toContain("EVMWalletProvider");
    expect(registeredHooks.map((h) => h.providerName)).toContain("TOKEN_BALANCE");

    // ===== Phase 5: Register routes =====
    for (const route of mockEvmPlugin.routes!) {
      const adapted = adaptRoute(route, bridge);
      if (adapted) {
        registeredRoutes.push({ path: adapted.path });
      }
    }

    expect(registeredRoutes.length).toBe(1);
    expect(registeredRoutes[0].path).toBe("/eliza/wallet/status");

    // ===== Verify: Execute transfer tool =====
    const transferTool = registeredTools.find((t) => t.name === "eliza_send_tokens")!.tool;
    const transferResult = await transferTool.execute("call-1", {
      toAddress: "0xRecipientAddress",
      amount: "0.5",
    });

    // Should have success content
    const transferTexts = transferResult.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);

    expect(transferTexts.some((t) => t.includes("0.5 ETH"))).toBe(true);
    expect(transferTexts.some((t) => t.includes("0xRecipientAddress"))).toBe(true);
    expect((transferResult.details as Record<string, unknown>)?.["success"]).toBe(true);
    expect(
      ((transferResult.details as Record<string, unknown>)?.["data"] as Record<string, unknown>)?.["txHash"],
    ).toBeDefined();

    // ===== Verify: Execute swap tool =====
    const swapTool = registeredTools.find((t) => t.name === "eliza_swap_tokens")!.tool;
    const swapResult = await swapTool.execute("call-2", {
      inputToken: "ETH",
      outputToken: "USDC",
      amount: "1.0",
    });

    const swapTexts = swapResult.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);

    expect(swapTexts.some((t) => t.includes("ETH") && t.includes("USDC"))).toBe(true);

    // ===== Verify: Provider hook injects wallet context =====
    const walletHook = registeredHooks.find((h) => h.providerName === "EVMWalletProvider")!;
    const walletProvider = mockEvmPlugin.providers!.find((p) => p.name === "EVMWalletProvider")!;
    const adaptedHook = adaptProviderToHook(walletProvider, bridge);

    const hookResult = await adaptedHook.handler(
      { prompt: "What is my wallet balance?" },
      {},
    );

    expect(hookResult).toBeDefined();
    const prependCtx = (hookResult as { prependContext: string }).prependContext;
    expect(prependCtx).toContain("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
    expect(prependCtx).toContain("ethereum");
    expect(prependCtx).toContain("1.5 ETH");

    // ===== Verify: composeState includes provider output =====
    const state = await bridge.composeState({
      content: { text: "check balance" },
      entityId: "e1",
      roomId: "r1",
    } as never);

    expect(state.text).toContain("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
    expect(state.text).toContain("Token balances");
    expect(state.values["agentName"]).toBe("WalletBot");

    // ===== Verify: Service cleanup =====
    for (const service of registeredServices) {
      if (service.stop) await service.stop({} as never);
    }
    // After stopping, wallet provider should be null
    expect(mockWalletProvider).toBeNull();
  });

  test("transfer tool fails validation without private key", async () => {
    // Create bridge WITHOUT private key
    const noBridge = new RuntimeBridge({
      config: { plugins: [], settings: {}, agentName: "NoKey" },
      openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });

    const tool = adaptActionToTool(mockTransferAction, noBridge);
    const result = await tool.execute("call-1", {
      toAddress: "0x123",
      amount: "1.0",
    });

    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);

    expect(texts.some((t) => t.includes("validation failed"))).toBe(true);
    expect((result.details as Record<string, unknown>)?.["error"]).toBe("validation_failed");

    await noBridge.stop();
  });

  test("provider returns empty when service not started", async () => {
    // Don't start the service — provider should gracefully handle missing service
    bridge.registerProvider(mockWalletProviderDef);

    const state = await bridge.composeState({
      content: { text: "balance" },
      entityId: "e1",
      roomId: "r1",
    } as never);

    // Provider should still run but return fallback text
    expect(state.text).toContain("EVM service not available");
  });

  test("service start fails with bad private key", async () => {
    const badBridge = new RuntimeBridge({
      config: { plugins: [], settings: { EVM_PRIVATE_KEY: "not-a-hex-key" }, agentName: "Bad" },
      openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });

    const adapted = adaptService(MockEVMService, badBridge);
    await expect(adapted.start({} as never)).rejects.toThrow("EVM_PRIVATE_KEY must be a hex string");

    await badBridge.stop();
  });

  test("multiple actions register distinct tools", async () => {
    const tools: string[] = [];
    for (const action of mockEvmPlugin.actions!) {
      const tool = adaptActionToTool(action, bridge);
      tools.push(tool.name);
    }

    // Each action gets a unique tool name
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools).toContain("eliza_send_tokens");
    expect(tools).toContain("eliza_swap_tokens");
  });

  test("handler receives parameters through options", async () => {
    // Start service first
    const adapted = adaptService(MockEVMService, bridge);
    await adapted.start({} as never);

    const tool = adaptActionToTool(mockTransferAction, bridge);
    const result = await tool.execute("call-1", {
      toAddress: "0xDeadBeef",
      amount: "2.5",
      token: "ETH",
      chain: "base",
    });

    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);

    expect(texts.some((t) => t.includes("2.5 ETH"))).toBe(true);
    expect(texts.some((t) => t.includes("0xDeadBeef"))).toBe(true);

    if (adapted.stop) await adapted.stop({} as never);
  });
});
