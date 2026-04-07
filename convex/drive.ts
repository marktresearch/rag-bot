import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { DATASET_KEY } from "../app/lib/dataset-config";

const DEFAULT_DRIVE_CONNECTION_KEY = "default";
const PROCESSING_CLAIM_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const FAILED_RETRY_COOLDOWN_MS = 60 * 1000;

type DriveDatasetStatus = "pending" | "ingesting" | "ready" | "failed";
type ProcessedFileStatus = "processing" | "done" | "completed" | "failed";

async function getDatasetByNamespace(
  ctx: QueryCtx | MutationCtx,
  namespace: string
) {
  return await ctx.db
    .query("datasets")
    .withIndex("by_namespace", (q) => q.eq("namespace", namespace))
    .unique();
}

async function getDriveConnectionDoc(
  ctx: QueryCtx | MutationCtx,
  connectionKey = DEFAULT_DRIVE_CONNECTION_KEY
) {
  return await ctx.db
    .query("driveConnections")
    .withIndex("by_connectionKey", (q) => q.eq("connectionKey", connectionKey))
    .unique();
}

async function getProcessedFileDoc(
  ctx: QueryCtx | MutationCtx,
  namespace: string,
  fileId: string
) {
  return await ctx.db
    .query("processedFiles")
    .withIndex("by_namespace_fileId", (q) =>
      q.eq("namespace", namespace).eq("fileId", fileId)
    )
    .unique();
}

function clampCount(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.trunc(value));
}

function isSuccessfulFileStatus(status: ProcessedFileStatus | undefined) {
  return status === "done" || status === "completed";
}

function getProcessedFileUpdatedAt(
  doc: Doc<"processedFiles"> | null | undefined
) {
  return doc?.updatedAt ?? doc?.lastProcessedAt ?? 0;
}

function getProcessedFileAttempts(
  doc: Doc<"processedFiles"> | null | undefined
) {
  const attempts = clampCount(doc?.attempts);
  return typeof attempts === "number" ? attempts : 0;
}

function calculateProgressPct(completed: number, total: number) {
  if (total <= 0) {
    return null;
  }

  if (completed >= total) {
    return 100;
  }

  return Math.max(0, Math.min(99, Math.floor((completed / total) * 100)));
}

async function upsertDriveDataset(
  ctx: MutationCtx,
  args: {
    namespace: string;
    folderId: string;
    folderName?: string;
    status: DriveDatasetStatus;
    totalFiles?: number;
    lastScanAt?: number;
    errorMessage?: string;
  }
) {
  const now = Date.now();
  const name = args.folderName?.trim() || `Drive Folder (${args.folderId})`;
  const existing = await getDatasetByNamespace(ctx, args.namespace);
  const totalFiles = clampCount(args.totalFiles);
  const lastScanAt = clampCount(args.lastScanAt);
  const scanPatch = {
    ...(typeof totalFiles === "number" ? { totalFiles } : {}),
    ...(typeof lastScanAt === "number" ? { lastScanAt } : {}),
  };

  if (existing) {
    await ctx.db.patch(existing._id, {
      name,
      type: "drive",
      status: args.status,
      ...scanPatch,
      updatedAt: now,
      errorMessage:
        args.status === "failed" ? args.errorMessage ?? "Drive worker failed" : undefined,
    });
    return existing._id;
  }

  return await ctx.db.insert("datasets", {
    datasetKey: DATASET_KEY,
    name,
    namespace: args.namespace,
    type: "drive",
    uploadedAt: now,
    fileSize: undefined,
    status: args.status,
    processedChunks: 0,
    totalChunks: 0,
    totalTokens: 0,
    avgTokensPerChunk: 0,
    ...scanPatch,
    startedAt: now,
    updatedAt: now,
    errorMessage:
      args.status === "failed" ? args.errorMessage ?? "Drive worker failed" : undefined,
  });
}

