function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DEFAULT_RAG_TOP_K = 12;
export const MIN_RAG_TOP_K = 10;
export const MAX_RAG_TOP_K = 15;
export const RAG_SNIPPET_MAX_CHARS = 320;
export const ANSWER_MAX_TOKENS = parsePositiveInt(process.env.RAG_MAX_TOKENS, 220);
export const DATASET_META_MAX_TOKENS = parsePositiveInt(
  process.env.RAG_DATASET_MAX_TOKENS,
  180
);
export const SUMMARY_MAX_TOKENS = parsePositiveInt(process.env.RAG_SUMMARY_MAX_TOKENS, 180);
export const FAST_GENERATION_MODEL =
  process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";

export type SharedRouteKind = "dataset_meta" | "rag" | "conversation";

export type PromptDatasetTagStat = {
  tag: string;
  count: number;
};

export type PromptDatasetTopicStat = {
  topic: string;
  count: number;
};

export type PromptDatasetInfo = {
  key: string;
  version?: string | null;
  status?: "pending" | "ingesting" | "ready" | "failed";
  datasetName: string;
  datasetSize: number;
  fullSize?: number | null;
  sampledSize?: number | null;
  totalRecords?: number | null;
  source: string[];
  domain: string;
  chunkCount: number;
  ingestedChunkCount?: number | null;
  ingestionProgressPct?: number | null;
  processedChunks?: number | null;
  progressPct?: number | null;
  ingestionStartedAt?: number | null;
  topTags?: PromptDatasetTagStat[];
  topTopics?: PromptDatasetTopicStat[];
  summary?: string | null;
  structureSummary?: string | null;
  analysisNotes?: string | null;
  analysisUpdatedAt?: number | null;
  sourceDetails?: Array<{
    name: string;
    repo: string;
    ref: string;
    repoUrl: string;
    fileCount: number;
    chunkCount: number;
  }>;
  manifestPath: string;
  dataPath: string;
  builtAt: number;
  targetBytes?: number | null;
  toleranceBytes?: number | null;
  notes?: string | null;
  errorMessage?: string | null;
};

export type PromptRetrievalHit = {
  text: string;
  metadata?: Record<string, unknown>;
  score: number;
  confidence: number;
};

export type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function formatTopTags(tags?: PromptDatasetTagStat[] | null) {
  return tags && tags.length > 0
    ? tags.map((item) => `${item.tag} (${formatCount(item.count)})`).join(", ")
    : "No tag distribution available yet.";
}

function formatTopTopics(topics?: PromptDatasetTopicStat[] | null) {
  return topics && topics.length > 0
    ? topics.map((item) => `${item.topic} (${formatCount(item.count)})`).join(", ")
    : "No topic distribution available yet.";
}

function formatBytesOrUnknown(bytes?: number | null) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return "unknown";
  }

  return formatBytes(bytes);
}

function formatMetadataTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag)).join(", ");
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

export function isDatasetMetaQuestion(query: string) {
  return [
    /\bwhat(?:'s| is)? (?:my|the) dataset\b/i,
    /\bdataset\b.*\b(about|size|sources?|used|domain|summary|topics?|tags?|structure|records?)\b/i,
    /\b(knowledge base|corpus)\b/i,
    /\b(indexed docs?|indexed corpus)\b/i,
    /\bhow (?:large|big)\b.*\bdataset\b/i,
    /\bhow many chunks?\b/i,
    /\bwhat sources?\b/i,
    /\bwhat documents?\b.*\b(use|used)\b/i,
    /\b(manifest|data file|dataset path)\b/i,
    /\bstack exchange\b/i,
    /\bkaggle\b/i,
    /\btag distribution\b/i,
  ].some((pattern) => pattern.test(query));
}

export function wantsExamples(query: string) {
  return [
    /\bexample(s)?\b/i,
    /\bsample(s)?\b/i,
    /\bretriev/i,
    /\bshow me\b/i,
    /\bwhat does it answer\b/i,
  ].some((pattern) => pattern.test(query));
}

export function isConversational(query: string) {
  const trimmed = query.trim().toLowerCase();
  return [
    /^(hi|hello|hey|yo)\b/,
    /^(thanks|thank you)\b/,
    /^how are you\b/,
    /^who are you\b/,
    /^what can you do\b/,
    /^help\b/,
    /^good (morning|afternoon|evening)\b/,
  ].some((pattern) => pattern.test(trimmed));
}

export function parseRouteLabel(raw: string): SharedRouteKind | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("dataset_meta")) {
    return "dataset_meta";
  }
  if (normalized.includes("conversation")) {
    return "conversation";
  }
  if (normalized.includes("rag")) {
    return "rag";
  }
  return null;
}

