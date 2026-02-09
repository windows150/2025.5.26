/**
 * Verifies the RuntimeBridge implements every method listed in our
 * IAgentRuntime contract. This catches drift when new methods are added
 * to the interface but not implemented in the bridge.
 */

import { describe, test, expect } from "vitest";
import { RuntimeBridge } from "../runtime-bridge.js";

const REQUIRED_METHODS = [
  // Settings
  "getSetting", "setSetting",
  // Service registry
  "getService", "getServicesByType", "getAllServices", "registerService",
  "getServiceLoadPromise", "getRegisteredServiceTypes", "hasService",
  // Plugin management
  "registerPlugin", "registerProvider", "registerAction", "registerEvaluator",
  "getAllActions", "getFilteredActions", "isActionAllowed",
  // State
  "composeState",
  // Events
  "registerEvent", "getEvent", "emitEvent",
  // Database init
  "init", "initialize", "isReady", "close", "getConnection",
  "ensureEmbeddingDimension",
  // Agent CRUD
  "getAgent", "getAgents", "createAgent", "updateAgent", "deleteAgent",
  // Entity CRUD
  "getEntitiesByIds", "getEntitiesForRoom", "createEntities", "updateEntity",
  // Component CRUD
  "getComponent", "getComponents", "createComponent", "updateComponent", "deleteComponent",
  // Memory CRUD
  "getMemories", "getMemoryById", "getMemoriesByIds", "searchMemories",
  "createMemory", "updateMemory", "deleteMemory", "deleteAllMemories",
  "deleteManyMemories", "countMemories",
  // Room CRUD
  "getRoom", "createRoom", "getRooms", "ensureRoomExists",
  "getRoomsByIds", "createRooms", "deleteRoom", "updateRoom",
  "getRoomsForParticipant", "getRoomsForParticipants", "getRoomsByWorld",
  "deleteRoomsByWorldId",
  // World CRUD
  "createWorld", "getWorld", "getAllWorlds", "updateWorld",
  "ensureWorldExists", "removeWorld",
  // Participant
  "addParticipant", "ensureParticipantInRoom", "getParticipantsForRoom",
  "isRoomParticipant", "addParticipantsRoom", "removeParticipant",
  "getParticipantsForEntity", "getParticipantUserState", "setParticipantUserState",
  // Relationship
  "createRelationship", "getRelationship", "getRelationships", "updateRelationship",
  // Cache
  "getCache", "setCache", "deleteCache",
  // Task
  "createTask", "getTasks", "getTask", "getTasksByName", "updateTask", "deleteTask",
  // Log
  "log", "getLogs", "deleteLog",
  // Convenience wrappers
  "getEntityById", "createEntity", "ensureConnection", "ensureConnections",
  // Lifecycle
  "stop", "redactSecrets",
  // Task workers
  "registerTaskWorker", "getTaskWorker",
  // Run tracking
  "createRunId", "startRun", "endRun", "getCurrentRunId", "getActionResults",
  // Config flags
  "getConversationLength", "isActionPlanningEnabled", "getLLMMode",
  "isCheckShouldRespondEnabled",
  // Model (may throw NotImplementedError but must exist)
  "useModel", "generateText", "registerModel", "getModel",
  // Embedding
  "addEmbeddingToMemory", "queueEmbeddingGeneration",
  // Evaluate
  "evaluatePre",
  // Memory convenience
  "getAllMemories", "clearAllAgentMemories",
  // Send
  "registerSendHandler",
  // Database adapter
  "registerDatabaseAdapter",
  // Cached embeddings
  "getCachedEmbeddings",
  // Room-based memory queries
  "getMemoriesByRoomIds",
];

describe("RuntimeBridge interface completeness", () => {
  const bridge = new RuntimeBridge({
    config: { plugins: [], settings: {}, agentName: "Audit" },
    openclawLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });

  for (const methodName of REQUIRED_METHODS) {
    test(`implements ${methodName}()`, () => {
      const value = (bridge as Record<string, unknown>)[methodName];
      expect(typeof value).toBe("function");
    });
  }

  test(`total required methods verified: ${REQUIRED_METHODS.length}`, () => {
    expect(REQUIRED_METHODS.length).toBeGreaterThan(90);
  });
});
