/**
 * In-memory backing store for the RuntimeBridge's IDatabaseAdapter methods.
 *
 * Every collection is a plain Map or array. No persistence. Designed to give
 * Eliza plugins a functional database layer during adapter execution without
 * requiring an actual database connection.
 *
 * Each public method corresponds 1:1 to an IDatabaseAdapter method signature.
 */

import { randomUUID } from "node:crypto";
import type {
  Agent,
  Component,
  Entity,
  Log,
  LogBody,
  Memory,
  MemoryMetadata,
  Participant,
  Relationship,
  Room,
  Task,
  UUID,
  World,
  Metadata,
} from "./eliza-types.js";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class InMemoryStore {
  /** Max memories per table before oldest are evicted. */
  static readonly MAX_MEMORIES_PER_TABLE = 10_000;
  /** Max total log entries before oldest are evicted. */
  static readonly MAX_LOGS = 5_000;

  private agents = new Map<UUID, Agent>();
  private entities = new Map<UUID, Entity>();
  private rooms = new Map<UUID, Room>();
  private worlds = new Map<UUID, World>();
  private components = new Map<string, Component>(); // key: `${entityId}:${type}:${worldId}:${sourceEntityId}`
  private componentsByEntity = new Map<UUID, Component[]>();
  private memories = new Map<string, Memory[]>(); // key: tableName
  private memoriesById = new Map<UUID, Memory>();
  private participants = new Map<UUID, Set<UUID>>(); // roomId -> entityIds
  private participantState = new Map<string, "FOLLOWED" | "MUTED" | null>(); // `${roomId}:${entityId}`
  private relationships: Relationship[] = [];
  private tasks = new Map<UUID, Task>();
  private logs: Log[] = [];
  private cache = new Map<string, unknown>();
  private embeddingDimension = 384;

  // -------------------------------------------------------------------------
  // Agent
  // -------------------------------------------------------------------------

  async getAgent(agentId: UUID): Promise<Agent | null> {
    return this.agents.get(agentId) ?? null;
  }

  async getAgents(): Promise<Partial<Agent>[]> {
    return [...this.agents.values()];
  }

  async createAgent(agent: Partial<Agent>): Promise<boolean> {
    const id = (agent.id as UUID) ?? (randomUUID() as UUID);
    this.agents.set(id, { ...agent, id } as Agent);
    return true;
  }

  async updateAgent(agentId: UUID, agent: Partial<Agent>): Promise<boolean> {
    const existing = this.agents.get(agentId);
    if (!existing) return false;
    this.agents.set(agentId, { ...existing, ...agent, id: agentId });
    return true;
  }

  async deleteAgent(agentId: UUID): Promise<boolean> {
    return this.agents.delete(agentId);
  }

  // -------------------------------------------------------------------------
  // Entity
  // -------------------------------------------------------------------------

  async getEntitiesByIds(entityIds: UUID[]): Promise<Entity[] | null> {
    const result: Entity[] = [];
    for (const id of entityIds) {
      const entity = this.entities.get(id);
      if (entity) result.push(entity);
    }
    return result.length > 0 ? result : null;
  }

  async getEntitiesForRoom(
    roomId: UUID,
    _includeComponents?: boolean,
  ): Promise<Entity[]> {
    const participantIds = this.participants.get(roomId);
    if (!participantIds) return [];
    const result: Entity[] = [];
    for (const id of participantIds) {
      const entity = this.entities.get(id);
      if (entity) result.push(entity);
    }
    return result;
  }

  async createEntities(ents: Entity[]): Promise<boolean> {
    for (const entity of ents) {
      const id = entity.id ?? (randomUUID() as UUID);
      this.entities.set(id, { ...entity, id });
    }
    return true;
  }

  async updateEntity(entity: Entity): Promise<void> {
    if (entity.id) {
      this.entities.set(entity.id, entity);
    }
  }

  // -------------------------------------------------------------------------
  // Component
  // -------------------------------------------------------------------------

  private componentKey(
    entityId: UUID,
    type: string,
    worldId?: UUID,
    sourceEntityId?: UUID,
  ): string {
    return `${entityId}:${type}:${worldId ?? ""}:${sourceEntityId ?? ""}`;
  }

  async getComponent(
    entityId: UUID,
    type: string,
    worldId?: UUID,
    sourceEntityId?: UUID,
  ): Promise<Component | null> {
    return (
      this.components.get(
        this.componentKey(entityId, type, worldId, sourceEntityId),
      ) ?? null
    );
  }

  async getComponents(
    entityId: UUID,
    _worldId?: UUID,
    _sourceEntityId?: UUID,
  ): Promise<Component[]> {
    return this.componentsByEntity.get(entityId) ?? [];
  }

  async createComponent(component: Component): Promise<boolean> {
    const id = component.id ?? (randomUUID() as UUID);
    const full = { ...component, id };
    const key = this.componentKey(
      component.entityId,
      component.type,
      component.worldId,
      component.sourceEntityId,
    );
    this.components.set(key, full);

    const existing = this.componentsByEntity.get(component.entityId) ?? [];
    existing.push(full);
    this.componentsByEntity.set(component.entityId, existing);
    return true;
  }

  async updateComponent(component: Component): Promise<void> {
    const key = this.componentKey(
      component.entityId,
      component.type,
      component.worldId,
      component.sourceEntityId,
    );
    this.components.set(key, component);

    const existing = this.componentsByEntity.get(component.entityId) ?? [];
    const idx = existing.findIndex((c) => c.id === component.id);
    if (idx >= 0) existing[idx] = component;
    else existing.push(component);
    this.componentsByEntity.set(component.entityId, existing);
  }

  async deleteComponent(componentId: UUID): Promise<void> {
    for (const [key, comp] of this.components.entries()) {
      if (comp.id === componentId) {
        this.components.delete(key);
        const entityComps =
          this.componentsByEntity.get(comp.entityId) ?? [];
        const idx = entityComps.findIndex((c) => c.id === componentId);
        if (idx >= 0) entityComps.splice(idx, 1);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  async getMemories(params: {
    entityId?: UUID;
    agentId?: UUID;
    count?: number;
    offset?: number;
    unique?: boolean;
    tableName: string;
    start?: number;
    end?: number;
    roomId?: UUID;
    worldId?: UUID;
  }): Promise<Memory[]> {
    const table = this.memories.get(params.tableName) ?? [];
    let result = table.filter((m) => {
      if (params.entityId && m.entityId !== params.entityId) return false;
      if (params.agentId && m.agentId !== params.agentId) return false;
      if (params.roomId && m.roomId !== params.roomId) return false;
      if (params.worldId && m.worldId !== params.worldId) return false;
      if (params.unique && !m.unique) return false;
      if (params.start && m.createdAt && m.createdAt < params.start)
        return false;
      if (params.end && m.createdAt && m.createdAt > params.end) return false;
      return true;
    });
    // Sort by createdAt descending (newest first)
    result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    if (params.offset) result = result.slice(params.offset);
    if (params.count) result = result.slice(0, params.count);
    return result;
  }

  async getMemoryById(id: UUID): Promise<Memory | null> {
    return this.memoriesById.get(id) ?? null;
  }

  async getMemoriesByIds(ids: UUID[], _tableName?: string): Promise<Memory[]> {
    const result: Memory[] = [];
    for (const id of ids) {
      const mem = this.memoriesById.get(id);
      if (mem) result.push(mem);
    }
    return result;
  }

  async getMemoriesByRoomIds(params: {
    tableName: string;
    roomIds: UUID[];
    limit?: number;
  }): Promise<Memory[]> {
    const table = this.memories.get(params.tableName) ?? [];
    const roomIdSet = new Set(params.roomIds);
    let result = table.filter((m) => roomIdSet.has(m.roomId));
    result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    if (params.limit) result = result.slice(0, params.limit);
    return result;
  }

  async getCachedEmbeddings(_params: {
    query_table_name: string;
    query_threshold: number;
    query_input: string;
    query_field_name: string;
    query_field_sub_name: string;
    query_match_count: number;
  }): Promise<{ embedding: number[]; levenshtein_score: number }[]> {
    // No cached embeddings in memory store
    return [];
  }

  async searchMemories(params: {
    embedding: number[];
    match_threshold?: number;
    count?: number;
    unique?: boolean;
    tableName: string;
    query?: string;
    roomId?: UUID;
    worldId?: UUID;
    entityId?: UUID;
  }): Promise<Memory[]> {
    const table = this.memories.get(params.tableName) ?? [];
    const threshold = params.match_threshold ?? 0.5;
    const limit = params.count ?? 10;

    // Filter memories that have embeddings
    const candidates = table.filter((m) => {
      if (!m.embedding || m.embedding.length === 0) return false;
      if (params.roomId && m.roomId !== params.roomId) return false;
      if (params.worldId && m.worldId !== params.worldId) return false;
      if (params.entityId && m.entityId !== params.entityId) return false;
      if (params.unique && !m.unique) return false;
      return true;
    });

    // Compute cosine similarity
    const scored = candidates
      .map((m) => ({
        memory: m,
        similarity: cosineSimilarity(params.embedding, m.embedding!),
      }))
      .filter((s) => s.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map((s) => ({ ...s.memory, similarity: s.similarity }));
  }

  async createMemory(
    memory: Memory,
    tableName: string,
    _unique?: boolean,
  ): Promise<UUID> {
    const id = memory.id ?? (randomUUID() as UUID);
    const full: Memory = {
      ...memory,
      id,
      createdAt: memory.createdAt ?? Date.now(),
    };
    const table = this.memories.get(tableName) ?? [];
    table.push(full);
    // Evict oldest entries when table exceeds cap
    while (table.length > InMemoryStore.MAX_MEMORIES_PER_TABLE) {
      const evicted = table.shift();
      if (evicted?.id) this.memoriesById.delete(evicted.id);
    }
    this.memories.set(tableName, table);
    this.memoriesById.set(id, full);
    return id;
  }

  async updateMemory(
    memory: Partial<Memory> & { id: UUID; metadata?: MemoryMetadata },
  ): Promise<boolean> {
    const existing = this.memoriesById.get(memory.id);
    if (!existing) return false;
    const updated = { ...existing, ...memory };
    this.memoriesById.set(memory.id, updated);
    // Update in table arrays
    for (const [, table] of this.memories) {
      const idx = table.findIndex((m) => m.id === memory.id);
      if (idx >= 0) {
        table[idx] = updated;
        break;
      }
    }
    return true;
  }

  async deleteMemory(memoryId: UUID): Promise<void> {
    this.memoriesById.delete(memoryId);
    for (const [, table] of this.memories) {
      const idx = table.findIndex((m) => m.id === memoryId);
      if (idx >= 0) {
        table.splice(idx, 1);
        break;
      }
    }
  }

  async deleteManyMemories(memoryIds: UUID[]): Promise<void> {
    for (const id of memoryIds) {
      await this.deleteMemory(id);
    }
  }

  async deleteAllMemories(roomId: UUID, tableName: string): Promise<void> {
    const table = this.memories.get(tableName);
    if (!table) return;
    const remaining = table.filter((m) => m.roomId !== roomId);
    const removed = table.filter((m) => m.roomId === roomId);
    this.memories.set(tableName, remaining);
    for (const m of removed) {
      if (m.id) this.memoriesById.delete(m.id);
    }
  }

  async countMemories(
    roomId: UUID,
    unique?: boolean,
    tableName?: string,
  ): Promise<number> {
    if (tableName) {
      const table = this.memories.get(tableName) ?? [];
      return table.filter((m) => {
        if (m.roomId !== roomId) return false;
        if (unique && !m.unique) return false;
        return true;
      }).length;
    }
    let count = 0;
    for (const [, table] of this.memories) {
      count += table.filter((m) => {
        if (m.roomId !== roomId) return false;
        if (unique && !m.unique) return false;
        return true;
      }).length;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Room
  // -------------------------------------------------------------------------

  async getRoom(roomId: UUID): Promise<Room | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async getRoomsByIds(roomIds: UUID[]): Promise<Room[] | null> {
    const result: Room[] = [];
    for (const id of roomIds) {
      const room = this.rooms.get(id);
      if (room) result.push(room);
    }
    return result.length > 0 ? result : null;
  }

  async createRooms(roomsToCreate: Room[]): Promise<UUID[]> {
    const ids: UUID[] = [];
    for (const room of roomsToCreate) {
      const id = room.id ?? (randomUUID() as UUID);
      this.rooms.set(id, { ...room, id });
      ids.push(id);
    }
    return ids;
  }

  async deleteRoom(roomId: UUID): Promise<void> {
    this.rooms.delete(roomId);
    this.participants.delete(roomId);
  }

  async deleteRoomsByWorldId(worldId: UUID): Promise<void> {
    for (const [id, room] of this.rooms) {
      if (room.worldId === worldId) {
        this.rooms.delete(id);
        this.participants.delete(id);
      }
    }
  }

  async updateRoom(room: Room): Promise<void> {
    if (room.id) this.rooms.set(room.id, room);
  }

  async getRoomsForParticipant(entityId: UUID): Promise<UUID[]> {
    const result: UUID[] = [];
    for (const [roomId, parts] of this.participants) {
      if (parts.has(entityId)) result.push(roomId);
    }
    return result;
  }

  async getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]> {
    const userIdSet = new Set(userIds);
    const result: UUID[] = [];
    for (const [roomId, parts] of this.participants) {
      for (const uid of userIdSet) {
        if (parts.has(uid)) {
          result.push(roomId);
          break;
        }
      }
    }
    return result;
  }

  async getRoomsByWorld(worldId: UUID): Promise<Room[]> {
    const result: Room[] = [];
    for (const room of this.rooms.values()) {
      if (room.worldId === worldId) result.push(room);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Participant
  // -------------------------------------------------------------------------

  async addParticipantsRoom(entityIds: UUID[], roomId: UUID): Promise<boolean> {
    const parts = this.participants.get(roomId) ?? new Set();
    for (const id of entityIds) parts.add(id);
    this.participants.set(roomId, parts);
    return true;
  }

  async removeParticipant(entityId: UUID, roomId: UUID): Promise<boolean> {
    const parts = this.participants.get(roomId);
    if (!parts) return false;
    return parts.delete(entityId);
  }

  async getParticipantsForEntity(entityId: UUID): Promise<Participant[]> {
    const result: Participant[] = [];
    for (const [roomId, parts] of this.participants) {
      if (parts.has(entityId)) {
        result.push({ id: randomUUID() as UUID, entityId, roomId } as Participant);
      }
    }
    return result;
  }

  async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
    const parts = this.participants.get(roomId);
    return parts ? [...parts] : [];
  }

  async isRoomParticipant(roomId: UUID, entityId: UUID): Promise<boolean> {
    return this.participants.get(roomId)?.has(entityId) ?? false;
  }

  async getParticipantUserState(
    roomId: UUID,
    entityId: UUID,
  ): Promise<"FOLLOWED" | "MUTED" | null> {
    return this.participantState.get(`${roomId}:${entityId}`) ?? null;
  }

  async setParticipantUserState(
    roomId: UUID,
    entityId: UUID,
    state: "FOLLOWED" | "MUTED" | null,
  ): Promise<void> {
    this.participantState.set(`${roomId}:${entityId}`, state);
  }

  // -------------------------------------------------------------------------
  // World
  // -------------------------------------------------------------------------

  async createWorld(world: World): Promise<UUID> {
    const id = world.id ?? (randomUUID() as UUID);
    this.worlds.set(id, { ...world, id });
    return id;
  }

  async getWorld(id: UUID): Promise<World | null> {
    return this.worlds.get(id) ?? null;
  }

  async removeWorld(id: UUID): Promise<void> {
    this.worlds.delete(id);
  }

  async getAllWorlds(): Promise<World[]> {
    return [...this.worlds.values()];
  }

  async updateWorld(world: World): Promise<void> {
    if (world.id) this.worlds.set(world.id, world);
  }

  // -------------------------------------------------------------------------
  // Relationship
  // -------------------------------------------------------------------------

  async createRelationship(params: {
    sourceEntityId: UUID;
    targetEntityId: UUID;
    tags?: string[];
    metadata?: Metadata;
  }): Promise<boolean> {
    this.relationships.push({
      id: randomUUID() as UUID,
      sourceEntityId: params.sourceEntityId,
      targetEntityId: params.targetEntityId,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
    } as Relationship);
    return true;
  }

  async updateRelationship(relationship: Relationship): Promise<void> {
    const idx = this.relationships.findIndex((r) => r.id === relationship.id);
    if (idx >= 0) this.relationships[idx] = relationship;
  }

  async getRelationship(params: {
    sourceEntityId: UUID;
    targetEntityId: UUID;
  }): Promise<Relationship | null> {
    return (
      this.relationships.find(
        (r) =>
          r.sourceEntityId === params.sourceEntityId &&
          r.targetEntityId === params.targetEntityId,
      ) ?? null
    );
  }

  async getRelationships(params: {
    entityId: UUID;
    tags?: string[];
  }): Promise<Relationship[]> {
    return this.relationships.filter((r) => {
      if (
        r.sourceEntityId !== params.entityId &&
        r.targetEntityId !== params.entityId
      )
        return false;
      if (params.tags && params.tags.length > 0) {
        const rTags = new Set(r.tags ?? []);
        return params.tags.some((t) => rTags.has(t));
      }
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Task
  // -------------------------------------------------------------------------

  async createTask(task: Task): Promise<UUID> {
    const id = task.id ?? (randomUUID() as UUID);
    this.tasks.set(id, { ...task, id });
    return id;
  }

  async getTasks(params: {
    roomId?: UUID;
    tags?: string[];
    entityId?: UUID;
  }): Promise<Task[]> {
    return [...this.tasks.values()].filter((t) => {
      if (params.roomId && t.roomId !== params.roomId) return false;
      if (params.entityId && t.entityId !== params.entityId) return false;
      if (params.tags && params.tags.length > 0) {
        const tTags = new Set(t.tags ?? []);
        return params.tags.some((tag) => tTags.has(tag));
      }
      return true;
    });
  }

  async getTask(id: UUID): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async getTasksByName(name: string): Promise<Task[]> {
    return [...this.tasks.values()].filter((t) => t.name === name);
  }

  async updateTask(id: UUID, task: Partial<Task>): Promise<void> {
    const existing = this.tasks.get(id);
    if (existing) {
      this.tasks.set(id, { ...existing, ...task, id });
    }
  }

  async deleteTask(id: UUID): Promise<void> {
    this.tasks.delete(id);
  }

  // -------------------------------------------------------------------------
  // Log
  // -------------------------------------------------------------------------

  async log(params: {
    body: LogBody;
    entityId: UUID;
    roomId: UUID;
    type: string;
  }): Promise<void> {
    this.logs.push({
      id: randomUUID() as UUID,
      body: params.body,
      entityId: params.entityId,
      roomId: params.roomId,
      type: params.type,
      createdAt: Date.now(),
    } as Log);
    // Evict oldest logs when cap exceeded
    while (this.logs.length > InMemoryStore.MAX_LOGS) {
      this.logs.shift();
    }
  }

  async getLogs(params: {
    entityId?: UUID;
    roomId?: UUID;
    type?: string;
    count?: number;
    offset?: number;
  }): Promise<Log[]> {
    let result = this.logs.filter((l) => {
      if (params.entityId && l.entityId !== params.entityId) return false;
      if (params.roomId && l.roomId !== params.roomId) return false;
      if (params.type && l.type !== params.type) return false;
      return true;
    });
    if (params.offset) result = result.slice(params.offset);
    if (params.count) result = result.slice(0, params.count);
    return result;
  }

  async deleteLog(logId: UUID): Promise<void> {
    const idx = this.logs.findIndex((l) => l.id === logId);
    if (idx >= 0) this.logs.splice(idx, 1);
  }

  // -------------------------------------------------------------------------
  // Cache
  // -------------------------------------------------------------------------

  async getCache<T>(key: string): Promise<T | undefined> {
    return this.cache.get(key) as T | undefined;
  }

  async setCache<T>(key: string, value: T): Promise<boolean> {
    this.cache.set(key, value);
    return true;
  }

  async deleteCache(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  // -------------------------------------------------------------------------
  // Embedding dimension
  // -------------------------------------------------------------------------

  async ensureEmbeddingDimension(dimension: number): Promise<void> {
    this.embeddingDimension = dimension;
  }

  getEmbeddingDimension(): number {
    return this.embeddingDimension;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  clear(): void {
    this.agents.clear();
    this.entities.clear();
    this.rooms.clear();
    this.worlds.clear();
    this.components.clear();
    this.componentsByEntity.clear();
    this.memories.clear();
    this.memoriesById.clear();
    this.participants.clear();
    this.participantState.clear();
    this.relationships.length = 0;
    this.tasks.clear();
    this.logs.length = 0;
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Cosine similarity (for searchMemories)
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
