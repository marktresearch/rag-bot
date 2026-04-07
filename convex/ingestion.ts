import type { FunctionReference } from "convex/server";
import { v, type Value } from "convex/values";
import {
  action,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  DEFAULT_MATCH_LIMIT,
  EMBEDDING_DIMENSION,
  type JsonMetadata,
} from "../shared/ingestion";
import { EMBEDDING_MODEL_ID, embedTexts } from "./embeddings";
import { rag } from "./ragComponent";
import { api, components, internal } from "./_generated/api";

const syncChunkValidator = v.object({
  text: v.string(),
  order: v.number(),
});

const syncItemValidator = v.object({
  metadata: v.optional(v.record(v.string(), v.any())),
  chunks: v.array(syncChunkValidator),
});

const asyncItemValidator = v.object({
  ingestItemId: v.string(),
  entryKey: v.string(),
  contentHash: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
  chunks: v.array(syncChunkValidator),
});

const ERROR_SAMPLE_LIMIT = 10;
const INGEST_RUN_ID_METADATA_KEY = "__ingestRunId";
const INGEST_ITEM_ID_METADATA_KEY = "__ingestItemId";
const DRIVE_NAMESPACE_METADATA_KEY = "__driveNamespace";
const DRIVE_FILE_ID_METADATA_KEY = "__driveFileId";
const DRIVE_TOTAL_BATCHES_METADATA_KEY = "__driveTotalBatches";
const RESET_PAGE_SIZE = 100;
const internalIngestion = (internal as unknown as {
  ingestion: {
    getPreparedChunks: FunctionReference<
      "query",
      "internal",
      { runId: string; ingestItemId: string },
      Array<{ order: number; text: string }>
    >;
    chunkPreparedEntry: FunctionReference<"action", "internal">;
    handlePreparedEntryComplete: FunctionReference<"mutation", "internal">;
  };
}).ingestion;

function resolveTitle(metadata: JsonMetadata | undefined) {
  return typeof metadata?.title === "string" ? metadata.title : undefined;
}

function resolveEntryKey(metadata: JsonMetadata | undefined) {
  const parts = [
    typeof metadata?.dataset_key === "string" ? metadata.dataset_key : null,
    typeof metadata?.path === "string" ? metadata.path : null,
    typeof metadata?.source_url === "string" ? metadata.source_url : null,
    typeof metadata?.url === "string" ? metadata.url : null,
    typeof metadata?.postId === "string" || typeof metadata?.postId === "number"
      ? String(metadata.postId)
      : null,
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("::");
}

function withIngestTrackingMetadata(
  metadata: JsonMetadata | undefined,
  runId: string,
  ingestItemId: string
): Record<string, Value> {
  return {
    ...toConvexRecord(metadata),
    [INGEST_RUN_ID_METADATA_KEY]: runId,
    [INGEST_ITEM_ID_METADATA_KEY]: ingestItemId,
  };
}

function toConvexValue(value: unknown): Value | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value instanceof ArrayBuffer
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => toConvexValue(item))
      .filter((item): item is Value => item !== undefined);
    return items;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, nestedValue]) => [key, toConvexValue(nestedValue)])
        .filter(([, nestedValue]) => nestedValue !== undefined)
    );
  }

  return undefined;
}

function toConvexRecord(metadata: JsonMetadata | undefined): Record<string, Value> {
  const converted = toConvexValue(metadata);
  if (!converted || Array.isArray(converted) || typeof converted !== "object") {
    return {};
  }
  return converted as Record<string, Value>;
}

function resolveTrackingInfo(metadata: JsonMetadata | undefined) {
  return {
    runId:
      typeof metadata?.[INGEST_RUN_ID_METADATA_KEY] === "string"
        ? (metadata[INGEST_RUN_ID_METADATA_KEY] as string)
        : null,
    ingestItemId:
      typeof metadata?.[INGEST_ITEM_ID_METADATA_KEY] === "string"
        ? (metadata[INGEST_ITEM_ID_METADATA_KEY] as string)
        : null,
  };
}

function resolveDriveQueueInfo(metadata: JsonMetadata | undefined) {
  return {
    namespace:
      typeof metadata?.[DRIVE_NAMESPACE_METADATA_KEY] === "string"
        ? (metadata[DRIVE_NAMESPACE_METADATA_KEY] as string)
        : null,
    fileId:
      typeof metadata?.[DRIVE_FILE_ID_METADATA_KEY] === "string"
        ? (metadata[DRIVE_FILE_ID_METADATA_KEY] as string)
        : null,
    totalBatches:
      typeof metadata?.[DRIVE_TOTAL_BATCHES_METADATA_KEY] === "number"
        ? Math.max(0, Math.trunc(metadata[DRIVE_TOTAL_BATCHES_METADATA_KEY] as number))
        : null,
  };
}

