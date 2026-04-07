import { v } from "convex/values";
import { DEFAULT_NAMESPACE } from "../app/lib/dataset-config";
import { components, internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";

const APP_TABLES = [
  "datasets",
  "driveConnections",
  "processedFiles",
  "ingestionRuns",
  "ingestionPayloads",
  "ingestionPayloadChunks",
  "chatMessageMetadata",
  "queryLogs",
] as const;

const RESET_PAGE_SIZE = 100;
const RAG_ENTRY_STATUSES = ["pending", "ready", "replaced"] as const;

export const wipeAppTablesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    let totalDeleted = 0;

    for (const table of APP_TABLES) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
        totalDeleted += 1;
      }
    }

    return { totalDeleted };
  },
});

export const wipeAppTables = action({
  args: {
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    totalDeleted: number;
    appTablesDeleted: number;
    ragEntriesDeleted: number;
    ragNamespacesDeleted: number;
    ragNamespacesFound: number;
    namespace: string;
  }> => {
    const namespace = args.namespace ?? DEFAULT_NAMESPACE;

    const appResult = (await ctx.runMutation(internal.reset.wipeAppTablesInternal, {})) as {
      totalDeleted: number;
    };

    const namespaceVersions: Array<{ namespaceId: string }> = [];
    let namespaceCursor: string | null = null;

    while (true) {
      const page = (await ctx.runQuery(components.rag.namespaces.listNamespaceVersions, {
        namespace,
        paginationOpts: {
          cursor: namespaceCursor,
          numItems: RESET_PAGE_SIZE,
        },
      })) as {
        continueCursor: string;
        isDone: boolean;
        page: Array<{ namespaceId: string }>;
      };

      namespaceVersions.push(...page.page.map((ns) => ({
        namespaceId: ns.namespaceId,
      })));

      if (page.isDone) {
        break;
      }

      namespaceCursor = page.continueCursor;
    }

    let ragEntriesDeleted = 0;

    for (const ns of namespaceVersions) {
      for (const status of RAG_ENTRY_STATUSES) {
        while (true) {
          const entries = (await ctx.runQuery(components.rag.entries.list, {
            namespaceId: ns.namespaceId,
            status,
            paginationOpts: {
              cursor: null,
              numItems: RESET_PAGE_SIZE,
            },
          })) as {
            page: Array<{ entryId: string }>;
          };

          if (entries.page.length === 0) {
            break;
          }

          for (const entry of entries.page) {
            await ctx.runAction(components.rag.entries.deleteSync, {
              entryId: entry.entryId,
            });
            ragEntriesDeleted += 1;
          }
        }
      }
    }

    let ragNamespacesDeleted = 0;

    for (const ns of namespaceVersions) {
      try {
        await ctx.runMutation(components.rag.namespaces.deleteNamespace, {
          namespaceId: ns.namespaceId,
        });
        ragNamespacesDeleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("cannot delete, has entries") && !message.includes("not found")) {
          throw error;
        }
      }
    }

    return {
      totalDeleted: appResult.totalDeleted + ragEntriesDeleted,
      appTablesDeleted: appResult.totalDeleted,
      ragEntriesDeleted,
      ragNamespacesDeleted,
      ragNamespacesFound: namespaceVersions.length,
      namespace,
    };
  },
});
