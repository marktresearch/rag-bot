import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import type { AskResponse, RetrievedChunk, RetrievedMatch } from "@/app/lib/api-types";
import { api } from "@/convex/_generated/api";
import { applyIndexStatusToDataset, getConfiguredDataset } from "@/app/lib/server/dataset";
import { serializeMatches } from "@/app/lib/server/serializers";
import { getServerConvexClient } from "@/app/lib/server/convex";
import { getErrorMessage } from "@/lib/rag-config";
import {
  ANSWER_MAX_TOKENS,
  buildDatasetContext,
  buildDatasetMetaAnswer,
  FAST_GENERATION_MODEL,
  isDatasetMetaQuestion,
  type PromptDatasetInfo,
} from "@/shared/rag";
import { DEFAULT_MATCH_LIMIT } from "@/shared/ingestion";

const GROUNDING_THRESHOLD = 0.35;

type EventWriter = (event: string, data: unknown) => void;

type SearchResult = {
  namespace: string;
  hasDocuments: boolean;
  matches: Array<{
    id: string;
    text: string;
    metadata?: Record<string, unknown>;
    score: number;
    confidence: number;
  }>;
  chunks: RetrievedChunk[];
  context: string;
  topChunkSimilarity: number;
  metrics: {
    embeddingMs: number;
    retrievalMs: number;
    topK: number;
    contextChars: number;
  };
};

function toPromptDataset(dataset: AskResponse["dataset"]): PromptDatasetInfo | null {
  if (!dataset) {
    return null;
  }

  return {
    ...dataset,
    topTags: dataset.topTags?.map((item) => ({
      tag: item.name,
      count: item.count ?? 0,
    })),
    topTopics: dataset.topTopics?.map((item) => ({
      topic: item.name,
      count: item.count ?? 0,
    })),
  };
}

function buildSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createEventWriter(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();
  return (event: string, data: unknown) => {
    controller.enqueue(encoder.encode(buildSseEvent(event, data)));
  };
}

function streamResponse(run: (send: EventWriter) => Promise<void>) {
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = createEventWriter(controller);

        try {
          await run(send);
        } catch (error: unknown) {
          send("error", { message: getErrorMessage(error) });
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }
  );
}

function emitSingleResult(send: EventWriter, result: AskResponse) {
  send("meta", {
    chatId: result.chatId,
    route: result.route,
    routingReason: result.routingReason,
    system: result.system,
    status: result.status,
    dataset: result.dataset,
    memory: result.memory,
    metrics: result.metrics,
  });

  if (result.answer) {
    send("delta", { content: result.answer });
  }

  send("done", result);
}

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  return apiKey ? new Groq({ apiKey }) : null;
}

function buildGenerationContext(chunks: RetrievedChunk[]) {
  if (chunks.length === 0) {
    return "No retrieved chunks were available for this question.";
  }

  return chunks
    .map((chunk, index) => {
      const title = chunk.title ? ` | ${chunk.title}` : "";
      return `[${index + 1}] ${chunk.source}${title}\n${chunk.text}`;
    })
    .join("\n\n---\n\n");
}

function formatSourceCitation(chunk: RetrievedChunk) {
  return chunk.title ? `${chunk.source} | ${chunk.title}` : chunk.source;
}

function quoteChunk(chunk: RetrievedChunk) {
  const excerpt = chunk.text.replace(/\s+/g, " ").trim();
  return excerpt.length > 320 ? `${excerpt.slice(0, 317).trimEnd()}...` : excerpt;
}

function buildExtractiveAnswer(chunks: RetrievedChunk[]) {
  const selected = chunks.slice(0, 3);

  if (selected.length === 0) {
    return "I could not find relevant chunks in the indexed Convex dataset for that question yet.";
  }

  const [primary, ...supporting] = selected;
  const lead = primary
    ? `${primary.text}\n\nSource: ${formatSourceCitation(primary)}`
    : "";

  if (supporting.length === 0) {
    return lead;
  }

  return `${lead}\n\nSupporting chunks:\n${supporting
    .map(
      (chunk, index) =>
        `[${index + 2}] ${chunk.text}\nSource: ${formatSourceCitation(chunk)}`
    )
    .join("\n\n")}`;
}

function buildLowConfidenceAnswer(question: string, chunks: RetrievedChunk[]) {
  if (chunks.length === 0) {
    return `I do not have grounded context for "${question}" yet. Try a more specific query or wait for more chunks to finish ingesting.`;
  }

  return `The indexed documents don't contain enough information about this. The closest relevant content is: "${quoteChunk(
    chunks[0]!
  )}"\n\nSource: ${formatSourceCitation(chunks[0]!)}`;
}

