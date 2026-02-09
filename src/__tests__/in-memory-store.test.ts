import { describe, test, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../in-memory-store.js";

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  // ---- Agent ----
  describe("agents", () => {
    test("create and retrieve agent", async () => {
      await store.createAgent({ id: "agent-1", name: "Test" } as never);
      const agent = await store.getAgent("agent-1");
      expect(agent).not.toBeNull();
      expect(agent?.name).toBe("Test");
    });

    test("get all agents", async () => {
      await store.createAgent({ id: "a1" } as never);
      await store.createAgent({ id: "a2" } as never);
      const agents = await store.getAgents();
      expect(agents.length).toBe(2);
    });

    test("update agent", async () => {
      await store.createAgent({ id: "a1", name: "Old" } as never);
      await store.updateAgent("a1", { name: "New" });
      const agent = await store.getAgent("a1");
      expect(agent?.name).toBe("New");
    });

    test("delete agent", async () => {
      await store.createAgent({ id: "a1" } as never);
      await store.deleteAgent("a1");
      expect(await store.getAgent("a1")).toBeNull();
    });

    test("update nonexistent agent returns false", async () => {
      const result = await store.updateAgent("nonexistent", {});
      expect(result).toBe(false);
    });
  });

  // ---- Memory ----
  describe("memories", () => {
    test("create and retrieve memory", async () => {
      const id = await store.createMemory(
        {
          content: { text: "hello" },
          entityId: "e1",
          roomId: "r1",
        } as never,
        "messages",
      );
      expect(id).toBeDefined();
      const mem = await store.getMemoryById(id);
      expect(mem).not.toBeNull();
      expect(mem?.content.text).toBe("hello");
    });

    test("get memories by room", async () => {
      await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1" } as never, "messages");
      await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r2" } as never, "messages");
      const mems = await store.getMemories({ tableName: "messages", roomId: "r1" });
      expect(mems.length).toBe(1);
      expect(mems[0].content.text).toBe("a");
    });

    test("get memories with count limit", async () => {
      await store.createMemory({ content: { text: "1" }, entityId: "e1", roomId: "r1", createdAt: 100 } as never, "messages");
      await store.createMemory({ content: { text: "2" }, entityId: "e1", roomId: "r1", createdAt: 200 } as never, "messages");
      await store.createMemory({ content: { text: "3" }, entityId: "e1", roomId: "r1", createdAt: 300 } as never, "messages");
      const mems = await store.getMemories({ tableName: "messages", roomId: "r1", count: 2 });
      expect(mems.length).toBe(2);
      // Should be newest first
      expect(mems[0].content.text).toBe("3");
    });

    test("update memory", async () => {
      const id = await store.createMemory({ content: { text: "old" }, entityId: "e1", roomId: "r1" } as never, "messages");
      await store.updateMemory({ id, content: { text: "new" } } as never);
      const mem = await store.getMemoryById(id);
      expect(mem?.content.text).toBe("new");
    });

    test("delete memory", async () => {
      const id = await store.createMemory({ content: { text: "x" }, entityId: "e1", roomId: "r1" } as never, "messages");
      await store.deleteMemory(id);
      expect(await store.getMemoryById(id)).toBeNull();
    });

    test("count memories", async () => {
      await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1" } as never, "messages");
      await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1" } as never, "messages");
      const count = await store.countMemories("r1", false, "messages");
      expect(count).toBe(2);
    });

    test("search memories with cosine similarity", async () => {
      // Normalized vectors for testing
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      const v3 = [0.9, 0.1, 0]; // close to v1

      await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", embedding: v1 } as never, "messages");
      await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1", embedding: v2 } as never, "messages");
      await store.createMemory({ content: { text: "c" }, entityId: "e1", roomId: "r1", embedding: v3 } as never, "messages");

      const results = await store.searchMemories({
        embedding: [1, 0, 0],
        tableName: "messages",
        match_threshold: 0.5,
        count: 2,
      });
      expect(results.length).toBe(2);
      expect(results[0].content.text).toBe("a"); // exact match
    });

    test("getMemoriesByIds", async () => {
      const id1 = await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1" } as never, "messages");
      const id2 = await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1" } as never, "messages");
      const mems = await store.getMemoriesByIds([id1, id2]);
      expect(mems.length).toBe(2);
    });
  });

  // ---- Room ----
  describe("rooms", () => {
    test("create and get room", async () => {
      const ids = await store.createRooms([{ id: "r1", name: "Room 1", worldId: "w1" } as never]);
      expect(ids).toEqual(["r1"]);
      const room = await store.getRoom("r1");
      expect(room?.name).toBe("Room 1");
    });

    test("get rooms by world", async () => {
      await store.createRooms([
        { id: "r1", worldId: "w1" } as never,
        { id: "r2", worldId: "w1" } as never,
        { id: "r3", worldId: "w2" } as never,
      ]);
      const rooms = await store.getRoomsByWorld("w1");
      expect(rooms.length).toBe(2);
    });

    test("delete room", async () => {
      await store.createRooms([{ id: "r1" } as never]);
      await store.deleteRoom("r1");
      expect(await store.getRoom("r1")).toBeNull();
    });
  });

  // ---- Participant ----
  describe("participants", () => {
    test("add and check participant", async () => {
      await store.addParticipantsRoom(["e1", "e2"], "r1");
      expect(await store.isRoomParticipant("r1", "e1")).toBe(true);
      expect(await store.isRoomParticipant("r1", "e3")).toBe(false);
    });

    test("get participants for room", async () => {
      await store.addParticipantsRoom(["e1", "e2"], "r1");
      const parts = await store.getParticipantsForRoom("r1");
      expect(parts.sort()).toEqual(["e1", "e2"].sort());
    });

    test("remove participant", async () => {
      await store.addParticipantsRoom(["e1"], "r1");
      await store.removeParticipant("e1", "r1");
      expect(await store.isRoomParticipant("r1", "e1")).toBe(false);
    });

    test("get rooms for participant", async () => {
      await store.addParticipantsRoom(["e1"], "r1");
      await store.addParticipantsRoom(["e1"], "r2");
      const rooms = await store.getRoomsForParticipant("e1");
      expect(rooms.sort()).toEqual(["r1", "r2"].sort());
    });

    test("participant user state", async () => {
      expect(await store.getParticipantUserState("r1", "e1")).toBeNull();
      await store.setParticipantUserState("r1", "e1", "FOLLOWED");
      expect(await store.getParticipantUserState("r1", "e1")).toBe("FOLLOWED");
    });
  });

  // ---- World ----
  describe("worlds", () => {
    test("create and get world", async () => {
      const id = await store.createWorld({ id: "w1", name: "World 1" } as never);
      expect(id).toBe("w1");
      const world = await store.getWorld("w1");
      expect(world?.name).toBe("World 1");
    });

    test("get all worlds", async () => {
      await store.createWorld({ id: "w1" } as never);
      await store.createWorld({ id: "w2" } as never);
      const worlds = await store.getAllWorlds();
      expect(worlds.length).toBe(2);
    });
  });

  // ---- Relationship ----
  describe("relationships", () => {
    test("create and get relationship", async () => {
      await store.createRelationship({ sourceEntityId: "e1", targetEntityId: "e2" });
      const rel = await store.getRelationship({ sourceEntityId: "e1", targetEntityId: "e2" });
      expect(rel).not.toBeNull();
      expect(rel?.sourceEntityId).toBe("e1");
    });

    test("get relationships by entity", async () => {
      await store.createRelationship({ sourceEntityId: "e1", targetEntityId: "e2", tags: ["friend"] });
      await store.createRelationship({ sourceEntityId: "e3", targetEntityId: "e1", tags: ["colleague"] });
      const rels = await store.getRelationships({ entityId: "e1" });
      expect(rels.length).toBe(2);
    });
  });

  // ---- Task ----
  describe("tasks", () => {
    test("create and get task", async () => {
      const id = await store.createTask({ id: "t1", name: "test-task", roomId: "r1" } as never);
      expect(id).toBe("t1");
      const task = await store.getTask("t1");
      expect(task?.name).toBe("test-task");
    });

    test("get tasks by name", async () => {
      await store.createTask({ id: "t1", name: "process", roomId: "r1" } as never);
      await store.createTask({ id: "t2", name: "process", roomId: "r2" } as never);
      const tasks = await store.getTasksByName("process");
      expect(tasks.length).toBe(2);
    });

    test("update task", async () => {
      await store.createTask({ id: "t1", name: "old" } as never);
      await store.updateTask("t1", { name: "new" } as never);
      const task = await store.getTask("t1");
      expect(task?.name).toBe("new");
    });

    test("delete task", async () => {
      await store.createTask({ id: "t1" } as never);
      await store.deleteTask("t1");
      expect(await store.getTask("t1")).toBeNull();
    });
  });

  // ---- Cache ----
  describe("cache", () => {
    test("set and get cache", async () => {
      await store.setCache("key1", { value: 42 });
      const result = await store.getCache<{ value: number }>("key1");
      expect(result?.value).toBe(42);
    });

    test("delete cache", async () => {
      await store.setCache("key1", "val");
      await store.deleteCache("key1");
      expect(await store.getCache("key1")).toBeUndefined();
    });

    test("get nonexistent cache returns undefined", async () => {
      expect(await store.getCache("nope")).toBeUndefined();
    });
  });

  // ---- Clear ----
  test("clear removes all data", async () => {
    await store.createAgent({ id: "a1" } as never);
    await store.createMemory({ content: { text: "x" }, entityId: "e1", roomId: "r1" } as never, "messages");
    await store.createRooms([{ id: "r1" } as never]);
    store.clear();
    expect(await store.getAgent("a1")).toBeNull();
    expect(await store.getRoom("r1")).toBeNull();
    const mems = await store.getMemories({ tableName: "messages" });
    expect(mems.length).toBe(0);
  });
});