function serializeProcessedFileState(doc: Doc<"processedFiles">) {
  return {
    fileId: doc.fileId,
    status: doc.status,
    lastProcessedAt: doc.lastProcessedAt,
    updatedAt: getProcessedFileUpdatedAt(doc),
    attempts: getProcessedFileAttempts(doc),
    retryAfter: doc.retryAfter ?? null,
    terminalFailure: doc.terminalFailure ?? false,
    claimedByWorkerId: doc.claimedByWorkerId ?? null,
    tokenCount: doc.tokenCount ?? 0,
    indexedTokenCount: doc.indexedTokenCount ?? doc.tokenCount ?? 0,
    chunkCount: doc.chunkCount ?? 0,
    indexedChunkCount: doc.indexedChunkCount ?? doc.chunkCount ?? 0,
    batchCount: doc.batchCount ?? 0,
    completedBatchCount: doc.completedBatchCount ?? 0,
    expectedChunkCount: doc.expectedChunkCount ?? 0,
    skipReason: doc.skipReason ?? null,
  };
}

export const ensureDriveDataset = mutation({
  args: {
    folderId: v.string(),
    folderName: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("ingesting"),
        v.literal("ready"),
        v.literal("failed")
      )
    ),
    totalFiles: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespace = `drive_${args.folderId}`;
    const totalFiles = clampCount(args.totalFiles);
    await upsertDriveDataset(ctx, {
      namespace,
      folderId: args.folderId,
      folderName: args.folderName,
      status: args.status ?? "ingesting",
      totalFiles,
      lastScanAt: typeof totalFiles === "number" ? Date.now() : undefined,
      errorMessage: args.errorMessage,
    });

    return { namespace };
  },
});

export const getDriveConnectionStatus = query({
  args: {
    connectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await getDriveConnectionDoc(
      ctx,
      args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY
    );

    if (!connection) {
      return {
        connected: false,
        accountEmail: null,
        accountName: null,
        folderId: null,
        folderName: null,
        namespace: null,
        ingestionEnabled: false,
        ingestionRequestedAt: null,
        updatedAt: null,
      };
    }

    return {
      connected: true,
      accountEmail: connection.accountEmail,
      accountName: connection.accountName ?? null,
      folderId: connection.folderId ?? null,
      folderName: connection.folderName ?? null,
      namespace: connection.namespace ?? null,
      ingestionEnabled: connection.ingestionEnabled ?? false,
      ingestionRequestedAt: connection.ingestionRequestedAt ?? null,
      updatedAt: connection.updatedAt,
    };
  },
});

export const getDriveIngestionProgress = query({
  args: {
    namespace: v.string(),
  },
  handler: async (ctx, args) => {
    const [dataset, processedFiles] = await Promise.all([
      getDatasetByNamespace(ctx, args.namespace),
      ctx.db
        .query("processedFiles")
        .withIndex("by_namespace_fileId", (q) => q.eq("namespace", args.namespace))
        .collect(),
    ]);

    let completedFiles = 0;
    let processingFiles = 0;
    let failedFiles = 0;
    let retryableFailedFiles = 0;
    let terminalFailedFiles = 0;

    for (const file of processedFiles) {
      if (isSuccessfulFileStatus(file.status)) {
        completedFiles += 1;
        continue;
      }

      if (file.status === "processing") {
        processingFiles += 1;
        continue;
      }

      failedFiles += 1;
      if (file.terminalFailure) {
        terminalFailedFiles += 1;
      } else {
        retryableFailedFiles += 1;
      }
    }

    const totalFiles = Math.max(dataset?.totalFiles ?? 0, processedFiles.length);
    const resolvedFiles = completedFiles + terminalFailedFiles;
    const remainingFiles = Math.max(0, totalFiles - resolvedFiles);
    const progressPct = calculateProgressPct(resolvedFiles, totalFiles);

    return {
      namespace: args.namespace,
      totalFiles,
      completedFiles,
      processingFiles,
      failedFiles,
      retryableFailedFiles,
      terminalFailedFiles,
      remainingFiles,
      progressPct,
      lastScanAt: dataset?.lastScanAt ?? null,
      updatedAt: dataset?.updatedAt ?? null,
      status: dataset?.status ?? "pending",
    };
  },
});

