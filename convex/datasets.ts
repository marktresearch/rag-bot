import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { DEFAULT_NAMESPACE, DATASET_KEY } from "../app/lib/dataset-config";

function clampCount(value: number) {
  return Math.max(0, Math.trunc(value));
}

async function getDatasetDocByNamespace(
  ctx: QueryCtx | MutationCtx,
  namespace: string
) {
  return await ctx.db
    .query("datasets")
    .withIndex("by_namespace", (q) => q.eq("namespace", namespace))
    .unique();
}

async function getDatasetDoc(
  ctx: QueryCtx | MutationCtx,
  args: {
    datasetId?: Id<"datasets">;
    namespace?: string;
  }
) {
  if (args.datasetId) {
    return await ctx.db.get(args.datasetId);
  }

  const namespace = args.namespace ?? DEFAULT_NAMESPACE;
  return await getDatasetDocByNamespace(ctx, namespace);
}

type PdfDatasetPatch = {
  datasetKey: string;
  name: string;
  namespace: string;
  type: string;
  uploadedAt: number;
  fileSize?: number;
  status: "pending" | "ingesting" | "ready" | "failed";
  processedChunks: number;
  totalChunks: number;
  totalTokens: number;
  avgTokensPerChunk: number;
  startedAt: number;
  updatedAt: number;
  errorMessage?: string;
};

async function upsertDataset(
  ctx: MutationCtx,
  patch: PdfDatasetPatch
) {
  const existing = await getDatasetDocByNamespace(ctx, patch.namespace);

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }

  return await ctx.db.insert("datasets", {
    ...patch,
    storageId: undefined,
  });
}

export const getDatasetStatus = query({
  args: {
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    return await getDatasetDocByNamespace(ctx, namespace);
  },
});

