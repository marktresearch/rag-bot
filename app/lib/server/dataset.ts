import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { DatasetInfo } from "@/app/lib/api-types";
import {
  DATASET_DOMAIN,
  DATASET_KEY,
  DATASET_NAME,
  DEFAULT_NAMESPACE,
  DATASET_SOURCE,
  DATASET_VERSION,
} from "@/app/lib/dataset-config";
import { getServerConvexClient } from "@/app/lib/server/convex";
import { api } from "@/convex/_generated/api";

const MANIFEST_PATH = path.join(process.cwd(), "datasets", "dataset_manifest.json");
const DATA_PATH = path.join(process.cwd(), "datasets", "pdfs");

type ManifestStat = {
  tag?: string;
  topic?: string;
  count?: number;
};

type DatasetManifest = {
  dataset_key?: string;
  version?: string;
  dataset_name?: string;
  dataset_size?: number;
  full_size?: number;
  sampled_size?: number;
  total_records?: number;
  source?: string[];
  domain?: string;
  chunk_count?: number;
  built_at?: string;
  target_bytes?: number;
  tolerance_bytes?: number;
  summary?: string;
  notes?: string;
  manifest_path?: string;
  data_path?: string;
  top_tags?: ManifestStat[];
  top_topics?: ManifestStat[];
};

type IndexStatus = {
  namespace: string;
  modelId: string;
  dimension: number;
  hasDocuments: boolean;
  sampledDocuments: number;
  documentCount: number;
  totalChunks?: number;
  avgTokensPerChunk?: number;
  status?: "pending" | "ingesting" | "ready" | "failed";
};

function calculateProgressPct(processed: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  if (processed >= total) {
    return 100;
  }

  return Math.max(0, Math.min(99, Math.floor((processed / total) * 100)));
}

async function readManifest() {
  try {
    await access(MANIFEST_PATH);
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw) as DatasetManifest;
  } catch {
    return null;
  }
}

function buildDefaultNotes() {
  return [
    "LiteParse parses PDFs locally with spatially aware extraction and no Python runtime.",
    "Embeddings are generated with the local `local-hash-embedding-003` model through `@convex-dev/rag`.",
    "The ingestion pipeline processes three PDFs in parallel, batches Convex writes, and caps indexing at 6,000 chunks.",
    "Run `npx tsx scripts/full_pipeline.ts` to download the PDF corpus and build the local index.",
  ].join(" ");
}

function toDatasetInfo(manifest: DatasetManifest | null, namespace?: string): DatasetInfo {
  const sampledSize = manifest?.sampled_size ?? 0;
  const indexedSize = manifest?.dataset_size ?? manifest?.sampled_size ?? 0;
  const chunkTarget = manifest?.chunk_count ?? 0;
  const totalRecords = manifest?.total_records ?? null;
  const builtAt = manifest?.built_at ? Date.parse(manifest.built_at) : Date.now();
  const resolvedNamespace = namespace ?? DEFAULT_NAMESPACE;

  return {
    key: manifest?.dataset_key ?? DATASET_KEY,
    version: manifest?.version ?? DATASET_VERSION,
    namespace: resolvedNamespace,
    status: "pending",
    datasetName: manifest?.dataset_name ?? DATASET_NAME,
    source: manifest?.source ?? [DATASET_SOURCE],
    domain: manifest?.domain ?? DATASET_DOMAIN,
    datasetSize: indexedSize,
    fullSize: manifest?.full_size ?? null,
    sampledSize,
    totalRecords,
    chunkCount: chunkTarget,
    avgTokensPerChunk: null,
    ingestedChunkCount: 0,
    ingestionProgressPct: 0,
    processedChunks: 0,
    progressPct: 0,
    ingestionStartedAt: null,
    ingestionUpdatedAt: null,
    queuedChunkCount: 0,
    pendingChunkCount: 0,
    failedChunkCount: 0,
    readyDocumentCount: 0,
    failedDocumentCount: 0,
    ingestRunId: null,
    sourceDetails: [],
    topTags:
      manifest?.top_tags?.map((item) => ({
        name: item.tag ?? "unknown",
        count: typeof item.count === "number" ? item.count : null,
      })) ?? [],
    topTopics:
      manifest?.top_topics?.map((item) => ({
        name: item.topic ?? "unknown",
        count: typeof item.count === "number" ? item.count : null,
      })) ?? [],
    summary: manifest?.summary ?? null,
    manifestPath: manifest?.manifest_path ?? MANIFEST_PATH,
    dataPath: manifest?.data_path ?? DATA_PATH,
    builtAt,
    targetBytes: manifest?.target_bytes ?? null,
    toleranceBytes: manifest?.tolerance_bytes ?? null,
    notes: manifest?.notes ?? buildDefaultNotes(),
    errorMessage: null,
  };
}

export function applyIndexStatusToDataset(
  dataset: DatasetInfo | null,
  index: IndexStatus | null
) {
  if (!dataset) {
    return null;
  }

  const totalChunks = index?.totalChunks ?? dataset.chunkCount;
  const processedChunks = index?.documentCount ?? dataset.processedChunks ?? 0;
  const progressPct = calculateProgressPct(processedChunks, totalChunks);
  const status = index?.status ?? (index?.hasDocuments ? ("ready" as const) : dataset.status);

  return {
    ...dataset,
    namespace: index?.namespace ?? dataset.namespace ?? DEFAULT_NAMESPACE,
    status,
    chunkCount: totalChunks,
    avgTokensPerChunk: index?.avgTokensPerChunk ?? dataset.avgTokensPerChunk ?? null,
    ingestedChunkCount: processedChunks,
    ingestionProgressPct: progressPct,
    processedChunks,
    progressPct,
    queuedChunkCount: Math.max(0, totalChunks - processedChunks),
    pendingChunkCount: Math.max(0, totalChunks - processedChunks),
    ingestionUpdatedAt: Date.now(),
  };
}

export async function getConfiguredDataset(namespace?: string) {
  const manifest = await readManifest();
  return toDatasetInfo(manifest, namespace);
}

export async function getRuntimeDatasetState(namespace?: string) {
  const resolvedNamespace = namespace ?? DEFAULT_NAMESPACE;
  const dataset = await getConfiguredDataset(resolvedNamespace);

  try {
    const convex = getServerConvexClient();

    // Fetch active namespace if none was provided
    let activeNamespace = resolvedNamespace;
    if (!namespace) {
      activeNamespace = await convex.query(api.userSettings.getActiveNamespace, {}) as string;
    }

    const index = await convex.query(api.rag.getIndexStatus, {
      namespaceName: activeNamespace,
    });

    return {
      dataset: applyIndexStatusToDataset(dataset, index),
      index,
      activeNamespace,
    };
  } catch {
    return {
      dataset,
      index: null,
      activeNamespace: resolvedNamespace,
    };
  }
}

export async function ensureDatasetReady(namespace?: string) {
  const runtime = await getRuntimeDatasetState(namespace);

  return {
    started: false,
    dataset: runtime.dataset,
    status: runtime.index?.status ?? runtime.dataset?.status ?? "pending",
  };
}