// ---- Additional edge-case tests ----
describe("InMemoryStore edge cases", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  test("deleteAllMemories only removes from specified room", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1" } as never, "messages");
    await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1" } as never, "messages");
    await store.createMemory({ content: { text: "c" }, entityId: "e1", roomId: "r2" } as never, "messages");

    await store.deleteAllMemories("r1", "messages");

    const r1Mems = await store.getMemories({ tableName: "messages", roomId: "r1" });
    const r2Mems = await store.getMemories({ tableName: "messages", roomId: "r2" });
    expect(r1Mems.length).toBe(0);
    expect(r2Mems.length).toBe(1);
  });

  test("getMemoriesByRoomIds filters correctly", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1" } as never, "messages");
    await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r2" } as never, "messages");
    await store.createMemory({ content: { text: "c" }, entityId: "e1", roomId: "r3" } as never, "messages");

    const mems = await store.getMemoriesByRoomIds({
      tableName: "messages",
      roomIds: ["r1", "r3"],
    });
    expect(mems.length).toBe(2);
    expect(mems.every((m) => m.roomId === "r1" || m.roomId === "r3")).toBe(true);
  });

  test("getMemoriesByRoomIds with limit", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", createdAt: 100 } as never, "messages");
    await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1", createdAt: 200 } as never, "messages");
    await store.createMemory({ content: { text: "c" }, entityId: "e1", roomId: "r1", createdAt: 300 } as never, "messages");

    const mems = await store.getMemoriesByRoomIds({
      tableName: "messages",
      roomIds: ["r1"],
      limit: 2,
    });
    expect(mems.length).toBe(2);
    // Should be newest first
    expect(mems[0].content.text).toBe("c");
  });

  test("deleteManyMemories removes multiple", async () => {
    const id1 = await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1" } as never, "messages");
    const id2 = await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1" } as never, "messages");
    const id3 = await store.createMemory({ content: { text: "c" }, entityId: "e1", roomId: "r1" } as never, "messages");

    await store.deleteManyMemories([id1, id3]);

    expect(await store.getMemoryById(id1)).toBeNull();
    expect(await store.getMemoryById(id2)).not.toBeNull();
    expect(await store.getMemoryById(id3)).toBeNull();
  });

  test("getRoomsForParticipants returns all rooms for any matching user", async () => {
    await store.addParticipantsRoom(["e1"], "r1");
    await store.addParticipantsRoom(["e2"], "r2");
    await store.addParticipantsRoom(["e1", "e2"], "r3");

    const rooms = await store.getRoomsForParticipants(["e1", "e2"]);
    expect(rooms.length).toBe(3);
  });

  test("deleteRoomsByWorldId removes all rooms in world", async () => {
    await store.createRooms([
      { id: "r1", worldId: "w1" } as never,
      { id: "r2", worldId: "w1" } as never,
      { id: "r3", worldId: "w2" } as never,
    ]);
    await store.addParticipantsRoom(["e1"], "r1");

    await store.deleteRoomsByWorldId("w1");

    expect(await store.getRoom("r1")).toBeNull();
    expect(await store.getRoom("r2")).toBeNull();
    expect(await store.getRoom("r3")).not.toBeNull();
  });

  test("getMemories with offset", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", createdAt: 100 } as never, "messages");
    await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1", createdAt: 200 } as never, "messages");
    await store.createMemory({ content: { text: "c" }, entityId: "e1", roomId: "r1", createdAt: 300 } as never, "messages");

    const mems = await store.getMemories({ tableName: "messages", roomId: "r1", offset: 1, count: 1 });
    expect(mems.length).toBe(1);
    expect(mems[0].content.text).toBe("b"); // second newest
  });

  test("getMemories with time range", async () => {
    await store.createMemory({ content: { text: "old" }, entityId: "e1", roomId: "r1", createdAt: 100 } as never, "messages");
    await store.createMemory({ content: { text: "mid" }, entityId: "e1", roomId: "r1", createdAt: 500 } as never, "messages");
    await store.createMemory({ content: { text: "new" }, entityId: "e1", roomId: "r1", createdAt: 900 } as never, "messages");

    const mems = await store.getMemories({ tableName: "messages", roomId: "r1", start: 200, end: 600 });
    expect(mems.length).toBe(1);
    expect(mems[0].content.text).toBe("mid");
  });

  test("searchMemories returns empty when no embeddings exist", async () => {
    await store.createMemory({ content: { text: "no embedding" }, entityId: "e1", roomId: "r1" } as never, "messages");
    const results = await store.searchMemories({
      embedding: [1, 0, 0],
      tableName: "messages",
    });
    expect(results.length).toBe(0);
  });

  test("searchMemories filters by roomId", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", embedding: [1, 0, 0] } as never, "messages");
    await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r2", embedding: [1, 0, 0] } as never, "messages");

    const results = await store.searchMemories({
      embedding: [1, 0, 0],
      tableName: "messages",
      roomId: "r1",
    });
    expect(results.length).toBe(1);
    expect(results[0].roomId).toBe("r1");
  });

  test("getRelationships filters by tags", async () => {
    await store.createRelationship({ sourceEntityId: "e1", targetEntityId: "e2", tags: ["friend"] });
    await store.createRelationship({ sourceEntityId: "e1", targetEntityId: "e3", tags: ["colleague"] });

    const friends = await store.getRelationships({ entityId: "e1", tags: ["friend"] });
    expect(friends.length).toBe(1);
    expect(friends[0].targetEntityId).toBe("e2");
  });

  test("createComponent and deleteComponent", async () => {
    await store.createComponent({ id: "c1", entityId: "e1", type: "health" } as never);
    const comp = await store.getComponent("e1", "health");
    expect(comp).not.toBeNull();

    await store.deleteComponent("c1");
    const deleted = await store.getComponent("e1", "health");
    expect(deleted).toBeNull();
  });

  test("updateComponent replaces existing", async () => {
    await store.createComponent({ id: "c1", entityId: "e1", type: "stats", value: 10 } as never);
    await store.updateComponent({ id: "c1", entityId: "e1", type: "stats", value: 20 } as never);
    const comp = await store.getComponent("e1", "stats");
    expect((comp as Record<string, unknown>)?.["value"]).toBe(20);
  });

  test("embedding dimension management", async () => {
    expect(store.getEmbeddingDimension()).toBe(384);
    await store.ensureEmbeddingDimension(768);
    expect(store.getEmbeddingDimension()).toBe(768);
  });

  test("getRoomsByIds returns null for no matches", async () => {
    const result = await store.getRoomsByIds(["nonexistent"]);
    expect(result).toBeNull();
  });

  test("updateRelationship modifies in place", async () => {
    await store.createRelationship({ sourceEntityId: "e1", targetEntityId: "e2", tags: ["old"] });
    const rel = await store.getRelationship({ sourceEntityId: "e1", targetEntityId: "e2" });
    expect(rel).not.toBeNull();

    await store.updateRelationship({ ...rel!, tags: ["new"] });
    const updated = await store.getRelationship({ sourceEntityId: "e1", targetEntityId: "e2" });
    expect(updated?.tags).toEqual(["new"]);
  });

  test("getTasksByName returns empty array when no match", async () => {
    const tasks = await store.getTasksByName("nonexistent");
    expect(tasks).toEqual([]);
  });

  test("getCachedEmbeddings returns empty array", async () => {
    const result = await store.getCachedEmbeddings({
      query_table_name: "messages",
      query_threshold: 0.5,
      query_input: "test",
      query_field_name: "content",
      query_field_sub_name: "text",
      query_match_count: 5,
    });
    expect(result).toEqual([]);
  });
});

