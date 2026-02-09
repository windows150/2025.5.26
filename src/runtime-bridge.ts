import { randomUUID } from "node:crypto";
import type {
  Action, ActionResult, Agent, Character, Component, Content, Entity,
  Evaluator, EventPayload, HandlerCallback, IAgentRuntime, JsonValue,
  Log, LogBody, Memory, MemoryMetadata, Metadata, Plugin, PluginLogger,
  PreEvaluatorResult, Provider, ProviderResult, Relationship, Room, Route,
  RuntimeEventStorage, Service, ServiceClass, ServiceTypeName, State,
  StateData, StateValues, Task, TaskWorker, UUID, World,
} from "./eliza-types.js";
import { InMemoryStore } from "./in-memory-store.js";
import { type ElizaCompatLogger, createElizaLogger } from "./logger-adapter.js";
import type { ElizaAdapterConfig } from "./types.js";
import { NotImplementedError } from "./types.js";

export type RuntimeBridgeOptions = { config: ElizaAdapterConfig; openclawLogger: PluginLogger };
type EventHandlerFn = (params: EventPayload) => Promise<void>;

export class RuntimeBridge implements IAgentRuntime {
  readonly agentId: UUID = randomUUID() as UUID;
  readonly character: Character;
  readonly enableAutonomy = false;
  readonly initPromise: Promise<void> = Promise.resolve();

  providers: Provider[] = [];
  actions: Action[] = [];
  evaluators: Evaluator[] = [];
  plugins: Plugin[] = [];
  routes: Route[] = [];
  services = new Map<ServiceTypeName, Service[]>();
  events: RuntimeEventStorage = {};
  fetch: typeof globalThis.fetch | null = globalThis.fetch?.bind(globalThis) ?? null;
  logger: ElizaCompatLogger;
  stateCache = new Map<string, State>();
  messageService: null = null;
  db: object;

  private readonly store: InMemoryStore;
  private readonly settings: Record<string, string | boolean>;
  private readonly taskWorkers = new Map<string, TaskWorker>();
  private currentRunId: UUID = randomUUID() as UUID;
  private actionResultsStore = new Map<UUID, ActionResult[]>();
  private serviceLoadPromises = new Map<ServiceTypeName, { resolve: (s: Service) => void; promise: Promise<Service> }>();

  constructor(opts: RuntimeBridgeOptions) {
    this.settings = { ...opts.config.settings } as Record<string, string | boolean>;
    this.logger = createElizaLogger(opts.openclawLogger);
    this.store = new InMemoryStore();
    this.db = this.store;
    this.character = { name: opts.config.agentName, settings: { secrets: { ...opts.config.settings } } };
  }

  // -- Settings ---------------------------------------------------------------

  getSetting(key: string): string | boolean | number | null {
    const v = this.settings[key];
    if (v !== undefined) return v;
    const secrets = this.character.settings?.secrets;
    if (secrets && key in secrets) return secrets[key] as string | boolean | number;
    const env = process.env[key];
    if (env !== undefined) return env;
    return null;
  }

  setSetting(key: string, value: string | boolean | null): void {
    if (value === null) {
      delete this.settings[key];
      if (this.character.settings?.secrets) delete this.character.settings.secrets[key];
    } else {
      this.settings[key] = value;
    }
  }

  // -- Services ---------------------------------------------------------------

  getService<T extends Service>(svc: ServiceTypeName | string): T | null {
    const list = this.services.get(svc as ServiceTypeName);
    return (list && list.length > 0 ? list[0] : null) as T | null;
  }
  getServicesByType<T extends Service>(svc: ServiceTypeName | string): T[] { return (this.services.get(svc as ServiceTypeName) ?? []) as T[]; }
  getAllServices(): Map<ServiceTypeName, Service[]> { return this.services; }

  async registerService(sc: ServiceClass): Promise<void> {
    this.injectService(sc.serviceType, await sc.start(this));
  }

