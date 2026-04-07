import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  datasets: defineTable({
    datasetKey: v.string(),
    name: v.string(),
    namespace: v.string(),
    type: v.string(), // "arxiv" | "drive"
    storageId: v.optional(v.id("_storage")),
    uploadedAt: v.optional(v.number()),
    fileSize: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("ingesting"),
      v.literal("ready"),
      v.literal("failed")
    ),
    processedChunks: v.number(),
    totalChunks: v.number(),
    totalTokens: v.number(),
    avgTokensPerChunk: v.number(),
    totalFiles: v.optional(v.number()),
    lastScanAt: v.optional(v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_datasetKey", ["datasetKey"])
    .index("by_namespace", ["namespace"]),

  userSettings: defineTable({
    userId: v.string(),
    activeNamespace: v.string(),
  }).index("by_userId", ["userId"]),

  chatMessageMetadata: defineTable({
    threadId: v.string(),
    messageId: v.string(),
    route: v.optional(
      v.union(v.literal("dataset_meta"), v.literal("rag"), v.literal("conversation"))
    ),
    matches: v.optional(v.array(v.any())),
    metrics: v.optional(v.any()),
    routingReason: v.optional(v.string()),
  })
    .index("by_messageId", ["messageId"])
    .index("by_thread_message", ["threadId", "messageId"]),

  ingestionRuns: defineTable({
    runId: v.string(),
    namespaceName: v.string(),
    totalDocuments: v.number(),
    readyDocuments: v.number(),
    failedDocuments: v.number(),
    totalChunks: v.number(),
    readyChunks: v.number(),
    failedChunks: v.number(),
    errorSamples: v.array(
      v.object({
        ingestItemId: v.string(),
        entryKey: v.string(),
        message: v.string(),
      })
    ),
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_runId", ["runId"]),

  ingestionPayloads: defineTable({
    runId: v.string(),
    ingestItemId: v.string(),
    entryKey: v.string(),
    chunkCount: v.number(),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
    entryId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_runId_itemId", ["runId", "ingestItemId"]),

  ingestionPayloadChunks: defineTable({
    runId: v.string(),
    ingestItemId: v.string(),
    order: v.number(),
    text: v.string(),
  }).index("by_runId_itemId_order", ["runId", "ingestItemId", "order"]),

  content: defineTable({
    text: v.string(),
    metadata: v.optional(v.record(v.string(), v.any())),
  }),

  chunks: defineTable({
    contentId: v.id("content"),
    text: v.string(),
    order: v.number(),
    embedding: v.optional(v.array(v.number())),
  }),

  queryLogs: defineTable({
    query: v.string(),
    topChunkSimilarity: v.number(),
    responseLength: v.number(),
    responseText: v.string(),
    wasGrounded: v.boolean(),
    breakdown: v.union(
      v.literal("fully_grounded"),
      v.literal("partially_grounded"),
      v.literal("hallucinated")
    ),
    sourcePdf: v.string(),
    timestamp: v.number(),
  }).index("by_timestamp", ["timestamp"]),

  driveConnections: defineTable({
    connectionKey: v.string(),
    accountEmail: v.string(),
    accountName: v.optional(v.string()),
    encryptedRefreshToken: v.string(),
    folderId: v.optional(v.string()),
    folderName: v.optional(v.string()),
    namespace: v.optional(v.string()),
    ingestionEnabled: v.optional(v.boolean()),
    ingestionRequestedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_connectionKey", ["connectionKey"]),

  processedFiles: defineTable({
    namespace: v.string(),
    folderId: v.string(),
    fileId: v.string(),
    fileName: v.string(),
    relativePath: v.optional(v.string()),
    mimeType: v.string(),
    webViewLink: v.optional(v.string()),
    modifiedTime: v.optional(v.string()),
    md5Checksum: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    status: v.union(
      v.literal("processing"),
      v.literal("done"),
      v.literal("completed"),
      v.literal("failed")
    ),
    attempts: v.optional(v.number()),
    tokenCount: v.optional(v.number()),
    indexedTokenCount: v.optional(v.number()),
    retryAfter: v.optional(v.number()),
    claimedByWorkerId: v.optional(v.number()),
    terminalFailure: v.optional(v.boolean()),
    skipReason: v.optional(v.string()),
    expectedChunkCount: v.optional(v.number()),
    chunkCount: v.optional(v.number()),
    indexedChunkCount: v.optional(v.number()),
    batchCount: v.optional(v.number()),
    completedBatchCount: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    lastProcessedAt: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_namespace_fileId", ["namespace", "fileId"])
    .index("by_namespace_status", ["namespace", "status"]),
});