export const getWorkerConfiguration = query({
  args: {
    connectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await getDriveConnectionDoc(
      ctx,
      args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY
    );

    if (
      !connection ||
      !connection.folderId ||
      !connection.namespace ||
      !connection.ingestionEnabled
    ) {
      return null;
    }

    return {
      connectionKey: connection.connectionKey,
      accountEmail: connection.accountEmail,
      accountName: connection.accountName ?? null,
      encryptedRefreshToken: connection.encryptedRefreshToken,
      folderId: connection.folderId,
      folderName: connection.folderName ?? null,
      namespace: connection.namespace,
      updatedAt: connection.updatedAt,
    };
  },
});

export const getDriveConnectionAuth = query({
  args: {
    connectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await getDriveConnectionDoc(
      ctx,
      args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY
    );

    if (!connection) {
      return null;
    }

    return {
      connectionKey: connection.connectionKey,
      accountEmail: connection.accountEmail,
      accountName: connection.accountName ?? null,
      encryptedRefreshToken: connection.encryptedRefreshToken,
      folderId: connection.folderId ?? null,
      folderName: connection.folderName ?? null,
      namespace: connection.namespace ?? null,
      updatedAt: connection.updatedAt,
    };
  },
});

export const saveDriveConnection = mutation({
  args: {
    connectionKey: v.optional(v.string()),
    accountEmail: v.string(),
    accountName: v.optional(v.string()),
    encryptedRefreshToken: v.string(),
  },
  handler: async (ctx, args) => {
    const connectionKey = args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY;
    const now = Date.now();
    const existing = await getDriveConnectionDoc(ctx, connectionKey);

    const patch = {
      connectionKey,
      accountEmail: args.accountEmail,
      accountName: args.accountName,
      encryptedRefreshToken: args.encryptedRefreshToken,
      folderId: undefined,
      folderName: undefined,
      namespace: undefined,
      ingestionEnabled: false,
      ingestionRequestedAt: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("driveConnections", {
      ...patch,
      createdAt: now,
    });
  },
});

export const selectDriveFolder = mutation({
  args: {
    connectionKey: v.optional(v.string()),
    folderId: v.string(),
    folderName: v.string(),
  },
  handler: async (ctx, args) => {
    const connectionKey = args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY;
    const connection = await getDriveConnectionDoc(ctx, connectionKey);
    if (!connection) {
      throw new Error("Google Drive is not connected.");
    }

    const namespace = `drive_${args.folderId}`;
    const now = Date.now();

    await ctx.db.patch(connection._id, {
      folderId: args.folderId,
      folderName: args.folderName,
      namespace,
      ingestionEnabled: false,
      ingestionRequestedAt: undefined,
      updatedAt: now,
    });

    await upsertDriveDataset(ctx, {
      namespace,
      folderId: args.folderId,
      folderName: args.folderName,
      status: "pending",
    });

    const existingSettings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", "local-demo-user"))
      .unique();

    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, {
        activeNamespace: namespace,
      });
    } else {
      await ctx.db.insert("userSettings", {
        userId: "local-demo-user",
        activeNamespace: namespace,
      });
    }

    return {
      namespace,
      folderId: args.folderId,
      folderName: args.folderName,
    };
  },
});

