import type { StatusResponse } from "@/app/lib/api-types";
import { getRuntimeDatasetState } from "@/app/lib/server/dataset";
import {
  EXISTING_INDEXED_DATASET_MESSAGE,
  STORAGE_LIMIT_REACHED_MESSAGE,
} from "@/lib/rag-config";

const EMPTY_TELEMETRY: StatusResponse["telemetry"] = {
  trackedQueries: 0,
  averageLatencyMs: null,
  averageEmbeddingMs: null,
  averageRetrievalMs: null,
  averageGenerationMs: null,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  lastQueryAt: null,
  routeCounts: {
    dataset_meta: 0,
    rag: 0,
    conversation: 0,
  },
};

export async function GET(req: Request) {
  try {
    // Accept an optional namespace from the query string
    const url = new URL(req.url);
    const namespaceParam = url.searchParams.get("namespace") ?? undefined;

    const { dataset, index, activeNamespace } = await getRuntimeDatasetState(namespaceParam);
    const pendingChunks = dataset?.pendingChunkCount ?? 0;
    const warning = index?.hasDocuments
      ? EXISTING_INDEXED_DATASET_MESSAGE
      : pendingChunks > 0
        ? `${pendingChunks.toLocaleString()} chunks are still ingesting into Convex. Chat unlocks once more than 100 chunks are ready, and ingestion will keep running in the background.`
        : "Connect Google Drive from the dashboard and choose a folder to start background ingestion.";
    const documentCount = dataset?.processedChunks ?? index?.documentCount ?? 0;

    if (!index) {
      throw new Error("Unable to load Convex index status.");
    }

    return Response.json({
      backend: "connected",
      dataset,
      activeNamespace,
      system: {
        usingExistingIndex: index.hasDocuments,
        storageLimited: false,
        warning,
      },
      index: {
        namespace: index.namespace,
        modelId: index.modelId,
        dimension: index.dimension,
        hasDocuments: index.hasDocuments,
        sampledDocuments: index.sampledDocuments,
        documentCount,
      },
      telemetry: EMPTY_TELEMETRY,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        error: message,
        warning: STORAGE_LIMIT_REACHED_MESSAGE,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
