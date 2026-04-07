import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { DatasetInfo, RetrievedMatch, RouteKind, StatusResponse } from "@/app/lib/api-types";
import { DATASET_NAME } from "@/app/lib/dataset-config";
import { EXISTING_INDEXED_DATASET_MESSAGE, STORAGE_LIMIT_REACHED_MESSAGE } from "@/lib/rag-config";
import { DEFAULT_MATCH_LIMIT } from "@/shared/ingestion";
import { extractSearchTokens, scoreSearchRelevance } from "@/shared/retrieval";

const LOCAL_DATASET_DIR = path.join(process.cwd(), "datasets", DATASET_NAME);
const LOCAL_DATASET_MANIFEST_PATH = path.join(
  LOCAL_DATASET_DIR,
  "dataset_manifest.json"
);
const LOCAL_DATASET_JSONL_PATH = path.join(LOCAL_DATASET_DIR, "dataset.jsonl");
const LOCAL_EMBED_MODEL_ID = "local-jsonl-search";
const SEARCH_RESULT_LIMIT = DEFAULT_MATCH_LIMIT;
const MAX_QUERY_TOKENS = 8;

type LocalDatasetManifest = {
  dataset_key: string;
  version: string;
  dataset_name: string;
  dataset_size: number;
  source: string[];
  domain: string;
  chunk_count: number;
  built_at: string;
  target_bytes?: number | null;
  tolerance_bytes?: number | null;
  data_path?: string;
  manifest_path?: string;
  source_details?: Array<{
    name: string;
    repo: string;
    ref: string;
    repo_url: string;
    file_count: number;
    chunk_count: number;
  }>;
  full_size?: number | null;
  sampled_size?: number | null;
  total_records?: number | null;
  top_tags?: Array<{ tag: string; count: number }>;
  top_topics?: Array<{ topic: string; count: number }>;
  summary?: string | null;
  structure_summary?: string | null;
  analysis_notes?: string | null;
  analysis_updated_at?: string | null;
};

type LocalDatasetRecord = {
  text?: string;
  chunks?: Array<{
    text?: string;
    order?: number;
  }>;
  metadata?: Record<string, unknown>;
};

type LocalSearchMatch = {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
  score: number;
  confidence: number;
};