  injectService(type: string, instance: Service): void {
    const list = this.services.get(type as ServiceTypeName) ?? [];
    list.push(instance);
    this.services.set(type as ServiceTypeName, list);
    const pending = this.serviceLoadPromises.get(type as ServiceTypeName);
    if (pending) { pending.resolve(instance); this.serviceLoadPromises.delete(type as ServiceTypeName); }
  }

  getServiceLoadPromise(type: ServiceTypeName): Promise<Service> {
    const existing = this.services.get(type);
    if (existing && existing.length > 0) return Promise.resolve(existing[0]);
    const pending = this.serviceLoadPromises.get(type);
    if (pending) return pending.promise;
    let resolve!: (s: Service) => void;
    const promise = new Promise<Service>((r) => { resolve = r; });
    this.serviceLoadPromises.set(type, { resolve, promise });
    return promise;
  }

  getRegisteredServiceTypes(): ServiceTypeName[] { return [...this.services.keys()]; }
  hasService(type: ServiceTypeName | string): boolean { const l = this.services.get(type as ServiceTypeName); return l !== undefined && l.length > 0; }

  // -- Plugin registry --------------------------------------------------------

  async registerPlugin(plugin: Plugin): Promise<void> {
    this.plugins.push(plugin);
    if (plugin.actions) this.actions.push(...plugin.actions);
    if (plugin.providers) this.providers.push(...plugin.providers);
    if (plugin.evaluators) this.evaluators.push(...plugin.evaluators);
    if (plugin.routes) this.routes.push(...plugin.routes);
  }

  registerProvider(p: Provider): void { this.providers.push(p); }
  registerAction(a: Action): void { this.actions.push(a); }
  registerEvaluator(e: Evaluator): void { this.evaluators.push(e); }
  getAllActions(): Action[] { return this.actions; }
  getFilteredActions(): Action[] { return this.actions; }
  isActionAllowed(): { allowed: boolean; reason: string } { return { allowed: true, reason: "adapter-mode" }; }

  // -- State ------------------------------------------------------------------

  async composeState(message: Memory, includeList?: string[] | null, _onlyInclude?: boolean, skipCache?: boolean): Promise<State> {
    // Return cached state if available and not skipped
    if (!skipCache && message.id) {
      const cached = this.stateCache.get(message.id);
      if (cached) return cached;
    }

    const values: StateValues = {
      agentName: this.character.name ?? "Eliza",
      actionNames: this.actions.map((a) => a.name).join(", "),
      providers: this.providers.map((p) => p.name).join(", "),
    };
    const data: StateData = {};
    const textParts: string[] = [];

    const baseList = includeList
      ? this.providers.filter((p) => includeList.includes(p.name))
      : this.providers.filter((p) => !p.private && !p.dynamic);
    const alwaysRun = this.providers.filter((p) => p.alwaysRun && !p.private && !baseList.includes(p));

    for (const provider of [...baseList, ...alwaysRun]) {
      let result: ProviderResult | null;
      try { result = await provider.get(this, message, { values, data, text: "" } as State); }
      catch (err) { this.logger.warn(`Provider "${provider.name}" failed: ${err instanceof Error ? err.message : String(err)}`); continue; }
      if (!result) continue;
      if (result.text) textParts.push(result.text);
      if (result.values) Object.assign(values, result.values);
      if (result.data) Object.assign(data, result.data);
    }

    const state = { values, data, text: textParts.join("\n") } as State;

    // Cache by message ID
    if (message.id) this.stateCache.set(message.id, state);

    return state;
  }

  // -- Events -----------------------------------------------------------------

  registerEvent(_event: string, handler: EventHandlerFn): void {
    const list = (this.events as Record<string, EventHandlerFn[]>)[_event] ?? [];
    list.push(handler);
    (this.events as Record<string, EventHandlerFn[]>)[_event] = list;
  }

  getEvent(event: string): EventHandlerFn[] | undefined {
    return (this.events as Record<string, EventHandlerFn[] | undefined>)[event];
  }