function countTokens(text: string) {
  return text.match(/\S+/g)?.length ?? 0;
}

async function getRunDoc(
  ctx: QueryCtx | MutationCtx,
  runId: string
) {
  return await ctx.db
    .query("ingestionRuns")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}

async function getPayloadDoc(
  ctx: QueryCtx | MutationCtx,
  runId: string,
  ingestItemId: string
) {
  return await ctx.db
    .query("ingestionPayloads")
    .withIndex("by_runId_itemId", (q) =>
      q.eq("runId", runId).eq("ingestItemId", ingestItemId)
    )
    .unique();
}

async function deletePreparedChunks(
  ctx: MutationCtx,
  runId: string,
  ingestItemId: string
) {
  const chunkDocs = await ctx.db
    .query("ingestionPayloadChunks")
    .withIndex("by_runId_itemId_order", (q) =>
      q.eq("runId", runId).eq("ingestItemId", ingestItemId)
    )
    .collect();

  for (const chunkDoc of chunkDocs) {
    await ctx.db.delete(chunkDoc._id);
  }
}

async function finalizePreparedPayload(
  ctx: MutationCtx,
  runId: string,
  ingestItemId: string
) {
  const payload = await getPayloadDoc(ctx, runId, ingestItemId);
  if (!payload) {
    return null;
  }

  await deletePreparedChunks(ctx, runId, ingestItemId);
  return payload;
}

export const getPreparedChunks = internalQuery({
  args: {
    runId: v.string(),
    ingestItemId: v.string(),
  },
  handler: async (ctx, args) => {
    const chunkDocs = await ctx.db
      .query("ingestionPayloadChunks")
      .withIndex("by_runId_itemId_order", (q) =>
        q.eq("runId", args.runId).eq("ingestItemId", args.ingestItemId)
      )
      .collect();

    return chunkDocs.map((chunkDoc) => ({
      order: chunkDoc.order,
      text: chunkDoc.text,
    }));
  },
});

export const chunkPreparedEntry = rag.defineChunkerAction(async (ctx, args) => {
  const { runId, ingestItemId } = resolveTrackingInfo(
    args.entry.metadata as JsonMetadata | undefined
  );

  if (!runId || !ingestItemId) {
    throw new Error("Missing ingest tracking metadata for async chunking.");
  }

  const chunks: Array<{ order: number; text: string }> = await ctx.runQuery(
    internalIngestion.getPreparedChunks,
    {
    runId,
    ingestItemId,
    }
  );

  if (chunks.length === 0) {
    throw new Error(
      `No prepared chunks found for ingest item ${ingestItemId} in run ${runId}.`
    );
  }

  return {
    chunks: chunks.map((chunk) => ({
      text: chunk.text,
      metadata: {
        order: chunk.order,
      },
    })),
  };
});

export const handlePreparedEntryComplete = rag.defineOnComplete(async (ctx, args) => {
  const { runId, ingestItemId } = resolveTrackingInfo(
    args.entry.metadata as JsonMetadata | undefined
  );
  const driveQueueInfo = resolveDriveQueueInfo(
    args.entry.metadata as JsonMetadata | undefined
  );

  if (!runId || !ingestItemId) {
    return;
  }

  const preparedChunks = await ctx.runQuery(internalIngestion.getPreparedChunks, {
    runId,
    ingestItemId,
  });
  const tokenCount = preparedChunks.reduce(
    (total, chunk) => total + countTokens(chunk.text),
    0
  );

  const payload = await finalizePreparedPayload(ctx, runId, ingestItemId);
  if (!payload) {
    return;
  }

  await ctx.db.patch(payload._id, {
    status: args.error ? "failed" : "ready",
    errorMessage: args.error,
    updatedAt: Date.now(),
  });

  if (driveQueueInfo.namespace && driveQueueInfo.fileId) {
    await ctx.runMutation(api.drive.recordQueuedBatchResult, {
      namespace: driveQueueInfo.namespace,
      fileId: driveQueueInfo.fileId,
      batchCount: driveQueueInfo.totalBatches ?? 0,
      chunkCount: payload.chunkCount,
      tokenCount,
      errorMessage: args.error ?? undefined,
    });
  }
});

export const getNamespaceByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await rag.getNamespace(ctx, {
      namespace: args.name,
    });
  },
});

