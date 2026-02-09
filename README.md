# @openclaw/eliza-adapter

Run [Eliza](https://github.com/elizaos/eliza) plugins inside [OpenClaw](https://github.com/openclaw/openclaw). Wraps Eliza actions as OpenClaw tools, providers as lifecycle hooks, services, routes, and evaluators — letting the two agent ecosystems interoperate.

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

### Inside the OpenClaw monorepo

Already in place at `extensions/eliza-adapter/`. Enable it in your OpenClaw config.

### Standalone (npm)

```bash
npm install @openclaw/eliza-adapter
```

Then register as an OpenClaw extension (see Configuration below).

## Configuration

Add to your OpenClaw config:

```json
{
  "plugins": {
    "eliza-adapter": {
      "plugins": ["@elizaos/plugin-evm"],
      "settings": {
        "EVM_PRIVATE_KEY": "${EVM_PRIVATE_KEY}",
        "EVM_PROVIDER_URL": "https://mainnet.infura.io/v3/YOUR_KEY"
      },
      "agentName": "WalletBot"
    }
  }
}
```

### Config fields

| Field | Required | Description |
|---|---|---|
| `plugins` | Yes | Array of Eliza plugin package names or file paths to load |
| `settings` | No | Key-value settings passed to plugins via `runtime.getSetting()`. Supports `${ENV_VAR}` expansion. |
| `agentName` | No | Agent display name (default: `"Eliza"`) |

## What gets registered

When you configure `plugins: ["@elizaos/plugin-evm"]`, the adapter:

1. **Starts** the EVMService (connects wallet, sets up RPC)
2. **Registers tools**: `eliza_send_tokens`, `eliza_swap_tokens`, `eliza_cross_chain_transfer`, etc.
3. **Registers hooks**: Wallet balance and token balance injected into agent context before each run
4. **Registers routes**: Any HTTP endpoints the plugin exposes, under `/eliza/...`

The tools appear in OpenClaw's agent like any native tool. The agent can call `eliza_send_tokens` with `{ toAddress: "0x...", amount: "1.5", chain: "base" }` and the adapter handles execution through the Eliza plugin's action handler.

## Supported Eliza plugins

Any Eliza plugin that exports the standard `Plugin` shape works. Tested patterns:

- **Wallet plugins** (plugin-evm, plugin-solana) — actions become transfer/swap/bridge tools
- **Service plugins** — started and available via `runtime.getService()`
- **Provider plugins** — context injected into agent prompts

### Known limitations

- **LLM methods** (`useModel`, `generateText`) throw `NotImplementedError`. Actions that rely on conversational parameter extraction need explicit parameters or known schemas.
- **Channel plugins** (Discord, Telegram) register as tools only, not as native OpenClaw channels.
- **Database** is in-memory (10K memories/table cap with LRU eviction). No persistence.
- **Embeddings** are not generated. Vector search works if embeddings are provided but none are created automatically.

## Plugin resolution

Eliza plugins are loaded via dynamic `import()`. They must be resolvable from the OpenClaw runtime context:

```bash
# Install the Eliza plugin you want to use
npm install @elizaos/plugin-evm

# Or use a file path
{
  "plugins": ["./path/to/my-eliza-plugin/index.js"]
}
```

## Development

```bash
# Run tests (418 tests)
pnpm test

# Type-check
pnpm typecheck

# Build for publishing
pnpm build
```

## Architecture

```
index.ts                    Entry point — loads plugins, orchestrates registration
src/
  runtime-bridge.ts         IAgentRuntime implementation backed by InMemoryStore
  in-memory-store.ts        Full IDatabaseAdapter with eviction (memories, rooms, entities, etc.)
  action-to-tool.ts         Eliza Action → OpenClaw tool (with schema conversion)
  provider-to-hook.ts       Eliza Provider → before_agent_start hook
  service-adapter.ts        Eliza Service → OpenClaw service lifecycle
  route-adapter.ts          Eliza Route → OpenClaw HTTP route
  evaluator-to-hook.ts      Eliza Evaluator → message_received/agent_end hook
  schema-converter.ts       JSON Schema → TypeBox conversion + known wallet schemas
  event-mapper.ts           Eliza EventType → OpenClaw PluginHookName
  config.ts                 Config parsing with ${ENV_VAR} resolution
  eliza-types.ts            Local type definitions (no @elizaos/core dependency)
  logger-adapter.ts         OpenClaw logger → Eliza logger shape
  memory-builder.ts         Memory object construction from OpenClaw contexts
  types.ts                  Adapter config types + NotImplementedError
```

## License

MIT
