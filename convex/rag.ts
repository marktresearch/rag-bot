import { RAG } from "@convex-dev/rag";
import { v } from "convex/values";
import { DEFAULT_NAMESPACE } from "../app/lib/dataset-config";
import { components } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { action, query } from "./_generated/server";
import { EMBEDDING_MODEL_ID, getRagEmbeddingModel } from "./embeddings";

const EMBEDDING_DIMENSION = 768;
const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 10;
const RERANKED_TOP_CHUNKS = 3;

export const ragComponent = new RAG(components.rag, {
  textEmbeddingModel: getRagEmbeddingModel(),
  embeddingDimension: EMBEDDING_DIMENSION,
});

function clampLimit(limit: number | undefined) {
  const value = Number.isFinite(limit) ? Math.trunc(limit as number) : DEFAULT_TOP_K;
  return Math.max(1, Math.min(value, MAX_TOP_K));
}

function countTokens(text: string) {
  return text.match(/\S+/g)?.length ?? 0;
}

function expandQuery(query: string) {
  const normalized = query.toLowerCase().trim();

  if (normalized.includes("summary") || normalized.includes("summarize")) {
    return `${query} abstract introduction overview main contributions`;
  }

  if (normalized.includes("main contribution") || normalized.includes("contribution")) {
    return `${query} abstract contribution contributions overview findings proposed method`;
  }

  if (
    (normalized.includes("tools") || normalized.includes("tool")) &&
    (normalized.includes("experiment") || normalized.includes("evaluation"))
  ) {
    return `${query} experiments evaluation evaluated tools representative tools benchmark setup`;
  }

  if (normalized.includes("what is") || normalized.includes("explain")) {
    return `${query} definition explanation description`;
  }

  if (normalized.includes("bert")) {
    return `${query} BERT bidirectional encoder representations transformers pre-training masked language model next sentence prediction`;
  }

  if (normalized.includes("paper")) {
    return `${query} paper abstract introduction contribution contributions summary`;
  }

  return `${query} research paper findings methodology`;
}

function buildChunkContext(chunks: Array<{
  source: string;
  title: string | null;
  text: string;
}>) {
  return chunks
    .map((chunk, index) => {
      const title = chunk.title ? ` | ${chunk.title}` : "";
      return `[${index + 1}] ${chunk.source}${title}\n${chunk.text}`;
    })
    .join("\n\n---\n\n");
}

async function getDatasetDocByNamespace(
  ctx: QueryCtx,
  namespace: string
) {
  return await ctx.db
    .query("datasets")
    .withIndex("by_namespace", (q) => q.eq("namespace", namespace))
    .unique();
}

export const getIndexStatus = query({
  args: {
    namespaceName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const namespaceName = args.namespaceName ?? DEFAULT_NAMESPACE;
    const [namespace, dataset] = await Promise.all([
      ragComponent.getNamespace(ctx, {
        namespace: namespaceName,
      }),
      getDatasetDocByNamespace(ctx, namespaceName),
    ]);

    const processedChunks = dataset?.processedChunks ?? 0;

    return {
      namespace: namespaceName,
      modelId: namespace?.modelId ?? EMBEDDING_MODEL_ID,
      dimension: namespace?.dimension ?? EMBEDDING_DIMENSION,
      hasDocuments: processedChunks > 0,
      chunkCount: processedChunks,
      sampledDocuments: processedChunks,
      documentCount: processedChunks,
      totalChunks: dataset?.totalChunks ?? 0,
      avgTokensPerChunk: dataset?.avgTokensPerChunk ?? 0,
      status: dataset?.status ?? "pending",
    };
  },
});

export const search = action({
  args: {
    query: v.string(),
    namespaceName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespaceName = args.namespaceName ?? DEFAULT_NAMESPACE;
    const limit = clampLimit(args.limit);
    const expandedQuery = expandQuery(args.query);
    const startedAt = Date.now();
    const namespace = await ragComponent.getNamespace(ctx, {
      namespace: namespaceName,
    });

    if (!namespace) {
      return {
        namespace: namespaceName,
        hasDocuments: false,
        matches: [],
        chunks: [],
        context: "",
        topChunkSimilarity: 0,
        metrics: {
          embeddingMs: 0,
          retrievalMs: Date.now() - startedAt,
          topK: limit,
          contextChars: 0,
        },
      };
    }

    const { results, text, entries } = await ragComponent.search(ctx, {
      namespace: namespaceName,
      query: expandedQuery,
      limit,
      searchType: "vector",
    });

    const entriesById = new Map(entries.map((entry) => [entry.entryId, entry]));

    const chunks = results.map((result, index) => {
      const entry = entriesById.get(result.entryId);
      const contentMetadata = result.content[0]?.metadata;
      const chunkText = result.content.map((chunk) => chunk.text).join("\n\n").trim();
      const tokenCount =
        typeof contentMetadata?.tokenCount === "number"
          ? Math.max(0, Math.trunc(contentMetadata.tokenCount))
          : typeof entry?.metadata?.tokenCount === "number"
            ? Math.max(0, Math.trunc(entry.metadata.tokenCount))
          : countTokens(chunkText);
      const title =
        entry?.title ??
        (typeof entry?.metadata?.title === "string" ? entry.metadata.title : null);
      const source =
        typeof contentMetadata?.sourcePdf === "string"
          ? contentMetadata.sourcePdf
          : typeof contentMetadata?.source === "string"
            ? contentMetadata.source
            : typeof entry?.metadata?.sourcePdf === "string"
              ? entry.metadata.sourcePdf
              : typeof entry?.metadata?.source === "string"
                ? entry.metadata.source
                : "Dataset";
      const path =
        typeof entry?.metadata?.path === "string" ? entry.metadata.path : null;

      return {
        rank: index + 1,
        id: `${result.entryId}:${result.order}`,
        entryId: result.entryId,
        order: result.order,
        score: Number(result.score.toFixed(4)),
        confidence: Number(Math.max(0, Math.min(1, result.score)).toFixed(3)),
        tokenCount,
        text: chunkText,
        preview: chunkText.slice(0, 200),
        source,
        title,
        path,
        metadata: {
          ...(entry?.metadata ?? {}),
          ...(contentMetadata ?? {}),
          entryId: result.entryId,
          chunkOrder: result.order,
          startOrder: result.startOrder,
          tokenCount,
          source,
          sourcePdf: source,
          title,
          path,
        },
      };
    });

    const topChunks = [...chunks]
      .sort((left, right) => right.score - left.score)
      .slice(0, RERANKED_TOP_CHUNKS)
      .map((chunk, index) => ({
        ...chunk,
        rank: index + 1,
      }));

    const context = buildChunkContext(topChunks);

    return {
      namespace: namespaceName,
      hasDocuments: true,
      matches: topChunks.map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
        metadata: chunk.metadata,
        score: chunk.score,
        confidence: chunk.confidence,
      })),
      chunks: topChunks,
      context: context || text,
      topChunkSimilarity: topChunks[0]?.score ?? 0,
      metrics: {
        embeddingMs: 0,
        retrievalMs: Date.now() - startedAt,
        topK: limit,
        contextChars: context.length,
      },
    };
  },
});