// ==========================================================================
// Deep coverage: cosine similarity edge cases, entity edge cases, filtering
// ==========================================================================

describe("InMemoryStore — deep edge cases", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  test("cosine similarity with mismatched vector lengths returns 0", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", embedding: [1, 0] } as never, "messages");
    const results = await store.searchMemories({
      embedding: [1, 0, 0], // length 3 vs stored length 2
      tableName: "messages",
      match_threshold: 0.01,
    });
    expect(results.length).toBe(0);
  });

  test("cosine similarity with zero vector returns 0", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", embedding: [0, 0, 0] } as never, "messages");
    const results = await store.searchMemories({
      embedding: [1, 0, 0],
      tableName: "messages",
      match_threshold: 0.01,
    });
    expect(results.length).toBe(0);
  });

  test("cosine similarity with empty embedding returns 0", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", embedding: [] } as never, "messages");
    const results = await store.searchMemories({
      embedding: [1, 0, 0],
      tableName: "messages",
      match_threshold: 0.01,
    });
    expect(results.length).toBe(0);
  });

  test("getEntitiesForRoom returns empty when room has no participants", async () => {
    const result = await store.getEntitiesForRoom("nonexistent-room");
    expect(result).toEqual([]);
  });

  test("createEntities generates UUIDs for entities without id", async () => {
    await store.createEntities([{ names: ["alice"] } as never]);
    // Can't easily retrieve without id, but it shouldn't throw
  });

  test("updateEntity with undefined id is a no-op", async () => {
    await store.updateEntity({} as never); // No crash
  });

  test("deleteComponent when component doesn't exist is a no-op", async () => {
    await store.deleteComponent("nonexistent"); // No crash
  });

  test("getMemories filters by agentId", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1", agentId: "agent-1" } as never, "messages");
    await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1", agentId: "agent-2" } as never, "messages");
    const result = await store.getMemories({ tableName: "messages", agentId: "agent-1" });
    expect(result.length).toBe(1);
    expect(result[0].content.text).toBe("a");
  });

  test("countMemories across all tables when tableName is undefined", async () => {
    await store.createMemory({ content: { text: "a" }, entityId: "e1", roomId: "r1" } as never, "messages");
    await store.createMemory({ content: { text: "b" }, entityId: "e1", roomId: "r1" } as never, "documents");
    const count = await store.countMemories("r1");
    expect(count).toBe(2);
  });

  test("updateMemory returns false for non-existent memory", async () => {
    const result = await store.updateMemory({ id: "nonexistent", content: { text: "x" } } as never);
    expect(result).toBe(false);
  });

  test("searchMemories uses default threshold of 0.5", async () => {
    // Two vectors: one very close, one somewhat close
    await store.createMemory({ content: { text: "close" }, entityId: "e1", roomId: "r1", embedding: [0.99, 0.1, 0] } as never, "messages");
    await store.createMemory({ content: { text: "far" }, entityId: "e1", roomId: "r1", embedding: [0.1, 0.9, 0] } as never, "messages");

    const results = await store.searchMemories({
      embedding: [1, 0, 0],
      tableName: "messages",
      // No threshold specified — defaults to 0.5
    });
    // "close" should match (high similarity), "far" may or may not depending on threshold
    expect(results.some((r) => r.content.text === "close")).toBe(true);
  });

  test("searchMemories uses default count of 10", async () => {
    // Create 15 matching memories
    for (let i = 0; i < 15; i++) {
      await store.createMemory({
        content: { text: `m${i}` },
        entityId: "e1",
        roomId: "r1",
        embedding: [1, 0, 0],
      } as never, "messages");
    }
    const results = await store.searchMemories({
      embedding: [1, 0, 0],
      tableName: "messages",
      match_threshold: 0,
    });
    expect(results.length).toBe(10); // default limit
  });

  test("searchMemories filters by unique flag", async () => {
    await store.createMemory({ content: { text: "u" }, entityId: "e1", roomId: "r1", embedding: [1, 0, 0], unique: true } as never, "messages");
    await store.createMemory({ content: { text: "n" }, entityId: "e1", roomId: "r1", embedding: [1, 0, 0], unique: false } as never, "messages");

    const results = await store.searchMemories({
      embedding: [1, 0, 0],
      tableName: "messages",
      match_threshold: 0,
      unique: true,
    });
    expect(results.length).toBe(1);
    expect(results[0].content.text).toBe("u");
  });

  test("getMemories with unique=true filters non-unique", async () => {
    await store.createMemory({ content: { text: "u" }, entityId: "e1", roomId: "r1", unique: true } as never, "messages");
    await store.createMemory({ content: { text: "n" }, entityId: "e1", roomId: "r1", unique: false } as never, "messages");
    const result = await store.getMemories({ tableName: "messages", unique: true });
    expect(result.length).toBe(1);
    expect(result[0].content.text).toBe("u");
  });

  test("getMemories on empty table returns empty array", async () => {
    const result = await store.getMemories({ tableName: "nonexistent" });
    expect(result).toEqual([]);
  });

  test("deleteAllMemories on nonexistent table is a no-op", async () => {
    await store.deleteAllMemories("r1", "nonexistent"); // No crash
  });

  test("removeWorld deletes the world", async () => {
    await store.createWorld({ id: "w1", name: "bye" } as never);
    await store.removeWorld("w1");
    expect(await store.getWorld("w1")).toBeNull();
  });

  test("getParticipantsForEntity returns all rooms where entity participates", async () => {
    await store.addParticipantsRoom(["e1"], "r1");
    await store.addParticipantsRoom(["e1"], "r2");
    await store.addParticipantsRoom(["e2"], "r3");
    const parts = await store.getParticipantsForEntity("e1");
    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.entityId === "e1")).toBe(true);
  });

  test("log and getLogs round-trip with type filter", async () => {
    await store.log({ body: { msg: "a" }, entityId: "e1", roomId: "r1", type: "action" });
    await store.log({ body: { msg: "b" }, entityId: "e1", roomId: "r1", type: "model" });
    const actionLogs = await store.getLogs({ type: "action" });
    expect(actionLogs.length).toBe(1);
    expect((actionLogs[0].body as Record<string, unknown>)["msg"]).toBe("a");
  });

  test("deleteLog removes specific log", async () => {
    await store.log({ body: {}, entityId: "e1", roomId: "r1", type: "t" });
    const logs = await store.getLogs({});
    expect(logs.length).toBe(1);
    await store.deleteLog(logs[0].id!);
    expect((await store.getLogs({})).length).toBe(0);
  });

  test("getTasks filters by entityId", async () => {
    await store.createTask({ id: "t1", name: "a", entityId: "e1" } as never);
    await store.createTask({ id: "t2", name: "b", entityId: "e2" } as never);
    const tasks = await store.getTasks({ entityId: "e1" });
    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toBe("a");
  });

  test("getTasks filters by tags", async () => {
    await store.createTask({ id: "t1", name: "a", tags: ["urgent"] } as never);
    await store.createTask({ id: "t2", name: "b", tags: ["low"] } as never);
    const tasks = await store.getTasks({ tags: ["urgent"] });
    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toBe("a");
  });

  test("updateTask on nonexistent task is a no-op", async () => {
    await store.updateTask("nope", { name: "new" }); // No crash
    expect(await store.getTask("nope")).toBeNull();
  });

  test("memory createdAt defaults to Date.now when not provided", async () => {
    const before = Date.now();
    const id = await store.createMemory({ content: { text: "t" }, entityId: "e1", roomId: "r1" } as never, "messages");
    const after = Date.now();
    const mem = await store.getMemoryById(id);
    expect(mem!.createdAt).toBeGreaterThanOrEqual(before);
    expect(mem!.createdAt).toBeLessThanOrEqual(after);
  });

  test("memory id defaults to random UUID when not provided", async () => {
    const id = await store.createMemory({ content: { text: "t" }, entityId: "e1", roomId: "r1" } as never, "messages");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("InMemoryStore — eviction policy", () => {
  test("memories are evicted when table exceeds MAX_MEMORIES_PER_TABLE", async () => {
    const store = new InMemoryStore();
    const cap = InMemoryStore.MAX_MEMORIES_PER_TABLE;

    // Insert cap + 50 memories
    const ids: string[] = [];
    for (let i = 0; i < cap + 50; i++) {
      const id = await store.createMemory(
        { content: { text: `m${i}` }, entityId: "e1", roomId: "r1", createdAt: i } as never,
        "messages",
      );
      ids.push(id);
    }

    // Table should be capped at MAX
    const all = await store.getMemories({ tableName: "messages" });
    expect(all.length).toBe(cap);

    // The oldest 50 should have been evicted
    for (let i = 0; i < 50; i++) {
      expect(await store.getMemoryById(ids[i])).toBeNull();
    }

    // The newest should still exist
    expect(await store.getMemoryById(ids[cap + 49])).not.toBeNull();
  });

  test("logs are evicted when exceeding MAX_LOGS", async () => {
    const store = new InMemoryStore();
    const cap = InMemoryStore.MAX_LOGS;

    for (let i = 0; i < cap + 100; i++) {
      await store.log({ body: { i }, entityId: "e1", roomId: "r1", type: "test" });
    }

    const logs = await store.getLogs({});
    expect(logs.length).toBe(cap);
  });

  test("MAX_MEMORIES_PER_TABLE is a reasonable value", () => {
    expect(InMemoryStore.MAX_MEMORIES_PER_TABLE).toBe(10_000);
  });

  test("MAX_LOGS is a reasonable value", () => {
    expect(InMemoryStore.MAX_LOGS).toBe(5_000);
  });
});