export function buildDatasetContext(dataset: PromptDatasetInfo | null) {
  if (!dataset) {
    return "Dataset metadata is still being prepared.";
  }

  const indexedChunks = dataset.processedChunks ?? dataset.ingestedChunkCount ?? 0;
  const progressPct = dataset.progressPct ?? dataset.ingestionProgressPct ?? null;

  const sizeLines = [
    `Full corpus size: ${formatBytesOrUnknown(dataset.fullSize ?? null)}${dataset.fullSize ? ` (${formatCount(dataset.fullSize)} bytes)` : ""}`,
    `Estimated indexed size: ${formatBytesOrUnknown(dataset.datasetSize)}${dataset.datasetSize ? ` (${formatCount(dataset.datasetSize)} bytes)` : ""}`,
    `Prepared chunk text size: ${formatBytesOrUnknown(dataset.sampledSize ?? null)}${dataset.sampledSize ? ` (${formatCount(dataset.sampledSize)} bytes)` : ""}`,
    `Sampled source records: ${formatCount(dataset.totalRecords ?? 0)}`,
  ];

  const intelligenceLines = [
    `Top tags: ${formatTopTags(dataset.topTags)}`,
    `Top topics: ${formatTopTopics(dataset.topTopics)}`,
    dataset.summary ? `Summary: ${dataset.summary}` : null,
    dataset.structureSummary ? `Structure: ${dataset.structureSummary}` : null,
    dataset.analysisNotes ? `Analysis notes: ${dataset.analysisNotes}` : null,
  ].filter(Boolean);

  return [
    `Dataset: ${dataset.datasetName}`,
    `Domain: ${dataset.domain}`,
    `Source: ${dataset.source.join(", ")}`,
    `Ingestion status: ${dataset.status ?? "ready"}`,
    `Indexed chunks: ${formatCount(indexedChunks)}`,
    progressPct !== null ? `Progress: ${progressPct}%` : null,
    ...sizeLines,
    `Chunk count: ${dataset.chunkCount}`,
    dataset.targetBytes
      ? `Target size: ${formatBytes(dataset.targetBytes)} (${dataset.targetBytes} bytes)`
      : null,
    dataset.toleranceBytes
      ? `Tolerance: +- ${formatBytes(dataset.toleranceBytes)} (${dataset.toleranceBytes} bytes)`
      : null,
    ...intelligenceLines,
    `Manifest: ${dataset.manifestPath}`,
    `Data file: ${dataset.dataPath}`,
    dataset.notes ? `Notes: ${dataset.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDatasetMetaAnswer(query: string, dataset: PromptDatasetInfo | null) {
  if (!dataset) {
    return "The dataset is still ingesting, so dataset-level details will be available once preparation finishes.";
  }

  const lower = query.toLowerCase();
  const asksOverview =
    /\b(about|overview|describe|dataset|corpus|knowledge base|what is|what's)\b/.test(lower) ||
    (!/\b(size|large|big|bytes|gb|mb|source|sources|repo|repositories|manifest|path|chunks?|tags?|topics?|structure|records?)\b/.test(
      lower
    ) &&
      /\bdataset\b/.test(lower));
  const asksSize = /\b(size|large|big|bytes|gb|mb|records?|posts?|chunks?)\b/.test(lower);
  const asksSources =
    /\b(source|sources|repo|repositories|used|from|huggingface|hugging face|kaggle)\b/.test(
      lower
    );
  const asksPaths = /\b(manifest|path|paths|file|files)\b/.test(lower);
  const asksTopics = /\b(topic|topics|tag|tags|distribution)\b/.test(lower);
  const asksStructure = /\b(structure|format|fields?|schema|accepted answer|question answer)\b/.test(
    lower
  );

  const sections: string[] = [];

  if (asksOverview || (!asksSize && !asksSources && !asksPaths && !asksTopics && !asksStructure)) {
    sections.push(
      `${dataset.datasetName} is a Hugging Face-hosted knowledge base built for semantic retrieval. The corpus is cleaned and chunked into semantically complete passages, and the current indexed footprint is estimated at about ${formatBytesOrUnknown(
        dataset.datasetSize
      )}.`
    );
    if (dataset.summary) {
      sections.push(dataset.summary);
    }
  }

  if (asksSize) {
    sections.push(
      `Full corpus size: ${formatBytesOrUnknown(dataset.fullSize ?? null)}${dataset.fullSize ? ` (${formatCount(dataset.fullSize)} bytes)` : ""}. Estimated indexed size: ${formatBytesOrUnknown(
        dataset.datasetSize
      )}${dataset.datasetSize ? ` (${formatCount(dataset.datasetSize)} bytes)` : ""}. Prepared chunk text size: ${formatBytesOrUnknown(
        dataset.sampledSize ?? null
      )}${dataset.sampledSize ? ` (${formatCount(dataset.sampledSize)} bytes)` : ""}. Sampled source records: ${formatCount(
        dataset.totalRecords ?? 0
      )}.`
    );
  }

  if (asksTopics) {
    sections.push(
      `Top tags: ${formatTopTags(dataset.topTags)}. Top topics: ${formatTopTopics(dataset.topTopics)}.`
    );
  }

  if (asksStructure) {
    sections.push(
      dataset.structureSummary ??
        "Each record contains cleaned source content that is grouped into semantically coherent retrieval chunks."
    );
  }

  if (asksSources) {
    sections.push(`Dataset source: ${dataset.source.join(", ")}.`);
  }

  if (asksPaths) {
    sections.push(`Manifest path: ${dataset.manifestPath}. Data file path: ${dataset.dataPath}.`);
  }

  if (sections.length === 0) {
    sections.push(buildDatasetContext(dataset));
  }

  return sections.join(" ");
}

export function buildRetrievalContext(matches: PromptRetrievalHit[]) {
  if (matches.length === 0) {
    return "No retrieved chunks were available for this question.";
  }

  return matches
    .map((match, index) => {
      const source = String(
        match.metadata?.sourceName ??
          match.metadata?.site ??
          match.metadata?.source ??
          "Unknown source"
      );
      const title = match.metadata?.title ? ` | ${String(match.metadata.title)}` : "";
      const path = match.metadata?.path ? ` | ${String(match.metadata.path)}` : "";
      const tagsValue = formatMetadataTags(match.metadata?.tags);
      const tags = tagsValue ? ` | tags ${tagsValue}` : "";
      const postId =
        typeof match.metadata?.postId === "string" || typeof match.metadata?.postId === "number"
          ? ` | post ${String(match.metadata.postId)}`
          : "";
      const confidence = `${Math.round(match.confidence * 100)}%`;
      return [
        `[${index + 1}] ${source}${title}${path}${postId}${tags} | confidence ${confidence}`,
        match.text,
      ].join("\n");
    })
    .join("\n\n");
}

export function buildContextSummary(
  route: SharedRouteKind,
  dataset: PromptDatasetInfo | null,
  matches: PromptRetrievalHit[]
) {
  if (route === "dataset_meta") {
    return buildDatasetContext(dataset);
  }

  if (route === "conversation") {
    return "Conversational route selected. No retrieval was needed for this response.";
  }

  const parts: string[] = [];
  if (dataset) {
    parts.push(buildDatasetContext(dataset));
  }
  parts.push(buildRetrievalContext(matches));
  return parts.join("\n\n");
}

export function buildGenerationMessages(args: {
  query: string;
  route: SharedRouteKind;
  memorySummary?: string | null;
  recentMessages: PromptMessage[];
  dataset?: PromptDatasetInfo | null;
  matches?: PromptRetrievalHit[];
}) {
  const dataset = args.dataset ?? null;
  const matches = args.matches ?? [];
  const exampleMode = wantsExamples(args.query);
  const datasetLabel = dataset?.datasetName ?? "the indexed knowledge base";

  const messages: PromptMessage[] = [
    {
      role: "system",
      content: [
        `You are Spinabot, a grounded RAG assistant for ${datasetLabel}.`,
        "Keep answers concise, precise, and production-minded.",
        "If route is rag, base technical claims on the dataset intelligence block and the retrieved context.",
        "If route is dataset_meta, answer only from the dataset metadata block.",
        "If route is conversation, reply naturally using conversation memory and avoid inventing unseen facts.",
        "When evidence is weak, say that clearly.",
        "When citing sources, mention the source or path inline in plain text.",
        exampleMode
          ? "The user is asking for examples or samples, so prefer concrete retrieved evidence over abstract summaries."
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
  ];

  if (args.memorySummary) {
    messages.push({
      role: "system",
      content: `Conversation summary:\n${args.memorySummary}`,
    });
  }

  if (dataset && args.route !== "conversation") {
    messages.push({
      role: "system",
      content: `Dataset intelligence:\n${buildDatasetContext(dataset)}`,
    });
  }

  if (args.route === "rag") {
    messages.push({
      role: "system",
      content: `Retrieved context:\n${buildRetrievalContext(matches)}`,
    });
  }

  messages.push(...args.recentMessages);
  messages.push({ role: "user", content: args.query });
  return messages;
}