function buildRagMessages(question: string, context: string, chunks: RetrievedChunk[]): ChatCompletionMessageParam[] {
  const sources = Array.from(new Set(chunks.map((chunk) => formatSourceCitation(chunk)))).join(", ");
  const systemPrompt = `You are a research assistant that answers questions based ONLY on the provided document chunks.

RULES:
- Answer ONLY from the context below
- If the context does not contain enough information, say:
  "The indexed documents don't contain enough information about this. The closest relevant content is: [quote chunk]"
- Never make up information not in the context
- Always cite which paper/source the answer comes from
- Keep answers concise and factual

CONTEXT FROM INDEXED PAPERS:
${context}

SOURCE FILES: ${sources || "unknown"}`;

  return [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `Question: ${question}

Answer based strictly on the context provided above.`,
    },
  ];
}

async function streamGroqAnswer(
  groq: Groq,
  question: string,
  context: string,
  chunks: RetrievedChunk[],
  send: EventWriter
) {
  const generationStartedAt = Date.now();
  const stream = await groq.chat.completions.create({
    model: FAST_GENERATION_MODEL,
    temperature: 0,
    max_tokens: ANSWER_MAX_TOKENS,
    stream: true,
    messages: buildRagMessages(question, context, chunks),
  });

  let answer = "";

  for await (const chunk of stream as AsyncIterable<{
    choices?: Array<{ delta?: { content?: string | null } }>;
  }>) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (!delta) {
      continue;
    }

    answer += delta;
    send("delta", { content: delta });
  }

  return {
    answer,
    generationMs: Date.now() - generationStartedAt,
    model: FAST_GENERATION_MODEL,
  };
}

function buildResponse(args: {
  question: string;
  answer: string;
  dataset: AskResponse["dataset"];
  route: AskResponse["route"];
  routingReason: string;
  context: string;
  matches: RetrievedMatch[];
  chunks: RetrievedChunk[];
  hasDocuments: boolean;
  embeddingMs?: number | null;
  retrievalMs?: number | null;
  generationMs?: number | null;
  model?: string | null;
  topK?: number | null;
  latencyMs: number;
}) {
  return {
    question: args.question,
    answer: args.answer,
    context: args.context,
    chatId: null,
    chatTitle: null,
    route: args.route,
    routingReason: args.routingReason,
    status: {
      convex: "connected" as const,
      index: args.matches.length > 0 ? ("hit" as const) : ("empty" as const),
      matchCount: args.matches.length,
    },
    system: {
      usingExistingIndex: args.hasDocuments,
      storageLimited: false,
      warning: null,
      persisted: false,
    },
    matches: args.matches,
    chunks: args.chunks,
    dataset: args.dataset,
    memory: {
      summary: null,
      recentMessageCount: 0,
    },
    metrics: {
      latencyMs: args.latencyMs,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      embeddingMs: args.embeddingMs ?? null,
      retrievalMs: args.retrievalMs ?? null,
      generationMs: args.generationMs ?? null,
      cachedEmbedding: null,
      topK: args.topK ?? DEFAULT_MATCH_LIMIT,
      contextChars: args.context.length,
      model: args.model ?? null,
    },
  } satisfies AskResponse;
}

async function persistResponse(
  question: string,
  chatId: string | null,
  response: AskResponse
) {
  try {
    const convex = getServerConvexClient();
    const saved = await convex.mutation(api.chat.saveExchange, {
      chatId: chatId ?? undefined,
      question,
      answer: response.answer,
      route: response.route,
      routingReason: response.routingReason,
      matches: response.matches,
      metrics: response.metrics,
    });

    return {
      ...response,
      chatId: saved.chatId,
      chatTitle: saved.chatTitle,
      system: {
        ...response.system,
        persisted: true,
      },
    } satisfies AskResponse;
  } catch {
    return response;
  }
}

async function recordQueryLog(response: AskResponse) {
  if (response.route === "dataset_meta") {
    return;
  }

  const convex = getServerConvexClient();
  const topChunkSimilarity = response.chunks[0]?.score ?? 0;

  await convex.mutation(api.queryLogs.recordQueryLog, {
    query: response.question,
    topChunkSimilarity,
    responseLength: response.answer.length,
    responseText: response.answer,
    wasGrounded: topChunkSimilarity >= GROUNDING_THRESHOLD,
    sourcePdf: response.chunks[0]?.source ?? "",
    timestamp: Date.now(),
  });
}

