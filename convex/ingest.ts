import { action, mutation, query, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import type { NamespaceId } from "@convex-dev/rag";
import { api } from "./_generated/api";
import { ragComponent } from "./rag";

function buildDriveBatchKey(fileId: string, batchIndex: number) {
  return `${fileId}::batch::${batchIndex}`;
}

async function resolveNamespaceId(ctx: ActionCtx, namespace: string) {
  const existingNamespace = await ragComponent.getNamespace(ctx, {
    namespace,
  });

  if (existingNamespace) {
    return existingNamespace.namespaceId;
  }

  const createdNamespace = await ragComponent.getOrCreateNamespace(ctx, {
    namespace,
    status: "ready",
  });

  return createdNamespace.namespaceId;
}

export const addChunk = action({
  args: {
    text: v.string(),
    source: v.string(),
    index: v.number(),
    namespace: v.string(),
  },
  handler: async (ctx, { text, source, index, namespace }) => {
    const namespaceId = await resolveNamespaceId(ctx, namespace);

    await ragComponent.add(ctx, {
      namespaceId,
      key: `${source}-${index}`,
      title: source,
      metadata: {
        fileId: source,
        source,
        sourcePdf: source,
      },
      chunks: [
        {
          text,
          metadata: {
            order: index,
            source,
            sourcePdf: source,
          },
        },
      ],
    });
  },
});

export const ensureNamespaceId = action({
  args: {
    namespace: v.string(),
  },
  handler: async (ctx, { namespace }) => {
    const namespaceId = await resolveNamespaceId(ctx, namespace);
    return {
      namespaceId,
    };
  },
});

export const addChunksBatch = action({
  args: {
    namespaceId: v.optional(v.string()),
    fileId: v.string(),
    fileName: v.string(),
    relativePath: v.optional(v.string()),
    mimeType: v.string(),
    webViewLink: v.optional(v.string()),
    modifiedTime: v.optional(v.string()),
    batchIndex: v.number(),
    totalBatches: v.number(),
    contentHash: v.optional(v.string()),
    chunks: v.array(
      v.object({
        text: v.string(),
        order: v.number(),
      })
    ),
    namespace: v.string(),
  },
  handler: async (
    ctx,
    {
      fileId,
      fileName,
      relativePath,
      mimeType,
      webViewLink,
      modifiedTime,
      namespaceId,
      batchIndex,
      totalBatches,
      contentHash,
      chunks,
      namespace,
    }
  ) => {
    const source = relativePath ?? fileName;
    const entryMetadata = {
      fileId,
      fileName,
      source,
      sourcePdf: source,
      mimeType,
      batchIndex,
      totalBatches,
      ...(webViewLink ? { path: webViewLink } : {}),
      ...(modifiedTime ? { modifiedTime } : {}),
    };

    if (chunks.length === 0) {
      return {
        fileId,
        batchIndex,
        insertedChunks: 0,
      };
    }

    const resolvedNamespaceId = (namespaceId ??
      (await resolveNamespaceId(ctx, namespace))) as NamespaceId;

    const result = await ragComponent.add(ctx, {
      namespaceId: resolvedNamespaceId,
      key: buildDriveBatchKey(fileId, batchIndex),
      title: fileName,
      metadata: entryMetadata,
      contentHash,
      chunks: chunks.map((chunk) => ({
        text: chunk.text,
        metadata: {
          ...entryMetadata,
          order: chunk.order,
        },
      })),
    });

    return {
      fileId,
      batchIndex,
      insertedChunks: result.created ? chunks.length : 0,
      created: result.created,
      status: result.status,
    };
  },
});

export const pruneFileBatches = action({
  args: {
    namespace: v.string(),
    fileId: v.string(),
    fromBatchIndex: v.number(),
    toBatchIndexExclusive: v.number(),
  },
  handler: async (ctx, args) => {
    const namespace = await ragComponent.getNamespace(ctx, {
      namespace: args.namespace,
    });
    const start = Math.max(0, Math.trunc(args.fromBatchIndex));
    const end = Math.max(start, Math.trunc(args.toBatchIndexExclusive));

    if (!namespace || end <= start) {
      return { deleted: 0 };
    }

    let deleted = 0;

    for (let batchIndex = start; batchIndex < end; batchIndex += 1) {
      await ragComponent.deleteByKey(ctx, {
        namespaceId: namespace.namespaceId,
        key: buildDriveBatchKey(args.fileId, batchIndex),
      });
      deleted += 1;
    }

    return { deleted };
  },
});

/**
 * Shared logic to erase a namespace from RAG and its dataset record.
 */
async function eraseNamespaceLogic(ctx: ActionCtx, namespace: string) {
  // 1. Get the namespace ID from the RAG component
  const ns = await ragComponent.getNamespace(ctx, { namespace });
  if (!ns) {
    console.log(`Namespace "${namespace}" not found in RAG.`);
  } else {
    let deletedEntries = 0;
    let cursor: string | null = null;
    let isDone = false;

    // 2. Paginate through entries in THIS namespace and delete them
    while (!isDone) {
      const page = await ragComponent.list(ctx, {
        namespaceId: ns.namespaceId,
        paginationOpts: { cursor, numItems: 100 },
      });

      for (const entry of page.page) {
        await ragComponent.delete(ctx, { entryId: entry.entryId });
        deletedEntries++;
      }

      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    console.log(`✓ Erased ${deletedEntries} entries from RAG namespace "${namespace}"`);
  }

  // 3. Clean up the dataset record and drive folders
  await ctx.runMutation(api.ingest.deleteDatasetRecord, { namespace });
}

/**
 * Erase all ingested chunks from a specific drive namespace.
 *
 * Usage (Convex CLI):
 *   npx convex run ingest:eraseDriveChunks '{"namespace":"drive_<FOLDER_ID>"}'
 */
export const eraseDriveChunks = action({
  args: {
    namespace: v.string(),
  },
  handler: async (ctx, { namespace }) => {
    await eraseNamespaceLogic(ctx, namespace);
    return { namespace };
  },
});

/**
 * Erase ALL Google Drive datasets and chunks.
 * Usage: npx convex run ingest:eraseAllDriveData
 */
export const eraseAllDriveData = action({
  args: {},
  handler: async (ctx): Promise<{ count: number }> => {
    const driveDatasets = await ctx.runQuery(api.ingest.listDriveDatasets);
    
    for (const ds of driveDatasets) {
      console.log(`Erasing drive dataset: ${ds.namespace}...`);
      await eraseNamespaceLogic(ctx, ds.namespace);
    }
    
    return { count: driveDatasets.length };
  },
});

/** Internal helper: list all drive datasets. */
export const listDriveDatasets = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("datasets")
      .filter((q) => q.eq(q.field("type"), "drive"))
      .collect();
  },
});

/** Internal helper: delete the dataset record for a namespace. */
export const deleteDatasetRecord = mutation({
  args: { namespace: v.string() },
  handler: async (ctx, { namespace }) => {
    const dataset = await ctx.db
      .query("datasets")
      .withIndex("by_namespace", (q) => q.eq("namespace", namespace))
      .unique();

    if (dataset) {
      await ctx.db.delete(dataset._id);
    }
  },
});