export const requestDriveIngestionStart = mutation({
  args: {
    connectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await getDriveConnectionDoc(
      ctx,
      args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY
    );

    if (!connection) {
      throw new Error("Google Drive is not connected.");
    }

    if (!connection.folderId || !connection.folderName || !connection.namespace) {
      throw new Error("Choose a Google Drive folder before starting ingestion.");
    }

    const now = Date.now();
    await ctx.db.patch(connection._id, {
      ingestionEnabled: true,
      ingestionRequestedAt: now,
      updatedAt: now,
    });

    await upsertDriveDataset(ctx, {
      namespace: connection.namespace,
      folderId: connection.folderId,
      folderName: connection.folderName,
      status: "pending",
    });

    return {
      folderId: connection.folderId,
      folderName: connection.folderName,
      namespace: connection.namespace,
      ingestionEnabled: true,
      ingestionRequestedAt: now,
    };
  },
});

export const pauseDriveIngestion = mutation({
  args: {
    connectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await getDriveConnectionDoc(
      ctx,
      args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY
    );

    if (!connection) {
      return {
        paused: false,
      };
    }

    await ctx.db.patch(connection._id, {
      ingestionEnabled: false,
      ingestionRequestedAt: undefined,
      updatedAt: Date.now(),
    });

    return {
      paused: true,
      namespace: connection.namespace ?? null,
    };
  },
});

export const clearDriveConnection = mutation({
  args: {
    connectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await getDriveConnectionDoc(
      ctx,
      args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY
    );

    if (!connection) {
      return { cleared: false };
    }

    await ctx.db.delete(connection._id);
    return { cleared: true };
  },
});

export const resetDriveProcessingState = mutation({
  args: {
    namespace: v.string(),
    connectionKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("processedFiles")
      .withIndex("by_namespace_fileId", (q) => q.eq("namespace", args.namespace))
      .collect();

    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }

    const connection = await getDriveConnectionDoc(
      ctx,
      args.connectionKey ?? DEFAULT_DRIVE_CONNECTION_KEY
    );

    if (connection?.namespace === args.namespace) {
      await ctx.db.patch(connection._id, {
        ingestionEnabled: false,
        ingestionRequestedAt: undefined,
        updatedAt: Date.now(),
      });
    }

    return {
      namespace: args.namespace,
      deletedProcessedFiles: docs.length,
    };
  },
});

export const getProcessedFileStates = query({
  args: {
    namespace: v.string(),
    fileIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const states = await Promise.all(
      args.fileIds.map(async (fileId) => {
        const doc = await getProcessedFileDoc(ctx, args.namespace, fileId);
        if (!doc) {
          return null;
        }

        return serializeProcessedFileState(doc);
      })
    );

    return states.filter((state) => state !== null);
  },
});

export const listProcessedFileStates = query({
  args: {
    namespace: v.string(),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("processedFiles")
      .withIndex("by_namespace_fileId", (q) => q.eq("namespace", args.namespace))
      .collect();

    return docs.map((doc) => serializeProcessedFileState(doc));
  },
});

async function applyProcessedFileDeltaToDataset(
  ctx: MutationCtx,
  args: {
    namespace: string;
    chunkDelta: number;
    tokenDelta: number;
  }
) {
  const dataset = await getDatasetByNamespace(ctx, args.namespace);
  if (!dataset) {
    return null;
  }

  const processedChunks = Math.max(0, dataset.processedChunks + args.chunkDelta);
  const totalChunks = Math.max(processedChunks, dataset.totalChunks + args.chunkDelta);
  const totalTokens = Math.max(0, dataset.totalTokens + args.tokenDelta);
  const avgTokensPerChunk = processedChunks > 0 ? totalTokens / processedChunks : 0;

  await ctx.db.patch(dataset._id, {
    processedChunks,
    totalChunks,
    totalTokens,
    avgTokensPerChunk,
    status: processedChunks >= totalChunks && totalChunks > 0 ? "ready" : "ingesting",
    updatedAt: Date.now(),
    errorMessage: undefined,
  });

  return {
    processedChunks,
    totalChunks,
    totalTokens,
    avgTokensPerChunk,
  };
}