type LocalAskResult = {
  chatId: string | null;
  chatTitle: string | null;
  route: RouteKind;
  routingReason: string;
  answer: string;
  context: string;
  status: {
    convex: "connected";
    index: "empty" | "hit";
    matchCount: number;
  };
  system: {
    usingExistingIndex: boolean;
    storageLimited: boolean;
    warning: string | null;
    persisted: boolean;
  };
  matches: RetrievedMatch[];
  dataset: DatasetInfo | null;
  memory: {
    summary: string | null;
    recentMessageCount: number;
  };
  metrics: {
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
};

let manifestPromise: Promise<LocalDatasetManifest | null> | null = null;

function tokenize(text: string) {
  const unique = new Set<string>();
  for (const token of extractSearchTokens(text)) {
    unique.add(token);
    if (unique.size >= MAX_QUERY_TOKENS) {
      break;
    }
  }
  return Array.from(unique);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildQueryVariants(query: string) {
  const normalized = normalizeText(query).replace(/[?!.,]+$/g, "");
  const subject = normalized.replace(
    /^(tell me about|what is|what are|who is|who are|explain|define|describe)\s+/i,
    ""
  );

  const variants = [
    normalized,
    subject,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  return Array.from(new Set(variants));
}

function toDatasetInfo(manifest: LocalDatasetManifest): DatasetInfo {
  return {
    key: manifest.dataset_key,
    version: manifest.version ?? null,
    status: "ready",
    datasetName: manifest.dataset_name,
    source: manifest.source ?? [],
    domain: manifest.domain,
    datasetSize: manifest.sampled_size ?? manifest.dataset_size ?? 0,
    fullSize: manifest.full_size ?? null,
    sampledSize: manifest.sampled_size ?? manifest.dataset_size ?? null,
    totalRecords: manifest.total_records ?? null,
    chunkCount: manifest.chunk_count ?? 0,
    ingestedChunkCount: manifest.chunk_count ?? 0,
    ingestionProgressPct: 100,
    processedChunks: manifest.chunk_count ?? 0,
    progressPct: 100,
    ingestionStartedAt: manifest.built_at ? Date.parse(manifest.built_at) : null,
    sourceDetails:
      manifest.source_details?.map((detail) => ({
        name: detail.name,
        repo: detail.repo,
        ref: detail.ref,
        repoUrl: detail.repo_url,
        fileCount: detail.file_count,
        chunkCount: detail.chunk_count,
      })) ?? [],
    topTags:
      manifest.top_tags?.map((entry) => ({
        name: entry.tag,
        count: entry.count,
      })) ?? [],
    topTopics:
      manifest.top_topics?.map((entry) => ({
        name: entry.topic,
        count: entry.count,
      })) ?? [],
    summary: manifest.summary ?? null,
    manifestPath: manifest.manifest_path ?? LOCAL_DATASET_MANIFEST_PATH,
    dataPath: manifest.data_path ?? LOCAL_DATASET_JSONL_PATH,
    builtAt: manifest.built_at ? Date.parse(manifest.built_at) : Date.now(),
    targetBytes: manifest.target_bytes ?? null,
    toleranceBytes: manifest.tolerance_bytes ?? null,
    notes: manifest.analysis_notes ?? null,
    errorMessage: null,
  };
}

async function readManifest() {
  try {
    await access(LOCAL_DATASET_MANIFEST_PATH);
    await access(LOCAL_DATASET_JSONL_PATH);
  } catch {
    return null;
  }

  const raw = await readFile(LOCAL_DATASET_MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as LocalDatasetManifest;
}

async function getManifest() {
  if (!manifestPromise) {
    manifestPromise = readManifest();
  }
  return manifestPromise;
}

function scoreCandidate(
  rawText: string,
  queryVariants: string[],
  metadata?: Record<string, unknown>
) {
  const normalizedText = normalizeText(rawText);
  const title = typeof metadata?.title === "string" ? normalizeText(metadata.title) : "";
  const pathValue = typeof metadata?.path === "string" ? normalizeText(metadata.path) : "";

  let bestScore = 0;
  let bestConfidence = 0;

  for (const variant of queryVariants) {
    const normalizedVariant = normalizeText(variant).toLowerCase();
    if (!normalizedVariant) {
      continue;
    }

    const body = scoreSearchRelevance(variant, normalizedText, metadata);
    const titleMatch = title ? scoreSearchRelevance(variant, title, metadata) : null;
    const phraseInTitle = title.toLowerCase().includes(normalizedVariant);
    const phraseInBody = normalizedText.toLowerCase().includes(normalizedVariant);
    const phraseInPath = pathValue.toLowerCase().includes(normalizedVariant);
    const exactTitle = title.toLowerCase() === normalizedVariant;

    const score =
      (exactTitle ? 14 : 0) +
      (phraseInTitle ? 6 : 0) +
      (phraseInBody ? 3 : 0) +
      (phraseInPath ? 2 : 0) +
      (titleMatch?.lexicalScore ?? 0) * 8 +
      (titleMatch?.bigramCoverage ?? 0) * 3 +
      body.lexicalScore * 6 +
      body.bigramCoverage * 2;

    const confidence = Math.min(
      0.98,
      0.12 +
        (titleMatch?.lexicalScore ?? 0) * 0.42 +
        body.lexicalScore * 0.34 +
        (phraseInTitle ? 0.08 : 0) +
        (phraseInBody ? 0.04 : 0)
    );

    if (score > bestScore) {
      bestScore = score;
      bestConfidence = confidence;
    }
  }

  if (bestScore <= 0) {
    return null;
  }

  return {
    score: Number(bestScore.toFixed(4)),
    confidence: Number(bestConfidence.toFixed(3)),
  };
}

function chooseExcerpt(text: string, queryTokens: string[]) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const segments = (paragraphs.length > 0 ? paragraphs : [normalizeText(text)])
    .flatMap((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
        .map((part) => normalizeText(part))
        .filter(Boolean)
    )
    .filter(Boolean);

  const ranked = segments
    .map((segment, index) => {
      const lower = segment.toLowerCase();
      let overlap = 0;
      for (const token of queryTokens) {
        if (lower.includes(token)) {
          overlap += 1;
        }
      }
  const score = overlap * 2 - Math.max(0, segment.length - 220) / 220;
      return { index, segment, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = ranked
    .filter((entry) => entry.score > 0)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.segment);

  const excerpt = (
    selected.length > 0
      ? selected
      : segments.length > 0
        ? segments.slice(0, 2)
        : [normalizeText(text).slice(0, 420)]
  ).join(" ");
  return excerpt.length > 420 ? `${excerpt.slice(0, 417).trimEnd()}...` : excerpt;
}

function insertMatch(matches: LocalSearchMatch[], candidate: LocalSearchMatch) {
  matches.push(candidate);
  matches.sort((a, b) => b.score - a.score);
  if (matches.length > SEARCH_RESULT_LIMIT) {
    matches.pop();
  }
}

function toRetrievedMatch(match: LocalSearchMatch, index: number): RetrievedMatch {
  return {
    rank: index + 1,
    id: match.id,
    source: String(
      match.metadata?.sourceShard ??
        match.metadata?.sourceName ??
        match.metadata?.source ??
        "wikipedia"
    ),
    title: typeof match.metadata?.title === "string" ? match.metadata.title : null,
    path: typeof match.metadata?.path === "string" ? match.metadata.path : null,
    url:
      typeof match.metadata?.source_url === "string"
        ? match.metadata.source_url
        : typeof match.metadata?.url === "string"
          ? match.metadata.url
          : null,
    lineStart: null,
    postId:
      typeof match.metadata?.recordIndex === "number"
        ? match.metadata.recordIndex
        : typeof match.metadata?.postId === "string" || typeof match.metadata?.postId === "number"
          ? match.metadata.postId
          : null,
    tags: Array.isArray(match.metadata?.tags)
      ? match.metadata.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    confidence: match.confidence,
    score: match.score,
    text: match.text,
  };
}

async function searchLocalDataset(
  query: string,
  limit = SEARCH_RESULT_LIMIT
): Promise<LocalSearchMatch[]> {
  const queryLower = normalizeText(query).toLowerCase();
  const queryTokens = tokenize(queryLower);
  const queryVariants = buildQueryVariants(query);
  if (!queryLower || queryTokens.length === 0) {
    return [];
  }

  const fileStream = createReadStream(LOCAL_DATASET_JSONL_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const matches: LocalSearchMatch[] = [];
  let rowNumber = 0;

  for await (const line of rl) {
    rowNumber += 1;
    let parsed: LocalDatasetRecord;
    try {
      parsed = JSON.parse(line) as LocalDatasetRecord;
    } catch {
      continue;
    }

    const candidateChunks = Array.isArray(parsed.chunks)
      ? parsed.chunks.flatMap((chunk, chunkIndex) =>
          typeof chunk?.text === "string"
            ? [
                {
                  id: `local:${rowNumber}:${typeof chunk.order === "number" ? chunk.order : chunkIndex}`,
                  text: chunk.text,
                },
              ]
            : []
        )
      : typeof parsed.text === "string"
        ? [{ id: `local:${rowNumber}:0`, text: parsed.text }]
        : [];
    const titleLower =
      typeof parsed.metadata?.title === "string"
        ? normalizeText(parsed.metadata.title).toLowerCase()
        : "";
    const pathLower =
      typeof parsed.metadata?.path === "string"
        ? normalizeText(parsed.metadata.path).toLowerCase()
        : "";

    for (const candidateChunk of candidateChunks) {
      const chunkLower = candidateChunk.text.toLowerCase();
      const hasTokenHint = queryTokens.some(
        (token) =>
          chunkLower.includes(token) || titleLower.includes(token) || pathLower.includes(token)
      );
      if (!hasTokenHint) {
        continue;
      }

      const roughScore = scoreCandidate(
        candidateChunk.text,
        queryVariants,
        parsed.metadata
      );
      if (!roughScore) {
        continue;
      }

      const excerpt = chooseExcerpt(candidateChunk.text, queryTokens);
      const rescored = scoreCandidate(
        `${excerpt}\n${JSON.stringify(parsed.metadata ?? {})}`,
        queryVariants,
        parsed.metadata
      );
      if (!rescored) {
        continue;
      }

      insertMatch(matches, {
        id: candidateChunk.id,
        text: excerpt,
        metadata: parsed.metadata,
        score: rescored.score,
        confidence: rescored.confidence,
      });
    }

    if (matches.length > limit) {
      matches.length = limit;
    }
  }

  const strongest = matches[0]?.score ?? 0;
  return matches
    .filter((match, index) =>
      index === 0 ? match.score >= 4.5 : match.score >= Math.max(4, strongest * 0.58)
    )
    .slice(0, limit);
}

function buildAnswer(query: string, matches: LocalSearchMatch[]) {
  if (matches.length === 0) {
    return `I couldn't find a strong match for "${query}" in the indexed local dataset. Try a more specific question or include distinctive keywords.`;
  }

  const primary = matches[0];
  const primaryLabel = primary?.metadata?.title
    ? `${String(primary.metadata.title)}: `
    : "";
  const supporting = matches
    .slice(1, 3)
    .map((match, index) => {
      const source =
        typeof match.metadata?.sourceShard === "string"
          ? match.metadata.sourceShard
          : typeof match.metadata?.source === "string"
            ? match.metadata.source
            : "Wikipedia";
      const label =
        typeof match.metadata?.title === "string" ? `${match.metadata.title}: ` : "";
      return `[${index + 2}] ${source}: ${label}${match.text}`;
    })
    .join("\n\n");

  return supporting
    ? `${primaryLabel}${primary.text}\n\nSupporting passages:\n${supporting}`
    : `${primaryLabel}${primary.text}`;
}

export async function hasLocalIndexedDataset() {
  return (await getManifest()) !== null;
}

export async function getLocalStatusResponse(): Promise<StatusResponse | null> {
  const manifest = await getManifest();
  if (!manifest) {
    return null;
  }

  const dataset = toDatasetInfo(manifest);
  return {
    backend: "connected",
    dataset,
    system: {
      usingExistingIndex: true,
      storageLimited: true,
      warning: STORAGE_LIMIT_REACHED_MESSAGE,
    },
    index: {
      namespace: dataset.key,
      modelId: LOCAL_EMBED_MODEL_ID,
      dimension: 0,
      hasDocuments: dataset.chunkCount > 0,
      sampledDocuments: Math.min(3, dataset.chunkCount),
      documentCount: dataset.chunkCount,
    },
    telemetry: {
      trackedQueries: 0,
      averageLatencyMs: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      lastQueryAt: null,
      routeCounts: {
        dataset_meta: 0,
        rag: 0,
        conversation: 0,
      },
    },
  };
}

export async function askLocalDataset(query: string): Promise<LocalAskResult | null> {
  const manifest = await getManifest();
  if (!manifest) {
    return null;
  }

  const startedAt = Date.now();
  const dataset = toDatasetInfo(manifest);
  const localMatches = await searchLocalDataset(query, SEARCH_RESULT_LIMIT);
  const matches = localMatches.map(toRetrievedMatch);
  const answer = buildAnswer(query, localMatches);
  const context = localMatches.map((match, index) => `[${index + 1}] ${match.text}`).join("\n\n");
  const latencyMs = Date.now() - startedAt;

  return {
    chatId: null,
    chatTitle: null,
    route: "rag",
    routingReason: "local indexed dataset fallback",
    answer,
    context,
    status: {
      convex: "connected",
      index: matches.length > 0 ? "hit" : "empty",
      matchCount: matches.length,
    },
    system: {
      usingExistingIndex: true,
      storageLimited: true,
      warning:
        localMatches.length > 0
          ? STORAGE_LIMIT_REACHED_MESSAGE
          : EXISTING_INDEXED_DATASET_MESSAGE,
      persisted: false,
    },
    matches,
    dataset,
    memory: {
      summary: null,
      recentMessageCount: 0,
    },
    metrics: {
      latencyMs,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    },
  };
}

export async function getLocalDatasetReadyState() {
  const status = await getLocalStatusResponse();
  if (!status) {
    return null;
  }

  return {
    started: false,
    dataset: status.dataset,
    status: "ready" as const,
  };
}