export const getRunProgress = query({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const runDoc = await getRunDoc(ctx, args.runId);
    if (!runDoc) {
      return null;
    }

    const payloads = await ctx.db
      .query("ingestionPayloads")
      .withIndex("by_runId_itemId", (q) => q.eq("runId", args.runId))
      .collect();

    let totalDocuments = 0;
    let readyDocuments = 0;
    let failedDocuments = 0;
    let totalChunks = 0;
    let readyChunks = 0;
    let failedChunks = 0;
    let updatedAt = runDoc.updatedAt;
    const errorSamples: Array<{
      ingestItemId: string;
      entryKey: string;
      message: string;
    }> = [];

    for (const payload of payloads) {
      totalDocuments += 1;
      totalChunks += payload.chunkCount;
      updatedAt = Math.max(updatedAt, payload.updatedAt);

      if (payload.status === "ready") {
        readyDocuments += 1;
        readyChunks += payload.chunkCount;
        continue;
      }

      if (payload.status === "failed") {
        failedDocuments += 1;
        failedChunks += payload.chunkCount;
        if (payload.errorMessage && errorSamples.length < ERROR_SAMPLE_LIMIT) {
          errorSamples.push({
            ingestItemId: payload.ingestItemId,
            entryKey: payload.entryKey,
            message: payload.errorMessage,
          });
        }
      }
    }

    const pendingDocuments = Math.max(0, totalDocuments - readyDocuments - failedDocuments);
    const pendingChunks = Math.max(0, totalChunks - readyChunks - failedChunks);

    return {
      runId: runDoc.runId,
      namespaceName: runDoc.namespaceName,
      totalDocuments,
      readyDocuments,
      failedDocuments,
      pendingDocuments,
      totalChunks,
      readyChunks,
      failedChunks,
      pendingChunks,
      errorSamples,
      startedAt: runDoc.startedAt,
      updatedAt,
      done: pendingDocuments === 0,
      ok: failedDocuments === 0,
    };
  },
});

export const resetNamespace = action({
  args: {
    name: v.string(),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize =
      typeof args.batchSize === "number" && Number.isFinite(args.batchSize) && args.batchSize > 0
        ? Math.trunc(args.batchSize)
        : RESET_PAGE_SIZE;

    const namespaceVersions: Array<{
      namespaceId: string;
      status: "pending" | "ready" | "replaced";
    }> = [];
    let namespaceCursor: string | null = null;

    while (true) {
      const page: {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          namespaceId: string;
          status: "pending" | "ready" | "replaced";
        }>;
      } = await ctx.runQuery(components.rag.namespaces.listNamespaceVersions, {
        namespace: args.name,
        paginationOpts: {
          cursor: namespaceCursor,
          numItems: pageSize,
        },
      });

      namespaceVersions.push(...page.page);

      if (page.isDone) {
        break;
      }

      namespaceCursor = page.continueCursor;
    }

    if (namespaceVersions.length === 0) {
      return {
        namespaceFound: false,
        deletedNamespace: false,
        contentDeleted: 0,
        chunksDeleted: 0,
        vectorsDeleted: 0,
        done: true,
      };
    }

    const statuses = ["pending", "ready", "replaced"] as const;
    let contentDeleted = 0;

    for (const namespace of namespaceVersions) {
      for (const status of statuses) {
        while (true) {
          const entries = await ctx.runQuery(components.rag.entries.list, {
            namespaceId: namespace.namespaceId,
            status,
            paginationOpts: {
              cursor: null,
              numItems: pageSize,
            },
          });

          if (entries.page.length === 0) {
            break;
          }

          for (const entry of entries.page) {
            await ctx.runAction(components.rag.entries.deleteSync, {
              entryId: entry.entryId,
            });
            contentDeleted += 1;
          }
        }
      }
    }

    let deletedNamespace = false;
    for (const namespace of namespaceVersions) {
      try {
        await ctx.runMutation(components.rag.namespaces.deleteNamespace, {
          namespaceId: namespace.namespaceId,
        });
        deletedNamespace = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("cannot delete, has entries")) {
          throw error;
        }
      }
    }

    return {
      namespaceFound: true,
      deletedNamespace,
      contentDeleted,
      chunksDeleted: 0,
      vectorsDeleted: 0,
      done: true,
    };
  },
});