export const claimFileForProcessing = mutation({
  args: {
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
    workerId: v.number(),
    maxRetries: v.number(),
    claimTimeoutMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);
    const attempts = getProcessedFileAttempts(existing);
    const maxRetries = Math.max(1, Math.trunc(args.maxRetries));
    const claimTimeoutMs = Math.max(1_000, Math.trunc(args.claimTimeoutMs));

    if (existing && isSuccessfulFileStatus(existing.status)) {
      return {
        claimed: false,
        reason: "already_done" as const,
        attempts,
        previousBatchCount: existing.batchCount ?? 0,
        previousChunkCount: existing.chunkCount ?? 0,
      };
    }

    if (
      existing?.status === "processing" &&
      now - getProcessedFileUpdatedAt(existing) < claimTimeoutMs
    ) {
      return {
        claimed: false,
        reason: "already_processing" as const,
        attempts,
        previousBatchCount: existing.batchCount ?? 0,
        previousChunkCount: existing.chunkCount ?? 0,
      };
    }

    if (existing?.status === "failed") {
      if (existing.terminalFailure || attempts >= maxRetries) {
        return {
          claimed: false,
          reason: "max_retries_exhausted" as const,
          attempts,
          previousBatchCount: existing.batchCount ?? 0,
          previousChunkCount: existing.chunkCount ?? 0,
        };
      }

      if (typeof existing.retryAfter === "number" && existing.retryAfter > now) {
        return {
          claimed: false,
          reason: "retry_backoff" as const,
          attempts,
          previousBatchCount: existing.batchCount ?? 0,
          previousChunkCount: existing.chunkCount ?? 0,
        };
      }
    }

    const nextAttempts = attempts + 1;
    const patch = {
      folderId: args.folderId,
      fileId: args.fileId,
      fileName: args.fileName,
      relativePath: args.relativePath,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      modifiedTime: args.modifiedTime,
      md5Checksum: args.md5Checksum,
      sizeBytes: clampCount(args.sizeBytes),
      status: "processing" as const,
      attempts: nextAttempts,
      retryAfter: undefined,
      claimedByWorkerId: Math.trunc(args.workerId),
      terminalFailure: false,
      updatedAt: now,
      lastProcessedAt: now,
      errorMessage: undefined,
      skipReason: undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("processedFiles", {
        namespace: args.namespace,
        chunkCount: 0,
        batchCount: 0,
        completedBatchCount: 0,
        expectedChunkCount: 0,
        tokenCount: 0,
        ...patch,
      });
    }

    return {
      claimed: true,
      reason: "claimed" as const,
      attempts: nextAttempts,
      previousBatchCount: existing?.batchCount ?? 0,
      previousChunkCount: existing?.chunkCount ?? 0,
    };
  },
});

export const touchFileProcessing = mutation({
  args: {
    namespace: v.string(),
    fileId: v.string(),
    workerId: v.number(),
    batchCount: v.optional(v.number()),
    chunkCount: v.optional(v.number()),
    expectedChunkCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);
    if (!existing || existing.status !== "processing") {
      return { touched: false };
    }

    const workerId = Math.trunc(args.workerId);
    if (
      typeof existing.claimedByWorkerId === "number" &&
      existing.claimedByWorkerId !== workerId
    ) {
      return { touched: false };
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      batchCount: Math.max(existing.batchCount ?? 0, clampCount(args.batchCount) ?? 0),
      chunkCount: Math.max(existing.chunkCount ?? 0, clampCount(args.chunkCount) ?? 0),
      expectedChunkCount: Math.max(
        existing.expectedChunkCount ?? 0,
        clampCount(args.expectedChunkCount) ?? 0
      ),
      claimedByWorkerId: workerId,
      updatedAt: now,
      lastProcessedAt: now,
    });

    return { touched: true, updatedAt: now };
  },
});

