# @elizaos/openclaw-adapter

Run [Eliza](https://github.com/elizaos/eliza) plugins inside [OpenClaw](https://github.com/openclaw/openclaw). Wraps Eliza actions as OpenClaw tools, providers as lifecycle hooks, services, routes, and evaluators — letting the two agent ecosystems interoperate.

## Quick start

```bash
# 1. Install the adapter and an Eliza plugin
npm install @elizaos/openclaw-adapter @elizaos/plugin-evm

# 2. Add to your OpenClaw config (see Configuration below)

# 3. Start OpenClaw — the EVM wallet tools are now available to your agent
```

## What it does

| Eliza concept | OpenClaw equivalent | How it works |
|---|---|---|
| Action | Tool | Parameters converted to TypeBox schema, handler wrapped in execute() |
| Provider | `before_agent_start` hook | Provider output injected as prepended context |
| Service | Service | Started eagerly, injected into RuntimeBridge for other components |
| Route | HTTP route | Request/response translated, paths prefixed with `/eliza` |
| Evaluator | `message_received` / `agent_end` hook | Pre-evaluators → message hooks, post-evaluators → agent-end hooks |
| Event | Lifecycle hook | Mapped where semantics align (MESSAGE_RECEIVED → message_received, etc.) |

## Install

```bash
npm install @elizaos/openclaw-adapter
```

If you're inside the OpenClaw monorepo, the adapter is already at `extensions/eliza-adapter/` and gets discovered automatically.

## Configuration

### Step 1: Install the Eliza plugins you want

```bash
# EVM wallet (Ethereum, Base, Arbitrum, etc.)
npm install @elizaos/plugin-evm

# Solana wallet
npm install @elizaos/plugin-solana

# Or any other Eliza plugin
npm install @elizaos/plugin-discord
```

### Step 2: Add the adapter to your OpenClaw config

In your `openclaw.json` (or wherever your OpenClaw config lives):

```json
{
  "plugins": {
    "eliza-adapter": {
      "plugins": [
        "@elizaos/plugin-evm"
      ],
      "settings": {
        "EVM_PRIVATE_KEY": "${EVM_PRIVATE_KEY}",
        "EVM_PROVIDER_URL": "https://mainnet.infura.io/v3/YOUR_KEY"
      },
      "agentName": "WalletBot"
    }
  }
}
```

### Step 3: Set environment variables

The adapter resolves `${VAR}` patterns in settings from environment variables:

```bash
export EVM_PRIVATE_KEY="0x..."
export EVM_PROVIDER_URL="https://mainnet.infura.io/v3/..."
```

Or pass them directly (not recommended for secrets):

```json
{
  "settings": {
    "EVM_PRIVATE_KEY": "0xabcdef..."
  }
}
```

### Config reference

| Field | Required | Default | Description |
|---|---|---|---|
| `plugins` | **Yes** | — | Array of Eliza plugin package names or file paths |
| `settings` | No | `{}` | Key-value pairs passed to plugins via `runtime.getSetting()`. Supports `${ENV_VAR}` expansion. |
| `agentName` | No | `"Eliza"` | Agent display name in the Eliza character context |

### Example configs

**EVM wallet only:**

```json
{
  "plugins": {
    "eliza-adapter": {
      "plugins": ["@elizaos/plugin-evm"],
      "settings": {
        "EVM_PRIVATE_KEY": "${EVM_PRIVATE_KEY}"
      }
    }
  }
}
```

**Multiple plugins:**

```json
{
  "plugins": {
    "eliza-adapter": {
      "plugins": [
        "@elizaos/plugin-evm",
        "@elizaos/plugin-solana"
      ],
      "settings": {
        "EVM_PRIVATE_KEY": "${EVM_PRIVATE_KEY}",
        "SOLANA_PRIVATE_KEY": "${SOLANA_PRIVATE_KEY}",
        "SOLANA_RPC_URL": "https://api.mainnet-beta.solana.com"
      },
      "agentName": "MultiWallet"
    }
  }
}
```

**Local plugin by file path:**

```json
{
  "plugins": {
    "eliza-adapter": {
      "plugins": ["./my-custom-eliza-plugin/index.js"]
    }
  }
}
```

## What gets registered

When you configure `plugins: ["@elizaos/plugin-evm"]`, the adapter:

1. **Starts** the EVMService (connects wallet, sets up RPC)
2. **Registers tools**: `eliza_send_tokens`, `eliza_swap_tokens`, `eliza_cross_chain_transfer`, etc.
3. **Registers hooks**: Wallet balance and token balance injected into agent context before each run
4. **Registers routes**: Any HTTP endpoints the plugin exposes, under `/eliza/...`

The tools appear in OpenClaw's agent like any native tool:

```
Agent: calling eliza_send_tokens({ toAddress: "0x742d...", amount: "1.5", chain: "base" })
→ Successfully transferred 1.5 ETH to 0x742d...
  Transaction: 0xabc...
```

### Built-in tool schemas

The adapter includes pre-built parameter schemas for common wallet actions:

| Tool name | Parameters |
|---|---|
| `eliza_send_tokens` | `toAddress`, `amount`, `token?`, `chain?` |
| `eliza_swap_tokens` | `inputToken`, `outputToken`, `amount`, `chain?`, `slippage?` |
| `eliza_cross_chain_transfer` | `token`, `amount`, `fromChain`, `toChain`, `toAddress?` |
| `eliza_transfer_sol` | `toAddress`, `amount`, `mint?` |
| `eliza_swap_sol` | `inputMint`, `outputMint`, `amount`, `slippage?` |

Actions with explicit parameter definitions get their schemas converted automatically. Unknown actions get a generic `{ input: string }` fallback.

## Plugin resolution

Eliza plugins are loaded via dynamic `import()`. They must be npm-installed or path-resolvable from where OpenClaw runs:

```bash
# Install globally alongside OpenClaw
npm install @elizaos/plugin-evm

# Or link a local development plugin
npm link ../my-local-eliza-plugin
```

The adapter tries these export patterns in order:
1. Default export (`export default plugin`)
2. Named `plugin` export (`export const plugin = ...`)
3. Any named export matching the Plugin shape (`{ name: string, description: string }`)

## Supported Eliza plugins

Any Eliza plugin that exports the standard `Plugin` shape works:

- **Wallet plugins** (plugin-evm, plugin-solana) — actions become transfer/swap/bridge tools
- **Service plugins** — started and available via `runtime.getService()`
- **Provider plugins** — context injected into agent prompts

### Known limitations

- **LLM methods** (`useModel`, `generateText`) are not available. Actions that rely on conversational parameter extraction need explicit parameters or known schemas.
- **Channel plugins** (Discord, Telegram) register as tools only, not as native OpenClaw channels.
- **Database** is in-memory with LRU eviction (10K memories/table, 5K logs). No persistence across restarts.
- **Embeddings** are not generated. Vector search works if embeddings are provided but none are created automatically.

## Development

```bash
git clone https://github.com/elizaOS/openclaw-adapter.git
cd openclaw-adapter
npm install

# Run tests (418 tests)
npm test

# Type-check
npm run typecheck

# Build
npm run build
```

## Architecture

```
index.ts                    Entry point — loads plugins, orchestrates registration
src/
  runtime-bridge.ts         IAgentRuntime shim backed by InMemoryStore
  in-memory-store.ts        IDatabaseAdapter with LRU eviction
  action-to-tool.ts         Eliza Action → OpenClaw tool
  provider-to-hook.ts       Eliza Provider → before_agent_start hook
  service-adapter.ts        Eliza Service → OpenClaw service
  route-adapter.ts          Eliza Route → OpenClaw HTTP route
  evaluator-to-hook.ts      Eliza Evaluator → lifecycle hooks
  schema-converter.ts       JSON Schema → TypeBox + known wallet schemas
  event-mapper.ts           Eliza events → OpenClaw hooks
  config.ts                 Config parsing with ${ENV_VAR} resolution
  eliza-types.ts            Local type definitions (zero runtime deps on @elizaos/core)
  logger-adapter.ts         Logger shape adapter
  memory-builder.ts         Memory object construction
  types.ts                  Config types + NotImplementedError
```

## License

MIT