export const enqueueBatch = mutation({
  args: {
    runId: v.string(),
    namespaceName: v.string(),
    items: v.array(asyncItemValidator),
  },
  handler: async (ctx, args) => {
    if (args.items.length === 0) {
      return {
        runId: args.runId,
        namespaceName: args.namespaceName,
        acceptedContent: 0,
        enqueuedContent: 0,
        readyContent: 0,
        acceptedChunks: 0,
        done: true,
      };
    }

    const existingRun = await getRunDoc(ctx, args.runId);
    if (existingRun && existingRun.namespaceName !== args.namespaceName) {
      throw new Error(
        `Run ${args.runId} is already associated with namespace ${existingRun.namespaceName}.`
      );
    }

    const now = Date.now();
    if (!existingRun) {
      await ctx.db.insert("ingestionRuns", {
        runId: args.runId,
        namespaceName: args.namespaceName,
        totalDocuments: 0,
        readyDocuments: 0,
        failedDocuments: 0,
        totalChunks: 0,
        readyChunks: 0,
        failedChunks: 0,
        errorSamples: [],
        startedAt: now,
        updatedAt: now,
      });
    }

    let acceptedChunks = 0;
    let readyContent = 0;
    let readyChunkCount = 0;
    let enqueuedContent = 0;

    for (const item of args.items) {
      acceptedChunks += item.chunks.length;

      const existingPayload = await getPayloadDoc(ctx, args.runId, item.ingestItemId);
      if (existingPayload) {
        await deletePreparedChunks(ctx, args.runId, item.ingestItemId);
        await ctx.db.delete(existingPayload._id);
      }

      const payloadId = await ctx.db.insert("ingestionPayloads", {
        runId: args.runId,
        ingestItemId: item.ingestItemId,
        entryKey: item.entryKey,
        chunkCount: item.chunks.length,
        status: "pending",
        errorMessage: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      for (const chunk of item.chunks) {
        await ctx.db.insert("ingestionPayloadChunks", {
          runId: args.runId,
          ingestItemId: item.ingestItemId,
          order: chunk.order,
          text: chunk.text,
        });
      }

      const result = await rag.addAsync(ctx, {
        namespace: args.namespaceName,
        key: item.entryKey,
        title: resolveTitle(item.metadata),
        metadata: withIngestTrackingMetadata(
          item.metadata,
          args.runId,
          item.ingestItemId
        ),
        contentHash: item.contentHash,
        chunkerAction: internalIngestion.chunkPreparedEntry,
        onComplete: internalIngestion.handlePreparedEntryComplete,
      });

      await ctx.db.patch(payloadId, {
        entryId: result.entryId,
        status: result.status === "ready" ? "ready" : "pending",
        updatedAt: Date.now(),
      });

      if (result.status === "ready") {
        await finalizePreparedPayload(ctx, args.runId, item.ingestItemId);
        readyContent += 1;
        readyChunkCount += item.chunks.length;
        continue;
      }

      enqueuedContent += 1;
    }

    return {
      runId: args.runId,
      namespaceName: args.namespaceName,
      acceptedContent: args.items.length,
      enqueuedContent,
      readyContent,
      acceptedChunks,
      readyChunkCount,
      done: enqueuedContent === 0,
    };
  },
});

export const ingestBatch = action({
  args: {
    namespaceName: v.string(),
    items: v.array(syncItemValidator),
  },
  handler: async (ctx, args) => {
    if (args.items.length === 0) {
      return {
        namespaceName: args.namespaceName,
        insertedContent: 0,
        insertedChunks: 0,
        insertedVectors: 0,
      };
    }

    const allChunkTexts = args.items.flatMap((item) => item.chunks.map((chunk) => chunk.text));
    const embeddings = await embedTexts(allChunkTexts);

    let embeddingOffset = 0;
    let insertedContent = 0;
    let insertedChunks = 0;

    for (const item of args.items) {
      const entryKey = resolveEntryKey(item.metadata);
      const title = resolveTitle(item.metadata);
      const chunkCount = item.chunks.length;
      const itemEmbeddings = embeddings.slice(embeddingOffset, embeddingOffset + chunkCount);
      embeddingOffset += chunkCount;

      await rag.add(ctx, {
        namespace: args.namespaceName,
        key: entryKey,
        title,
        metadata: item.metadata,
        chunks: item.chunks.map((chunk, index) => ({
          text: chunk.text,
          metadata: {
            order: chunk.order,
          },
          embedding:
            itemEmbeddings[index] ?? new Array(EMBEDDING_DIMENSION).fill(0),
        })),
      });

      insertedContent += 1;
      insertedChunks += chunkCount;
    }

    return {
      namespaceName: args.namespaceName,
      insertedContent,
      insertedChunks,
      insertedVectors: insertedChunks,
    };
  },
});

export const getSearchDefaults = query({
  args: {},
  handler: async () => {
    return {
      modelId: EMBEDDING_MODEL_ID,
      dimension: EMBEDDING_DIMENSION,
      defaultLimit: DEFAULT_MATCH_LIMIT,
    };
  },
});