export const completeFileProcessing = mutation({
  args: {
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
    chunkCount: v.number(),
    batchCount: v.number(),
    tokenCount: v.optional(v.number()),
    indexedTokenCount: v.optional(v.number()),
    workerId: v.number(),
    skipReason: v.optional(v.string()),
    indexedChunkCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);
    const nextChunkCount = Math.max(0, Math.trunc(args.chunkCount));
    const nextBatchCount = Math.max(0, Math.trunc(args.batchCount));
    const nextTokenCount = clampCount(args.tokenCount) ?? 0;
    const nextIndexedChunkCount = clampCount(args.indexedChunkCount) ?? nextChunkCount;
    const nextIndexedTokenCount = clampCount(args.indexedTokenCount) ?? nextTokenCount;
    const previousFinalIndexedChunkCount =
      existing && isSuccessfulFileStatus(existing.status)
        ? existing.indexedChunkCount ?? existing.chunkCount ?? 0
        : 0;
    const previousFinalIndexedTokenCount =
      existing && isSuccessfulFileStatus(existing.status)
        ? existing.indexedTokenCount ?? existing.tokenCount ?? 0
        : 0;

    const patch = {
      folderId: args.folderId,
      fileId: args.fileId,
      fileName: args.fileName,
      relativePath: args.relativePath,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      modifiedTime: args.modifiedTime,
      md5Checksum: args.md5Checksum,
      sizeBytes: clampCount(args.sizeBytes),
      status: "done" as const,
      attempts: Math.max(1, getProcessedFileAttempts(existing)),
      tokenCount: nextTokenCount,
      indexedTokenCount: nextIndexedTokenCount,
      expectedChunkCount: nextChunkCount,
      chunkCount: nextChunkCount,
      indexedChunkCount: nextIndexedChunkCount,
      batchCount: nextBatchCount,
      completedBatchCount: nextBatchCount,
      retryAfter: undefined,
      claimedByWorkerId: Math.trunc(args.workerId),
      terminalFailure: false,
      skipReason: args.skipReason,
      updatedAt: now,
      lastProcessedAt: now,
      errorMessage: undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("processedFiles", {
        namespace: args.namespace,
        ...patch,
      });
    }

    const dataset = await applyProcessedFileDeltaToDataset(ctx, {
      namespace: args.namespace,
      chunkDelta: nextIndexedChunkCount - previousFinalIndexedChunkCount,
      tokenDelta: nextIndexedTokenCount - previousFinalIndexedTokenCount,
    });

    return {
      fileId: args.fileId,
      status: "done" as const,
      chunkCount: nextChunkCount,
      batchCount: nextBatchCount,
      processedChunks: dataset?.processedChunks ?? null,
    };
  },
});

export const failFileProcessing = mutation({
  args: {
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
    errorMessage: v.string(),
    batchCount: v.optional(v.number()),
    workerId: v.number(),
    maxRetries: v.number(),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);
    const attempts = Math.max(1, getProcessedFileAttempts(existing));
    const maxRetries = Math.max(1, Math.trunc(args.maxRetries));
    const willRetry = attempts < maxRetries;
    const retryAfterMs = clampCount(args.retryAfterMs);
    const retryAfter =
      willRetry && typeof retryAfterMs === "number" ? now + retryAfterMs : undefined;

    const patch = {
      folderId: args.folderId,
      fileId: args.fileId,
      fileName: args.fileName,
      relativePath: args.relativePath,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      modifiedTime: args.modifiedTime,
      md5Checksum: args.md5Checksum,
      sizeBytes: clampCount(args.sizeBytes),
      status: "failed" as const,
      attempts,
      expectedChunkCount: existing?.expectedChunkCount,
      chunkCount: existing?.chunkCount,
      tokenCount: existing?.tokenCount,
      batchCount: clampCount(args.batchCount) ?? existing?.batchCount,
      completedBatchCount: existing?.completedBatchCount,
      retryAfter,
      claimedByWorkerId: Math.trunc(args.workerId),
      terminalFailure: !willRetry,
      updatedAt: now,
      lastProcessedAt: now,
      errorMessage: args.errorMessage,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("processedFiles", {
        namespace: args.namespace,
        ...patch,
      });
    }

    return {
      fileId: args.fileId,
      status: "failed" as const,
      attempts,
      willRetry,
      retryAfter: retryAfter ?? null,
      terminalFailure: !willRetry,
    };
  },
});

