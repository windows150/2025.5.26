/**
 * Eliza type definitions needed by the adapter.
 *
 * These are the minimal type contracts from @elizaos/core that the adapter
 * depends on. Defining them locally avoids cross-workspace dependency
 * resolution issues while keeping full type safety.
 *
 * These types mirror the corresponding types in eliza/packages/typescript/src/types/.
 * When an actual @elizaos/core package is available at runtime (because the
 * user has installed the Eliza plugins), the runtime objects will satisfy these
 * interfaces because they implement the same contracts.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type UUID = string;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Metadata = Record<string, JsonValue>;

// ---------------------------------------------------------------------------
// Content & Memory
// ---------------------------------------------------------------------------

export interface Content {
  text?: string;
  thought?: string;
  actions?: string[];
  providers?: string[];
  source?: string;
  target?: string;
  [key: string]: unknown;
}

export interface MemoryMetadata {
  type?: string;
  source?: string;
  scope?: "shared" | "private" | "room";
  timestamp?: number;
  [key: string]: unknown;
}

export interface Memory {
  id?: UUID;
  content: Content;
  entityId: UUID;
  agentId?: UUID;
  roomId: UUID;
  worldId?: UUID;
  createdAt?: number;
  embedding?: number[];
  unique?: boolean;
  similarity?: number;
  metadata?: MemoryMetadata;
  sessionId?: string;
  sessionKey?: string;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface Entity {
  id?: UUID;
  names?: string[];
  [key: string]: unknown;
}

export interface Room {
  id?: UUID;
  name?: string;
  worldId?: UUID;
  [key: string]: unknown;
}

export interface World {
  id?: UUID;
  name?: string;
  [key: string]: unknown;
}

export interface Component {
  id?: UUID;
  entityId: UUID;
  type: string;
  worldId?: UUID;
  sourceEntityId?: UUID;
  [key: string]: unknown;
}

export interface Participant {
  id: UUID;
  entityId: UUID;
  roomId: UUID;
  userState?: "FOLLOWED" | "MUTED" | null;
}

export interface Relationship {
  id?: UUID;
  sourceEntityId: UUID;
  targetEntityId: UUID;
  tags?: string[];
  metadata?: Metadata;
}

export interface Agent {
  id?: UUID;
  name?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface Task {
  id?: UUID;
  name?: string;
  roomId?: UUID;
  entityId?: UUID;
  tags?: string[];
  [key: string]: unknown;
}

export interface TaskWorker {
  name: string;
  execute: (
    runtime: IAgentRuntime,
    options: Record<string, unknown>,
    task: Task,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export type LogBody = Record<string, unknown>;

export interface Log {
  id?: UUID;
  body: LogBody;
  entityId: UUID;
  roomId: UUID;
  type: string;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface StateValues {
  agentName?: string;
  actionNames?: string;
  providers?: string;
  [key: string]: unknown;
}

export interface StateData {
  [key: string]: unknown;
}

export interface State {
  values: StateValues;
  data: StateData;
  text?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Components (actions, providers, evaluators)
// ---------------------------------------------------------------------------

export interface ActionParameterSchema {
  type?: string;
  description?: string;
  default?: unknown;
  properties?: Record<string, ActionParameterSchema>;
  items?: ActionParameterSchema;
  enumValues?: string[];
  enum?: string[];
  required?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

export interface ActionParameter {
  name: string;
  description: string;
  required?: boolean;
  schema: ActionParameterSchema;
  examples?: unknown[];
}

export type ActionParameters = Record<string, unknown>;

export type HandlerCallback = (response: Content) => Promise<Memory[]>;

export type Handler = (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State,
  options?: Record<string, unknown>,
  callback?: HandlerCallback,
  responses?: Memory[],
) => Promise<ActionResult | undefined>;

export type Validator = (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State,
) => Promise<boolean>;

export interface Action {
  name: string;
  description: string;
  handler: Handler;
  validate: Validator;
  similes?: string[];
  examples?: unknown[][];
  priority?: number;
  tags?: string[];
  alwaysInclude?: boolean;
  parameters?: ActionParameter[];
}

export interface ActionResult {
  success: boolean;
  text?: string;
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
  error?: string | Error;
  continueChain?: boolean;
  cleanup?: () => void | Promise<void>;
}

export type EvaluatorPhase = "pre" | "post";

export interface Evaluator {
  alwaysRun?: boolean;
  description: string;
  similes?: string[];
  examples: unknown[];
  handler: Handler;
  name: string;
  validate: Validator;
  phase?: EvaluatorPhase;
}

export interface PreEvaluatorResult {
  blocked: boolean;
  rewrittenText?: string;
  reason?: string;
}

export interface ProviderResult {
  text?: string;
  values?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface Provider {
  name: string;
  description?: string;
  dynamic?: boolean;
  position?: number;
  private?: boolean;
  relevanceKeywords?: string[];
  costTier?: "free" | "cheap" | "expensive";
  alwaysRun?: boolean;
  get: (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
  ) => Promise<ProviderResult>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export abstract class Service {
  protected runtime!: IAgentRuntime;
  constructor(runtime?: IAgentRuntime) {
    if (runtime) this.runtime = runtime;
  }
  abstract stop(): Promise<void>;
  static serviceType: string;
  abstract capabilityDescription: string;
  config?: Metadata;
  static async start(_runtime: IAgentRuntime): Promise<Service> {
    throw new Error("Service.start() must be implemented by subclass");
  }
  static stopRuntime?(_runtime: IAgentRuntime): Promise<void>;
  static registerSendHandlers?(runtime: IAgentRuntime, service: Service): void;
}

export interface ServiceClass {
  serviceType: string;
  start(runtime: IAgentRuntime): Promise<Service>;
  stopRuntime?(runtime: IAgentRuntime): Promise<void>;
  registerSendHandlers?(runtime: IAgentRuntime, service: Service): void;
  new (runtime?: IAgentRuntime): Service;
}

export type ServiceTypeName = string;

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

export interface CharacterSettings {
  secrets?: Record<string, string | boolean | number>;
  [key: string]: unknown;
}

export type Character = {
  name?: string;
  settings?: CharacterSettings;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export interface RouteRequest {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  path?: string;
  url?: string;
}

export interface RouteResponse {
  status: (code: number) => RouteResponse;
  json: (data: unknown) => RouteResponse;
  send: (data: unknown) => RouteResponse;
  end: () => RouteResponse;
  setHeader?: (name: string, value: string | string[]) => RouteResponse;
  headersSent?: boolean;
}

export interface Route {
  type: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "STATIC";
  path: string;
  public?: boolean;
  name?: string;
  handler?: (
    req: RouteRequest,
    res: RouteResponse,
    runtime: IAgentRuntime,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventPayload = Record<string, unknown>;
export type EventPayloadMap = Record<string, EventPayload>;
export type EventHandler<_T = string> = (params: EventPayload) => Promise<void>;

export type PluginEvents = {
  [key: string]: ((params: EventPayload) => Promise<void>)[] | undefined;
};

export type RuntimeEventStorage = PluginEvents;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface Plugin {
  name: string;
  description: string;
  init?: (
    config: Record<string, string>,
    runtime: IAgentRuntime,
  ) => Promise<void>;
  config?: Record<string, string | number | boolean | null>;
  services?: ServiceClass[];
  componentTypes?: unknown[];
  actions?: Action[];
  providers?: Provider[];
  evaluators?: Evaluator[];
  adapter?: unknown;
  models?: Record<string, unknown>;
  events?: PluginEvents;
  routes?: Route[];
  tests?: unknown[];
  dependencies?: string[];
  priority?: number;
  schema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Runtime (partial interface — what plugins actually call)
// ---------------------------------------------------------------------------

export interface IAgentRuntime {
  agentId: UUID;
  character: Character;
  enableAutonomy: boolean;
  initPromise: Promise<void>;
  messageService: unknown | null;
  providers: Provider[];
  actions: Action[];
  evaluators: Evaluator[];
  plugins: Plugin[];
  services: Map<ServiceTypeName, Service[]>;
  events: RuntimeEventStorage;
  fetch?: typeof fetch | null;
  routes: Route[];
  logger: Record<string, (...args: unknown[]) => void>;
  stateCache: Map<string, State>;
  db: object;

  // Settings
  getSetting(key: string): string | boolean | number | null;
  setSetting(key: string, value: string | boolean | null, secret?: boolean): void;

  // Services
  getService<T extends Service>(service: ServiceTypeName | string): T | null;
  getServicesByType<T extends Service>(service: ServiceTypeName | string): T[];
  getAllServices(): Map<ServiceTypeName, Service[]>;
  registerService(service: ServiceClass): Promise<void>;
  getServiceLoadPromise(serviceType: ServiceTypeName): Promise<Service>;
  getRegisteredServiceTypes(): ServiceTypeName[];
  hasService(serviceType: ServiceTypeName | string): boolean;

  // Plugin management
  registerPlugin(plugin: Plugin): Promise<void>;
  registerProvider(provider: Provider): void;
  registerAction(action: Action): void;
  registerEvaluator(evaluator: Evaluator): void;
  getAllActions(): Action[];
  getFilteredActions(context?: Record<string, unknown>): Action[];
  isActionAllowed(actionName: string, context?: Record<string, unknown>): { allowed: boolean; reason: string };

  // State
  composeState(message: Memory, includeList?: string[] | null, onlyInclude?: boolean, skipCache?: boolean): Promise<State>;

  // Events
  registerEvent(event: string, handler: (params: EventPayload) => Promise<void>): void;
  getEvent(event: string): ((params: EventPayload) => Promise<void>)[] | undefined;
  emitEvent(event: string | string[], params: EventPayload): Promise<void>;

  // Database operations (subset used by plugins)
  init(): Promise<void>;
  initialize(options?: { skipMigrations?: boolean }): Promise<void>;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
  getConnection(): Promise<object>;
  ensureEmbeddingDimension(dimension: number): Promise<void>;

  getAgent(agentId: UUID): Promise<Agent | null>;
  getAgents(): Promise<Partial<Agent>[]>;
  createAgent(agent: Partial<Agent>): Promise<boolean>;
  updateAgent(agentId: UUID, agent: Partial<Agent>): Promise<boolean>;
  deleteAgent(agentId: UUID): Promise<boolean>;

  getEntitiesByIds(entityIds: UUID[]): Promise<Entity[] | null>;
  getEntitiesForRoom(roomId: UUID, includeComponents?: boolean): Promise<Entity[]>;
  createEntities(entities: Entity[]): Promise<boolean>;
  updateEntity(entity: Entity): Promise<void>;

  getComponent(entityId: UUID, type: string, worldId?: UUID, sourceEntityId?: UUID): Promise<Component | null>;
  getComponents(entityId: UUID, worldId?: UUID, sourceEntityId?: UUID): Promise<Component[]>;
  createComponent(component: Component): Promise<boolean>;
  updateComponent(component: Component): Promise<void>;
  deleteComponent(componentId: UUID): Promise<void>;

  getMemories(params: { entityId?: UUID; agentId?: UUID; count?: number; offset?: number; unique?: boolean; tableName: string; start?: number; end?: number; roomId?: UUID; worldId?: UUID }): Promise<Memory[]>;
  getMemoryById(id: UUID): Promise<Memory | null>;
  getMemoriesByIds(ids: UUID[], tableName?: string): Promise<Memory[]>;
  searchMemories(params: { embedding: number[]; match_threshold?: number; count?: number; unique?: boolean; tableName: string; query?: string; roomId?: UUID; worldId?: UUID; entityId?: UUID }): Promise<Memory[]>;
  createMemory(memory: Memory, tableName: string, unique?: boolean): Promise<UUID>;
  updateMemory(memory: Partial<Memory> & { id: UUID; metadata?: MemoryMetadata }): Promise<boolean>;
  deleteMemory(memoryId: UUID): Promise<void>;
  countMemories(roomId: UUID, unique?: boolean, tableName?: string): Promise<number>;

  getRoom(roomId: UUID): Promise<Room | null>;
  createRoom(room: Room): Promise<UUID>;
  getRooms(worldId: UUID): Promise<Room[]>;
  ensureRoomExists(room: Room): Promise<void>;

  createWorld(world: World): Promise<UUID>;
  getWorld(id: UUID): Promise<World | null>;
  getAllWorlds(): Promise<World[]>;
  updateWorld(world: World): Promise<void>;
  ensureWorldExists(world: World): Promise<void>;

  addParticipant(entityId: UUID, roomId: UUID): Promise<boolean>;
  ensureParticipantInRoom(entityId: UUID, roomId: UUID): Promise<void>;
  getParticipantsForRoom(roomId: UUID): Promise<UUID[]>;
  isRoomParticipant(roomId: UUID, entityId: UUID): Promise<boolean>;

  createRelationship(params: { sourceEntityId: UUID; targetEntityId: UUID; tags?: string[]; metadata?: Metadata }): Promise<boolean>;
  getRelationship(params: { sourceEntityId: UUID; targetEntityId: UUID }): Promise<Relationship | null>;
  getRelationships(params: { entityId: UUID; tags?: string[] }): Promise<Relationship[]>;

  getCache<T>(key: string): Promise<T | undefined>;
  setCache<T>(key: string, value: T): Promise<boolean>;
  deleteCache(key: string): Promise<boolean>;

  createTask(task: Task): Promise<UUID>;
  getTasks(params: { roomId?: UUID; tags?: string[]; entityId?: UUID }): Promise<Task[]>;
  getTask(id: UUID): Promise<Task | null>;
  updateTask(id: UUID, task: Partial<Task>): Promise<void>;
  deleteTask(id: UUID): Promise<void>;

  log(params: { body: LogBody; entityId: UUID; roomId: UUID; type: string }): Promise<void>;
  getLogs(params: { entityId?: UUID; roomId?: UUID; type?: string; count?: number; offset?: number }): Promise<Log[]>;

  // Convenience
  getEntityById(entityId: UUID): Promise<Entity | null>;
  createEntity(entity: Entity): Promise<boolean>;
  ensureConnection(params: Record<string, unknown>): Promise<void>;

  // Lifecycle
  stop(): Promise<void>;
  redactSecrets(text: string): string;

  // Task workers
  registerTaskWorker(taskHandler: TaskWorker): void;
  getTaskWorker(name: string): TaskWorker | undefined;

  // Run tracking
  createRunId(): UUID;
  startRun(roomId?: UUID): UUID;
  endRun(): void;
  getCurrentRunId(): UUID;
  getActionResults(messageId: UUID): ActionResult[];
}

// ---------------------------------------------------------------------------
// OpenClaw types (minimal contracts from openclaw/plugin-sdk)
// ---------------------------------------------------------------------------

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type PluginHookName =
  | "before_agent_start"
  | "agent_end"
  | "before_compaction"
  | "after_compaction"
  | "message_received"
  | "message_sending"
  | "message_sent"
  | "before_tool_call"
  | "after_tool_call"
  | "tool_result_persist"
  | "session_start"
  | "session_end"
  | "gateway_start"
  | "gateway_stop";

export type PluginHookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
};

export type PluginHookBeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

export type PluginHookBeforeAgentStartResult = {
  systemPrompt?: string;
  prependContext?: string;
};

export type PluginHookAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};

export type PluginHookMessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

export type OpenClawPluginServiceContext = {
  config: unknown;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};

export type OpenClawPluginService = {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
};

export type OpenClawPluginApi = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: unknown;
  pluginConfig?: Record<string, unknown>;
  runtime: unknown;
  logger: PluginLogger;
  registerTool: (tool: unknown, opts?: { name?: string; names?: string[]; optional?: boolean }) => void;
  registerHook: (events: string | string[], handler: unknown, opts?: unknown) => void;
  registerHttpHandler: (handler: unknown) => void;
  registerHttpRoute: (params: { path: string; handler: unknown }) => void;
  registerChannel: (registration: unknown) => void;
  registerGatewayMethod: (method: string, handler: unknown) => void;
  registerCli: (registrar: unknown, opts?: { commands?: string[] }) => void;
  registerService: (service: OpenClawPluginService) => void;
  registerProvider: (provider: unknown) => void;
  registerCommand: (command: unknown) => void;
  resolvePath: (input: string) => string;
  on: (hookName: PluginHookName, handler: (...args: never[]) => unknown, opts?: { priority?: number }) => void;
};
