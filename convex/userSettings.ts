import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_NAMESPACE } from "../app/lib/dataset-config";

const DEFAULT_USER_ID = "local-demo-user";

export const getActiveNamespace = query({
  args: {
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = args.userId ?? DEFAULT_USER_ID;
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    return settings?.activeNamespace ?? DEFAULT_NAMESPACE;
  },
});

export const setActiveNamespace = mutation({
  args: {
    namespace: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = args.userId ?? DEFAULT_USER_ID;
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        activeNamespace: args.namespace,
      });
      return existing._id;
    }

    return await ctx.db.insert("userSettings", {
      userId,
      activeNamespace: args.namespace,
    });
  },
});

export const listDatasets = query({
  args: {},
  handler: async (ctx) => {
    const datasets = await ctx.db.query("datasets").collect();

    return datasets
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((ds) => ({
        id: ds._id,
        name: ds.name,
        namespace: ds.namespace,
        type: ds.type,
        status: ds.status,
        chunkCount: ds.processedChunks,
        totalChunks: ds.totalChunks,
        updatedAt: ds.updatedAt,
      }));
  },
});

export const patchDataset = mutation({
  args: {
    namespace: v.string(),
    name: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("datasets")
      .withIndex("by_namespace", (q) => q.eq("namespace", args.namespace))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        type: args.type,
      });
    }
  },
});