export const beginFileProcessing = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);

    if (existing && isSuccessfulFileStatus(existing.status)) {
      return {
        claimed: false,
        reason: "already_completed" as const,
        previousBatchCount: existing.batchCount ?? 0,
        previousExpectedChunkCount: existing.expectedChunkCount ?? existing.chunkCount ?? 0,
      };
    }

    if (
      existing?.status === "processing" &&
      now - getProcessedFileUpdatedAt(existing) < PROCESSING_CLAIM_TIMEOUT_MS
    ) {
      return {
        claimed: false,
        reason: "already_processing" as const,
        previousBatchCount: existing.batchCount ?? 0,
        previousExpectedChunkCount: existing.expectedChunkCount ?? existing.chunkCount ?? 0,
      };
    }

    if (
      existing?.status === "failed" &&
      now - getProcessedFileUpdatedAt(existing) < FAILED_RETRY_COOLDOWN_MS
    ) {
      return {
        claimed: false,
        reason: "retry_cooldown" as const,
        previousBatchCount: existing.batchCount ?? 0,
        previousExpectedChunkCount: existing.expectedChunkCount ?? existing.chunkCount ?? 0,
      };
    }

    const patch = {
      folderId: args.folderId,
      fileId: args.fileId,
      fileName: args.fileName,
      relativePath: args.relativePath,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      modifiedTime: args.modifiedTime,
      md5Checksum: args.md5Checksum,
      sizeBytes: clampCount(args.sizeBytes),
      status: "processing" as const,
      expectedChunkCount: undefined,
      chunkCount: 0,
      batchCount: 0,
      completedBatchCount: 0,
      updatedAt: now,
      lastProcessedAt: now,
      errorMessage: undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("processedFiles", {
        namespace: args.namespace,
        ...patch,
      });
    }

    return {
      claimed: true,
      reason: "claimed" as const,
      previousBatchCount: existing?.batchCount ?? 0,
      previousExpectedChunkCount: existing?.expectedChunkCount ?? existing?.chunkCount ?? 0,
    };
  },
});

export const markFileEnqueued = mutation({
  args: {
    namespace: v.string(),
    fileId: v.string(),
    expectedChunkCount: v.number(),
    batchCount: v.number(),
    completedBatchCount: v.number(),
    completedChunkCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);
    if (!existing) {
      return null;
    }

    const batchCount = Math.max(0, Math.trunc(args.batchCount));
    const completedBatchCount = Math.max(
      existing.completedBatchCount ?? 0,
      0,
      Math.min(batchCount, Math.trunc(args.completedBatchCount))
    );
    const expectedChunkCount = Math.max(0, Math.trunc(args.expectedChunkCount));
    const completedChunkCount = Math.max(
      existing.chunkCount ?? 0,
      0,
      Math.min(expectedChunkCount, Math.trunc(args.completedChunkCount))
    );
    const status = completedBatchCount >= batchCount && batchCount > 0 ? "completed" : "processing";

    await ctx.db.patch(existing._id, {
      expectedChunkCount,
      batchCount,
      completedBatchCount,
      chunkCount: completedChunkCount,
      status,
      updatedAt: Date.now(),
      lastProcessedAt: Date.now(),
      errorMessage: undefined,
    });

    return {
      fileId: args.fileId,
      status,
      batchCount,
      completedBatchCount,
      expectedChunkCount,
      completedChunkCount,
    };
  },
});