export const getDatasetById = internalQuery({
  args: {
    datasetId: v.id("datasets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.datasetId);
  },
});

export const generateDatasetUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerDatasetUpload = mutation({
  args: {
    datasetKey: v.optional(v.string()),
    namespace: v.optional(v.string()),
    storageId: v.id("_storage"),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const datasetKey = args.datasetKey ?? DATASET_KEY;
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const now = Date.now();
    const existing = await getDatasetDocByNamespace(ctx, namespace);

    if (existing) {
      await ctx.db.patch(existing._id, {
        datasetKey,
        namespace,
        storageId: args.storageId,
        uploadedAt: now,
        fileSize: typeof args.fileSize === "number" ? clampCount(args.fileSize) : undefined,
        status: "pending",
        processedChunks: 0,
        totalChunks: 0,
        totalTokens: 0,
        avgTokensPerChunk: 0,
        updatedAt: now,
        errorMessage: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("datasets", {
      datasetKey,
      name: `Dataset (${namespace})`,
      namespace,
      type: namespace.startsWith("drive_") ? "drive" : "arxiv",
      storageId: args.storageId,
      uploadedAt: now,
      fileSize: typeof args.fileSize === "number" ? clampCount(args.fileSize) : undefined,
      status: "pending",
      processedChunks: 0,
      totalChunks: 0,
      totalTokens: 0,
      avgTokensPerChunk: 0,
      startedAt: now,
      updatedAt: now,
    });
  },
});

export const getChunkDashboard = query({
  args: {
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDocByNamespace(ctx, namespace);

    return {
      namespace,
      status: dataset?.status ?? "pending",
      totalChunkCount: dataset?.processedChunks ?? 0,
      processedChunks: dataset?.processedChunks ?? 0,
      totalChunks: dataset?.totalChunks ?? 0,
      avgTokensPerChunk: dataset?.avgTokensPerChunk ?? 0,
      updatedAt: dataset?.updatedAt ?? null,
      errorMessage: dataset?.errorMessage ?? null,
    };
  },
});

export const startIngestion = mutation({
  args: {
    namespace: v.optional(v.string()),
    name: v.optional(v.string()),
    type: v.optional(v.string()),
    totalChunks: v.number(),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const type = args.type ?? (namespace.startsWith("drive_") ? "drive" : "arxiv");
    const name = args.name ?? (type === "drive" ? `Drive Folder (${namespace.replace("drive_", "")})` : "arXiv Corpus");
    const now = Date.now();
    const totalChunks = clampCount(args.totalChunks);

    return await upsertDataset(ctx, {
      datasetKey: DATASET_KEY,
      name,
      namespace,
      type,
      uploadedAt: now,
      fileSize: typeof args.fileSize === "number" ? clampCount(args.fileSize) : undefined,
      status: "ingesting",
      processedChunks: 0,
      totalChunks,
      totalTokens: 0,
      avgTokensPerChunk: 0,
      startedAt: now,
      updatedAt: now,
      errorMessage: undefined,
    });
  },
});

// Keep backward-compat alias
export const startPdfIngestion = mutation({
  args: {
    totalChunks: v.number(),
    fileSize: v.optional(v.number()),
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const now = Date.now();
    const totalChunks = clampCount(args.totalChunks);

    return await upsertDataset(ctx, {
      datasetKey: DATASET_KEY,
      name: "arXiv Corpus",
      namespace,
      type: "arxiv",
      uploadedAt: now,
      fileSize: typeof args.fileSize === "number" ? clampCount(args.fileSize) : undefined,
      status: "ingesting",
      processedChunks: 0,
      totalChunks,
      totalTokens: 0,
      avgTokensPerChunk: 0,
      startedAt: now,
      updatedAt: now,
      errorMessage: undefined,
    });
  },
});

export const incrementChunkCount = mutation({
  args: {
    namespace: v.optional(v.string()),
    chunkCount: v.optional(v.number()),
    tokenCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDoc(ctx, { namespace });
    const now = Date.now();
    const chunkCount = Math.max(1, clampCount(args.chunkCount ?? 1));
    const tokenCount = clampCount(args.tokenCount ?? 0);

    if (!dataset) {
      const processedChunks = chunkCount;
      const totalTokens = tokenCount;
      const totalChunks = processedChunks;

      await upsertDataset(ctx, {
        datasetKey: DATASET_KEY,
        name: namespace.startsWith("drive_") ? `Drive Folder (${namespace.replace("drive_", "")})` : "arXiv Corpus",
        namespace,
        type: namespace.startsWith("drive_") ? "drive" : "arxiv",
        uploadedAt: now,
        status: "ingesting",
        processedChunks,
        totalChunks,
        totalTokens,
        avgTokensPerChunk: totalTokens,
        startedAt: now,
        updatedAt: now,
        errorMessage: undefined,
      });

      return {
        processedChunks,
        totalChunks,
        avgTokensPerChunk: totalTokens,
      };
    }

    const processedChunks = dataset.processedChunks + chunkCount;
    const totalTokens = dataset.totalTokens + tokenCount;
    const totalChunks = Math.max(dataset.totalChunks, processedChunks);
    const avgTokensPerChunk =
      processedChunks > 0 ? totalTokens / processedChunks : 0;

    await ctx.db.patch(dataset._id, {
      processedChunks,
      totalChunks,
      totalTokens,
      avgTokensPerChunk,
      status: "ingesting",
      updatedAt: now,
      errorMessage: undefined,
    });

    return {
      processedChunks,
      totalChunks,
      avgTokensPerChunk,
    };
  },
});

export const decrementChunkCount = mutation({
  args: {
    namespace: v.optional(v.string()),
    chunkCount: v.optional(v.number()),
    tokenCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDoc(ctx, { namespace });

    if (!dataset) {
      return {
        processedChunks: 0,
        totalChunks: 0,
        avgTokensPerChunk: 0,
      };
    }

    const now = Date.now();
    const chunkCount = Math.max(0, clampCount(args.chunkCount ?? 0));
    const tokenCount = Math.max(0, clampCount(args.tokenCount ?? 0));
    const processedChunks = Math.max(0, dataset.processedChunks - chunkCount);
    const totalTokens = Math.max(0, dataset.totalTokens - tokenCount);
    const totalChunks = Math.max(0, Math.max(processedChunks, dataset.totalChunks - chunkCount));
    const avgTokensPerChunk =
      processedChunks > 0 ? totalTokens / processedChunks : 0;

    await ctx.db.patch(dataset._id, {
      processedChunks,
      totalChunks,
      totalTokens,
      avgTokensPerChunk,
      updatedAt: now,
    });

    return {
      processedChunks,
      totalChunks,
      avgTokensPerChunk,
    };
  },
});

export const adjustTotalChunks = mutation({
  args: {
    namespace: v.optional(v.string()),
    delta: v.number(),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDoc(ctx, { namespace });

    if (!dataset) {
      return {
        totalChunks: Math.max(0, clampCount(args.delta)),
      };
    }

    const now = Date.now();
    const nextTotalChunks = Math.max(
      dataset.processedChunks,
      dataset.totalChunks + Math.trunc(args.delta)
    );

    await ctx.db.patch(dataset._id, {
      totalChunks: nextTotalChunks,
      status: nextTotalChunks > dataset.processedChunks ? "ingesting" : dataset.status,
      updatedAt: now,
      errorMessage: undefined,
    });

    return {
      totalChunks: nextTotalChunks,
    };
  },
});

export const completeIngestion = mutation({
  args: {
    namespace: v.optional(v.string()),
    processedChunks: v.number(),
    totalChunks: v.optional(v.number()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDoc(ctx, { namespace });
    const now = Date.now();
    const processedChunks = clampCount(args.processedChunks);
    const totalChunks = clampCount(args.totalChunks ?? processedChunks);

    if (!dataset) {
      await upsertDataset(ctx, {
        datasetKey: DATASET_KEY,
        name: namespace.startsWith("drive_") ? `Drive Folder (${namespace.replace("drive_", "")})` : "arXiv Corpus",
        namespace,
        type: namespace.startsWith("drive_") ? "drive" : "arxiv",
        uploadedAt: now,
        fileSize: typeof args.fileSize === "number" ? clampCount(args.fileSize) : undefined,
        status: "ready",
        processedChunks,
        totalChunks,
        totalTokens: 0,
        avgTokensPerChunk: 0,
        startedAt: now,
        updatedAt: now,
        errorMessage: undefined,
      });

      return {
        processedChunks,
        totalChunks,
        status: "ready" as const,
      };
    }

    await ctx.db.patch(dataset._id, {
      fileSize:
        typeof args.fileSize === "number"
          ? clampCount(args.fileSize)
          : dataset.fileSize,
      processedChunks,
      totalChunks,
      status: "ready",
      updatedAt: now,
      errorMessage: undefined,
    });

    return {
      processedChunks,
      totalChunks,
      status: "ready" as const,
    };
  },
});

// Backward compat alias
export const completePdfIngestion = mutation({
  args: {
    processedChunks: v.number(),
    totalChunks: v.optional(v.number()),
    fileSize: v.optional(v.number()),
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDoc(ctx, { namespace });
    const now = Date.now();
    const processedChunks = clampCount(args.processedChunks);
    const totalChunks = clampCount(args.totalChunks ?? processedChunks);

    if (!dataset) {
      await upsertDataset(ctx, {
        datasetKey: DATASET_KEY,
        name: "arXiv Corpus",
        namespace,
        type: "arxiv",
        uploadedAt: now,
        fileSize: typeof args.fileSize === "number" ? clampCount(args.fileSize) : undefined,
        status: "ready",
        processedChunks,
        totalChunks,
        totalTokens: 0,
        avgTokensPerChunk: 0,
        startedAt: now,
        updatedAt: now,
        errorMessage: undefined,
      });

      return {
        processedChunks,
        totalChunks,
        status: "ready" as const,
      };
    }

    await ctx.db.patch(dataset._id, {
      fileSize:
        typeof args.fileSize === "number"
          ? clampCount(args.fileSize)
          : dataset.fileSize,
      processedChunks,
      totalChunks,
      status: "ready",
      updatedAt: now,
      errorMessage: undefined,
    });

    return {
      processedChunks,
      totalChunks,
      status: "ready" as const,
    };
  },
});

export const failIngestion = mutation({
  args: {
    namespace: v.optional(v.string()),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDoc(ctx, { namespace });
    const now = Date.now();

    if (!dataset) {
      return await upsertDataset(ctx, {
        datasetKey: DATASET_KEY,
        name: namespace.startsWith("drive_") ? `Drive Folder (${namespace.replace("drive_", "")})` : "arXiv Corpus",
        namespace,
        type: namespace.startsWith("drive_") ? "drive" : "arxiv",
        uploadedAt: now,
        status: "failed",
        processedChunks: 0,
        totalChunks: 0,
        totalTokens: 0,
        avgTokensPerChunk: 0,
        startedAt: now,
        updatedAt: now,
        errorMessage: args.errorMessage,
      });
    }

    await ctx.db.patch(dataset._id, {
      status: "failed",
      updatedAt: now,
      errorMessage: args.errorMessage,
    });

    return dataset._id;
  },
});

// Backward compat alias
export const failPdfIngestion = mutation({
  args: {
    errorMessage: v.string(),
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const dataset = await getDatasetDoc(ctx, { namespace });
    const now = Date.now();

    if (!dataset) {
      return await upsertDataset(ctx, {
        datasetKey: DATASET_KEY,
        name: "arXiv Corpus",
        namespace,
        type: "arxiv",
        uploadedAt: now,
        status: "failed",
        processedChunks: 0,
        totalChunks: 0,
        totalTokens: 0,
        avgTokensPerChunk: 0,
        startedAt: now,
        updatedAt: now,
        errorMessage: args.errorMessage,
      });
    }

    await ctx.db.patch(dataset._id, {
      status: "failed",
      updatedAt: now,
      errorMessage: args.errorMessage,
    });

    return dataset._id;
  },
});

export const initializeIngestion = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    totalChunks: v.number(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) {
      throw new Error("Dataset record not found.");
    }

    const now = Date.now();

    await ctx.db.patch(dataset._id, {
      status: "ingesting",
      processedChunks: 0,
      totalChunks: clampCount(args.totalChunks),
      totalTokens: 0,
      avgTokensPerChunk: 0,
      startedAt: now,
      updatedAt: now,
      errorMessage: undefined,
    });

    return dataset._id;
  },
});

export const updateProgress = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    processedChunks: v.number(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    const now = Date.now();

    if (!dataset) {
      return null;
    }

    const totalChunks = clampCount(dataset.totalChunks);
    const processedChunks = Math.min(
      totalChunks,
      Math.max(dataset.processedChunks, clampCount(args.processedChunks))
    );
    const status = processedChunks >= totalChunks && totalChunks > 0 ? "ready" : "ingesting";

    await ctx.db.patch(dataset._id, {
      processedChunks,
      totalChunks,
      status,
      updatedAt: now,
      errorMessage: undefined,
    });

    return {
      processedChunks,
      totalChunks,
      status,
    };
  },
});

export const markReady = internalMutation({
  args: {
    datasetId: v.id("datasets"),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(dataset._id, {
      status: "ready",
      processedChunks: dataset.totalChunks,
      updatedAt: now,
      errorMessage: undefined,
    });

    return {
      processedChunks: dataset.totalChunks,
      totalChunks: dataset.totalChunks,
      status: "ready" as const,
    };
  },
});

export const markFailed = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) {
      return null;
    }

    await ctx.db.patch(dataset._id, {
      status: "failed",
      updatedAt: Date.now(),
      errorMessage: args.errorMessage,
    });

    return dataset._id;
  },
});