  async emitEvent(event: string | string[], params: EventPayload): Promise<void> {
    for (const name of Array.isArray(event) ? event : [event])
      for (const h of this.getEvent(name) ?? []) await h(params);
  }

  // -- Task workers & runs ----------------------------------------------------

  registerTaskWorker(tw: TaskWorker): void { this.taskWorkers.set(tw.name, tw); }
  getTaskWorker(name: string): TaskWorker | undefined { return this.taskWorkers.get(name); }
  createRunId(): UUID { return randomUUID() as UUID; }
  startRun(): UUID { this.currentRunId = randomUUID() as UUID; return this.currentRunId; }
  endRun(): void {}
  getCurrentRunId(): UUID { return this.currentRunId; }
  getActionResults(id: UUID): ActionResult[] { return this.actionResultsStore.get(id) ?? []; }
  storeActionResult(id: UUID, r: ActionResult): void { const l = this.actionResultsStore.get(id) ?? []; l.push(r); this.actionResultsStore.set(id, l); }

  // -- Config flags -----------------------------------------------------------

  getConversationLength(): number { return 0; }
  isActionPlanningEnabled(): boolean { return false; }
  getLLMMode(): "DEFAULT" { return "DEFAULT"; }
  isCheckShouldRespondEnabled(): boolean { return false; }

  // -- Init -------------------------------------------------------------------

  async initialize(): Promise<void> { await this.store.ensureEmbeddingDimension(384); }
  registerDatabaseAdapter(): void {}

  // -- DB delegation ----------------------------------------------------------

  async init(): Promise<void> {}
  async isReady(): Promise<boolean> { return true; }
  async close(): Promise<void> { this.store.clear(); }
  async getConnection(): Promise<object> { return this.store; }
  async ensureEmbeddingDimension(d: number): Promise<void> { await this.store.ensureEmbeddingDimension(d); }

  async getAgent(id: UUID) { return this.store.getAgent(id); }
  async getAgents() { return this.store.getAgents(); }
  async createAgent(a: Partial<Agent>) { return this.store.createAgent(a); }
  async updateAgent(id: UUID, a: Partial<Agent>) { return this.store.updateAgent(id, a); }
  async deleteAgent(id: UUID) { return this.store.deleteAgent(id); }

  async getEntitiesByIds(ids: UUID[]) { return this.store.getEntitiesByIds(ids); }
  async getEntitiesForRoom(id: UUID, inc?: boolean) { return this.store.getEntitiesForRoom(id, inc); }
  async createEntities(e: Entity[]) { return this.store.createEntities(e); }
  async updateEntity(e: Entity) { return this.store.updateEntity(e); }

  async getComponent(eid: UUID, type: string, wid?: UUID, sid?: UUID) { return this.store.getComponent(eid, type, wid, sid); }
  async getComponents(eid: UUID, wid?: UUID, sid?: UUID) { return this.store.getComponents(eid, wid, sid); }
  async createComponent(c: Component) { return this.store.createComponent(c); }
  async updateComponent(c: Component) { return this.store.updateComponent(c); }
  async deleteComponent(id: UUID) { return this.store.deleteComponent(id); }

  async getMemories(p: Parameters<InMemoryStore["getMemories"]>[0]) { return this.store.getMemories(p); }
  async getMemoryById(id: UUID) { return this.store.getMemoryById(id); }
  async getMemoriesByIds(ids: UUID[], t?: string) { return this.store.getMemoriesByIds(ids, t); }
  async getMemoriesByRoomIds(p: Parameters<InMemoryStore["getMemoriesByRoomIds"]>[0]) { return this.store.getMemoriesByRoomIds(p); }
  async getCachedEmbeddings(p: Parameters<InMemoryStore["getCachedEmbeddings"]>[0]) { return this.store.getCachedEmbeddings(p); }
  async searchMemories(p: Parameters<InMemoryStore["searchMemories"]>[0]) { return this.store.searchMemories(p); }
  async createMemory(m: Memory, t: string, u?: boolean) { return this.store.createMemory(m, t, u); }
  async updateMemory(m: Partial<Memory> & { id: UUID; metadata?: MemoryMetadata }) { return this.store.updateMemory(m); }
  async deleteMemory(id: UUID) { return this.store.deleteMemory(id); }
  async deleteManyMemories(ids: UUID[]) { return this.store.deleteManyMemories(ids); }
  async deleteAllMemories(rid: UUID, t: string) { return this.store.deleteAllMemories(rid, t); }
  async countMemories(rid: UUID, u?: boolean, t?: string) { return this.store.countMemories(rid, u, t); }

