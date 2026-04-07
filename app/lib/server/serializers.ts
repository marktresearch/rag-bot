import type { ChatMessage, RetrievedMatch } from "../api-types";

type RawMatch = {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
  score: number;
  confidence: number;
};

type RawMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: number;
  route: "dataset_meta" | "rag" | "conversation" | null;
  metadata: Record<string, unknown> | null;
};

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function serializeMatches(rawMatches: RawMatch[] = []): RetrievedMatch[] {
  return rawMatches.map((match, index) => ({
    rank: index + 1,
    id: match.id,
    source: String(
      match.metadata?.sourceName ?? match.metadata?.source ?? "Unknown source"
    ),
    title: typeof match.metadata?.title === "string" ? match.metadata.title : null,
    path: typeof match.metadata?.path === "string" ? match.metadata.path : null,
    url:
      typeof match.metadata?.source_url === "string"
        ? match.metadata.source_url
        : typeof match.metadata?.url === "string"
          ? match.metadata.url
          : null,
    lineStart: asNumber(match.metadata?.lineStart),
    postId:
      typeof match.metadata?.postId === "string" || typeof match.metadata?.postId === "number"
        ? match.metadata.postId
        : null,
    tags: Array.isArray(match.metadata?.tags)
      ? match.metadata.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    confidence: match.confidence,
    score: match.score,
    text: match.text,
  }));
}

export function serializeMessage(rawMessage: RawMessage): ChatMessage {
  const rawMatches = Array.isArray(rawMessage.metadata?.matches)
    ? (rawMessage.metadata?.matches as RawMatch[])
    : [];
  const rawMetrics = rawMessage.metadata?.metrics as
    | {
        latencyMs?: number;
        promptTokens?: number | null;
        completionTokens?: number | null;
        totalTokens?: number | null;
        embeddingMs?: number | null;
        retrievalMs?: number | null;
        generationMs?: number | null;
        cachedEmbedding?: boolean | null;
        topK?: number | null;
        contextChars?: number | null;
        model?: string | null;
      }
    | null
    | undefined;
  const routingReason =
    typeof rawMessage.metadata?.routingReason === "string"
      ? rawMessage.metadata.routingReason
      : null;

  return {
    id: rawMessage.id,
    role: rawMessage.role,
    content: rawMessage.content,
    createdAt: rawMessage.createdAt,
    route: rawMessage.route,
    metadata: {
      matches: serializeMatches(rawMatches),
      metrics: rawMetrics
        ? {
            latencyMs: rawMetrics.latencyMs ?? 0,
            promptTokens: rawMetrics.promptTokens ?? null,
            completionTokens: rawMetrics.completionTokens ?? null,
            totalTokens: rawMetrics.totalTokens ?? null,
            embeddingMs: rawMetrics.embeddingMs ?? null,
            retrievalMs: rawMetrics.retrievalMs ?? null,
            generationMs: rawMetrics.generationMs ?? null,
            cachedEmbedding: rawMetrics.cachedEmbedding ?? null,
            topK: rawMetrics.topK ?? null,
            contextChars: rawMetrics.contextChars ?? null,
            model: rawMetrics.model ?? null,
          }
        : null,
      routingReason,
    },
  };
}
