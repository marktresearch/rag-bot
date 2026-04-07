import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const GROUNDED_THRESHOLD = 0.35;
const FULLY_GROUNDED_THRESHOLD = 0.5;
const DASHBOARD_LOG_LIMIT = 500;

function toBreakdown(topChunkSimilarity: number) {
  if (topChunkSimilarity >= FULLY_GROUNDED_THRESHOLD) {
    return "fully_grounded" as const;
  }

  if (topChunkSimilarity >= GROUNDED_THRESHOLD) {
    return "partially_grounded" as const;
  }

  return "hallucinated" as const;
}

export const recordQueryLog = mutation({
  args: {
    query: v.string(),
    topChunkSimilarity: v.number(),
    responseLength: v.number(),
    responseText: v.string(),
    wasGrounded: v.boolean(),
    sourcePdf: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const topChunkSimilarity = Number(args.topChunkSimilarity.toFixed(4));
    const wasGrounded = topChunkSimilarity >= GROUNDED_THRESHOLD;
    const breakdown = toBreakdown(topChunkSimilarity);

    return await ctx.db.insert("queryLogs", {
      query: args.query,
      topChunkSimilarity,
      responseLength: Math.max(0, Math.trunc(args.responseLength)),
      responseText: args.responseText,
      wasGrounded,
      breakdown,
      sourcePdf: args.sourcePdf,
      timestamp: Math.trunc(args.timestamp),
    });
  },
});

export const getHallucinationDashboard = query({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db
      .query("queryLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .take(DASHBOARD_LOG_LIMIT);

    const total = logs.length;
    const grounded = logs.filter((log) => log.topChunkSimilarity >= GROUNDED_THRESHOLD).length;
    const hallucinated = total - grounded;
    const fullyGrounded = logs.filter(
      (log) => toBreakdown(log.topChunkSimilarity) === "fully_grounded"
    ).length;
    const partiallyGrounded = logs.filter(
      (log) => toBreakdown(log.topChunkSimilarity) === "partially_grounded"
    ).length;
    const avgSimilarity =
      total > 0
        ? logs.reduce((sum, log) => sum + log.topChunkSimilarity, 0) / total
        : 0;

    return {
      total,
      totalQueries: total,
      hallucinationRate:
        total > 0 ? Number(((hallucinated / total) * 100).toFixed(1)) : 0,
      groundedRate: total > 0 ? Number(((grounded / total) * 100).toFixed(1)) : 0,
      avgSimilarity: Number(avgSimilarity.toFixed(2)),
      breakdown: {
        fullyGrounded,
        partiallyGrounded,
        hallucinated,
      },
      recentLogs: logs.slice(0, 10).map((log) => ({
        query: log.query,
        topChunkSimilarity: log.topChunkSimilarity,
        wasGrounded: log.topChunkSimilarity >= GROUNDED_THRESHOLD,
        breakdown: toBreakdown(log.topChunkSimilarity),
        responseText: log.responseText,
        sourcePdf: log.sourcePdf,
        responseLength: log.responseLength,
        timestamp: log.timestamp,
      })),
    };
  },
});