  async getRoomsByIds(ids: UUID[]) { return this.store.getRoomsByIds(ids); }
  async createRooms(r: Room[]) { return this.store.createRooms(r); }
  async deleteRoom(id: UUID) { return this.store.deleteRoom(id); }
  async deleteRoomsByWorldId(id: UUID) { return this.store.deleteRoomsByWorldId(id); }
  async updateRoom(r: Room) { return this.store.updateRoom(r); }
  async getRoomsForParticipant(id: UUID) { return this.store.getRoomsForParticipant(id); }
  async getRoomsForParticipants(ids: UUID[]) { return this.store.getRoomsForParticipants(ids); }
  async getRoomsByWorld(id: UUID) { return this.store.getRoomsByWorld(id); }

  async removeParticipant(eid: UUID, rid: UUID) { return this.store.removeParticipant(eid, rid); }
  async getParticipantsForEntity(id: UUID) { return this.store.getParticipantsForEntity(id); }
  async getParticipantsForRoom(id: UUID) { return this.store.getParticipantsForRoom(id); }
  async isRoomParticipant(rid: UUID, eid: UUID) { return this.store.isRoomParticipant(rid, eid); }
  async addParticipantsRoom(ids: UUID[], rid: UUID) { return this.store.addParticipantsRoom(ids, rid); }
  async getParticipantUserState(rid: UUID, eid: UUID) { return this.store.getParticipantUserState(rid, eid); }
  async setParticipantUserState(rid: UUID, eid: UUID, s: "FOLLOWED" | "MUTED" | null) { return this.store.setParticipantUserState(rid, eid, s); }

  async createWorld(w: World) { return this.store.createWorld(w); }
  async getWorld(id: UUID) { return this.store.getWorld(id); }
  async removeWorld(id: UUID) { return this.store.removeWorld(id); }
  async getAllWorlds() { return this.store.getAllWorlds(); }
  async updateWorld(w: World) { return this.store.updateWorld(w); }

  async createRelationship(p: Parameters<InMemoryStore["createRelationship"]>[0]) { return this.store.createRelationship(p); }
  async updateRelationship(r: Relationship) { return this.store.updateRelationship(r); }
  async getRelationship(p: Parameters<InMemoryStore["getRelationship"]>[0]) { return this.store.getRelationship(p); }
  async getRelationships(p: Parameters<InMemoryStore["getRelationships"]>[0]) { return this.store.getRelationships(p); }

  async getCache<T>(k: string) { return this.store.getCache<T>(k); }
  async setCache<T>(k: string, v: T) { return this.store.setCache(k, v); }
  async deleteCache(k: string) { return this.store.deleteCache(k); }

  async createTask(t: Task) { return this.store.createTask(t); }
  async getTasks(p: Parameters<InMemoryStore["getTasks"]>[0]) { return this.store.getTasks(p); }
  async getTask(id: UUID) { return this.store.getTask(id); }
  async getTasksByName(n: string) { return this.store.getTasksByName(n); }
  async updateTask(id: UUID, t: Partial<Task>) { return this.store.updateTask(id, t); }
  async deleteTask(id: UUID) { return this.store.deleteTask(id); }