export const recordQueuedBatchResult = mutation({
  args: {
    namespace: v.string(),
    fileId: v.string(),
    batchCount: v.number(),
    chunkCount: v.number(),
    tokenCount: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const fileDoc = await getProcessedFileDoc(ctx, args.namespace, args.fileId);
    const dataset = await getDatasetByNamespace(ctx, args.namespace);
    const batchCount = Math.max(0, Math.trunc(args.batchCount));
    const chunkCount = Math.max(0, Math.trunc(args.chunkCount));
    const tokenCount = clampCount(args.tokenCount) ?? 0;

    if (fileDoc) {
      if (args.errorMessage) {
        await ctx.db.patch(fileDoc._id, {
          batchCount: Math.max(fileDoc.batchCount ?? 0, batchCount),
          status: "failed",
          updatedAt: now,
          lastProcessedAt: now,
          errorMessage: args.errorMessage,
        });
      } else {
        const nextBatchCount = Math.max(fileDoc.batchCount ?? 0, batchCount);
        const nextCompletedBatchCount = Math.min(
          (fileDoc.completedBatchCount ?? 0) + 1,
          nextBatchCount > 0 ? nextBatchCount : Number.MAX_SAFE_INTEGER
        );
        const expectedChunkCount = fileDoc.expectedChunkCount;
        const nextChunkCount =
          typeof expectedChunkCount === "number"
            ? Math.min(expectedChunkCount, (fileDoc.chunkCount ?? 0) + chunkCount)
            : (fileDoc.chunkCount ?? 0) + chunkCount;
        const status =
          typeof expectedChunkCount === "number" &&
          nextBatchCount > 0 &&
          nextCompletedBatchCount >= nextBatchCount
            ? "completed"
            : "processing";

        await ctx.db.patch(fileDoc._id, {
          batchCount: nextBatchCount,
          completedBatchCount: nextCompletedBatchCount,
          chunkCount: nextChunkCount,
          status,
          updatedAt: now,
          lastProcessedAt: now,
          errorMessage: undefined,
        });
      }
    }

    if (!args.errorMessage && dataset) {
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
    }

    return {
      fileId: args.fileId,
      ok: !args.errorMessage,
    };
  },
});

export const markFileCompleted = mutation({
  args: {
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
    chunkCount: v.number(),
    batchCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);

    const patch = {
      folderId: args.folderId,
      fileId: args.fileId,
      fileName: args.fileName,
      relativePath: args.relativePath,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      modifiedTime: args.modifiedTime,
      md5Checksum: args.md5Checksum,
      sizeBytes: clampCount(args.sizeBytes),
      status: "completed" as const,
      expectedChunkCount: Math.max(0, Math.trunc(args.chunkCount)),
      chunkCount: Math.max(0, Math.trunc(args.chunkCount)),
      batchCount: Math.max(0, Math.trunc(args.batchCount)),
      completedBatchCount: Math.max(0, Math.trunc(args.batchCount)),
      updatedAt: now,
      lastProcessedAt: now,
      errorMessage: undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("processedFiles", {
        namespace: args.namespace,
        ...patch,
      });
    }

    return {
      fileId: args.fileId,
      chunkCount: patch.chunkCount,
      batchCount: patch.batchCount,
    };
  },
});

export const markFileFailed = mutation({
  args: {
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
    errorMessage: v.string(),
    batchCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await getProcessedFileDoc(ctx, args.namespace, args.fileId);

    const patch = {
      folderId: args.folderId,
      fileId: args.fileId,
      fileName: args.fileName,
      relativePath: args.relativePath,
      mimeType: args.mimeType,
      webViewLink: args.webViewLink,
      modifiedTime: args.modifiedTime,
      md5Checksum: args.md5Checksum,
      sizeBytes: clampCount(args.sizeBytes),
      status: "failed" as const,
      expectedChunkCount: existing?.expectedChunkCount,
      batchCount: clampCount(args.batchCount) ?? existing?.batchCount,
      completedBatchCount: existing?.completedBatchCount,
      updatedAt: now,
      lastProcessedAt: now,
      errorMessage: args.errorMessage,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("processedFiles", {
        namespace: args.namespace,
        ...patch,
      });
    }

    return {
      fileId: args.fileId,
      status: "failed" as const,
    };
  },
});