async function finalizeResponse(
  question: string,
  requestedChatId: string | null,
  response: AskResponse
) {
  const persisted = await persistResponse(question, requestedChatId, response);

  try {
    await recordQueryLog(persisted);
  } catch {
    // Logging should not block the user-visible answer.
  }

  return persisted;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const requestedChatId =
    typeof body?.chatId === "string" && body.chatId.trim().length > 0
      ? body.chatId.trim()
      : null;

  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return streamResponse(async (send) => {
    // Fetch the active namespace from Convex userSettings
    const convex = getServerConvexClient();
    const activeNamespace = await convex.query(api.userSettings.getActiveNamespace, {}) as string;

    const dataset = await getConfiguredDataset(activeNamespace);

    if (isDatasetMetaQuestion(question)) {
      const startedAt = Date.now();
      const promptDataset = toPromptDataset(dataset);
      const answer = buildDatasetMetaAnswer(question, promptDataset);
      const response = buildResponse({
        question,
        answer,
        dataset,
        route: "dataset_meta",
        routingReason: "question matched dataset metadata route",
        context: buildDatasetContext(promptDataset),
        matches: [],
        chunks: [],
        hasDocuments: false,
        latencyMs: Date.now() - startedAt,
      });

      emitSingleResult(send, await finalizeResponse(question, requestedChatId, response));
      return;
    }

    const startedAt = Date.now();
    const search = (await convex.action(api.rag.search, {
      query: question,
      namespaceName: activeNamespace,
      limit: DEFAULT_MATCH_LIMIT,
    })) as SearchResult;
    const indexStatus = await convex.query(api.rag.getIndexStatus, {
      namespaceName: activeNamespace,
    });
    const resolvedDataset = applyIndexStatusToDataset(dataset, indexStatus);
    const matches = serializeMatches(search.matches);
    const chunks = search.chunks;
    const topChunkSimilarity = search.topChunkSimilarity ?? chunks[0]?.score ?? 0;
    const hasGroundedContext = topChunkSimilarity >= GROUNDING_THRESHOLD;
    const route: AskResponse["route"] = chunks.length > 0 ? "rag" : "conversation";
    const routingReason =
      chunks.length === 0
        ? "no relevant chunks were retrieved from the Convex RAG namespace"
        : hasGroundedContext
          ? "vector retrieval returned grounded chunks at or above the similarity threshold"
          : "retrieval returned only weakly similar chunks, so the answer stays conservative";
    const context = search.context || buildGenerationContext(chunks);

    if (!search.hasDocuments || chunks.length === 0 || !hasGroundedContext) {
      const response = buildResponse({
        question,
        answer: buildLowConfidenceAnswer(question, chunks),
        dataset: resolvedDataset,
        route,
        routingReason,
        context,
        matches,
        chunks,
        hasDocuments: search.hasDocuments,
        embeddingMs: search.metrics.embeddingMs,
        retrievalMs: search.metrics.retrievalMs,
        topK: search.metrics.topK,
        latencyMs: Date.now() - startedAt,
      });

      emitSingleResult(send, await finalizeResponse(question, requestedChatId, response));
      return;
    }

    const groq = getGroqClient();
    if (!groq) {
      const response = buildResponse({
        question,
        answer: buildExtractiveAnswer(chunks),
        dataset: resolvedDataset,
        route,
        routingReason,
        context,
        matches,
        chunks,
        hasDocuments: search.hasDocuments,
        embeddingMs: search.metrics.embeddingMs,
        retrievalMs: search.metrics.retrievalMs,
        topK: search.metrics.topK,
        latencyMs: Date.now() - startedAt,
      });

      emitSingleResult(send, await finalizeResponse(question, requestedChatId, response));
      return;
    }

    const baseResponse = buildResponse({
      question,
      answer: "",
      dataset: resolvedDataset,
      route,
      routingReason,
      context,
      matches,
      chunks,
      hasDocuments: search.hasDocuments,
      embeddingMs: search.metrics.embeddingMs,
      retrievalMs: search.metrics.retrievalMs,
      topK: search.metrics.topK,
      latencyMs: Date.now() - startedAt,
    });

    send("meta", {
      chatId: null,
      route: baseResponse.route,
      routingReason: baseResponse.routingReason,
      system: baseResponse.system,
      status: baseResponse.status,
      dataset: baseResponse.dataset,
      memory: baseResponse.memory,
      metrics: baseResponse.metrics,
    });

    const generated = await streamGroqAnswer(groq, question, context, chunks, send);
    const response = buildResponse({
      question,
      answer: generated.answer,
      dataset: resolvedDataset,
      route,
      routingReason,
      context,
      matches,
      chunks,
      hasDocuments: search.hasDocuments,
      embeddingMs: search.metrics.embeddingMs,
      retrievalMs: search.metrics.retrievalMs,
      generationMs: generated.generationMs,
      model: generated.model,
      topK: search.metrics.topK,
      latencyMs: Date.now() - startedAt,
    });

    send("done", await finalizeResponse(question, requestedChatId, response));
  });
}