  async log(p: { body: LogBody; entityId: UUID; roomId: UUID; type: string }) { return this.store.log(p); }
  async getLogs(p: Parameters<InMemoryStore["getLogs"]>[0]) { return this.store.getLogs(p); }
  async deleteLog(id: UUID) { return this.store.deleteLog(id); }

  // -- Convenience ------------------------------------------------------------

  async getEntityById(id: UUID): Promise<Entity | null> { const r = await this.store.getEntitiesByIds([id]); return r && r.length > 0 ? r[0] : null; }
  async getRoom(id: UUID): Promise<Room | null> { return this.store.getRoom(id); }
  async createEntity(e: Entity): Promise<boolean> { return this.store.createEntities([e]); }
  async createRoom(r: Room): Promise<UUID> { return (await this.store.createRooms([r]))[0]; }
  async addParticipant(eid: UUID, rid: UUID): Promise<boolean> { return this.store.addParticipantsRoom([eid], rid); }
  async getRooms(wid: UUID): Promise<Room[]> { return this.store.getRoomsByWorld(wid); }

  async ensureParticipantInRoom(eid: UUID, rid: UUID): Promise<void> {
    if (!(await this.store.isRoomParticipant(rid, eid))) await this.store.addParticipantsRoom([eid], rid);
  }
  async ensureWorldExists(w: World): Promise<void> {
    if (!w.id || !(await this.store.getWorld(w.id))) await this.store.createWorld(w);
  }
  async ensureRoomExists(r: Room): Promise<void> {
    if (!r.id || !(await this.store.getRoom(r.id))) await this.store.createRooms([r]);
  }
  async getAllMemories(): Promise<Memory[]> { return this.store.getMemories({ tableName: "messages" }); }
  async clearAllAgentMemories(): Promise<void> { this.store.clear(); }

  redactSecrets(text: string): string {
    let r = text;
    for (const v of Object.values(this.settings)) { if (typeof v === "string" && v.length > 4) r = r.replaceAll(v, "***REDACTED***"); }
    return r;
  }

  // -- Not implemented --------------------------------------------------------

  async useModel(): Promise<string> { throw new NotImplementedError("useModel"); }
  async generateText(): Promise<{ text: string; finishReason: string }> { throw new NotImplementedError("generateText"); }
  async dynamicPromptExecFromState(): Promise<Record<string, unknown> | null> { throw new NotImplementedError("dynamicPromptExecFromState"); }
  async processActions(): Promise<void> { throw new NotImplementedError("processActions"); }
  async evaluate(): Promise<null> { throw new NotImplementedError("evaluate"); }
  async sendMessageToTarget(): Promise<void> { throw new NotImplementedError("sendMessageToTarget"); }
  registerModel(): void {}
  getModel(): undefined { return undefined; }
  async evaluatePre(): Promise<PreEvaluatorResult> { return { blocked: false }; }
  async addEmbeddingToMemory(m: Memory): Promise<Memory> { return m; }
  async queueEmbeddingGeneration(): Promise<void> {}
  registerSendHandler(): void {}

  async ensureConnection(p: { entityId: UUID; roomId: UUID; worldId: UUID; userName?: string; worldName?: string; [k: string]: unknown }): Promise<void> {
    await this.ensureWorldExists({ id: p.worldId, name: p.worldName ?? "default" } as World);
    await this.ensureRoomExists({ id: p.roomId, worldId: p.worldId } as Room);
    if (!(await this.getEntityById(p.entityId))) await this.createEntity({ id: p.entityId, names: [p.userName ?? "unknown"] } as Entity);
    await this.ensureParticipantInRoom(p.entityId, p.roomId);
  }

  async ensureConnections(entities: Entity[], rooms: Room[], _src: string, world: World): Promise<void> {
    await this.ensureWorldExists(world);
    for (const r of rooms) await this.ensureRoomExists(r);
    if (entities.length > 0) await this.createEntities(entities);
  }

  async stop(): Promise<void> {
    for (const [, list] of this.services) for (const svc of list) await svc.stop();
    this.store.clear();
  }
}
