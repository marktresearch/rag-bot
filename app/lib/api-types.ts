export type RouteKind = "dataset_meta" | "rag" | "conversation";
export type DatasetStatus = "pending" | "ingesting" | "ready" | "failed";

export type DriveConnectionStatus = {
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  folderId: string | null;
  folderName: string | null;
  namespace: string | null;
  ingestionEnabled: boolean;
  ingestionRequestedAt: number | null;
  updatedAt: number | null;
};

export type DriveFolder = {
  id: string;
  name: string;
  webViewLink: string | null;
  parentId: string | null;
};

export type DriveWorkerStatus = {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  logPath: string | null;
};

export type DriveProgressStatus = {
  namespace: string;
  totalFiles: number;
  completedFiles: number;
  processingFiles: number;
  failedFiles: number;
  retryableFailedFiles?: number;
  terminalFailedFiles?: number;
  remainingFiles: number;
  progressPct: number | null;
  lastScanAt: number | null;
  updatedAt: number | null;
  status: DatasetStatus;
};

export type DatasetStatItem = {
  name: string;
  count: number | null;
};

export type DatasetSourceDetail = {
  name: string;
  repo: string;
  ref: string;
  repoUrl: string;
  fileCount: number;
  chunkCount: number;
};

export type RetrievedMatch = {
  rank: number;
  id: string;
  source: string;
  title: string | null;
  path: string | null;
  url: string | null;
  lineStart: number | null;
  postId?: string | number | null;
  tags?: string[];
  confidence: number;
  score: number;
  text: string;
};

export type RetrievedChunk = {
  rank: number;
  id: string;
  entryId: string;
  order: number;
  score: number;
  tokenCount: number;
  text: string;
  preview: string;
  source: string;
  title: string | null;
  path: string | null;
};

export type MessageMetrics = {
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  embeddingMs?: number | null;
  retrievalMs?: number | null;
  generationMs?: number | null;
  cachedEmbedding?: boolean | null;
  topK?: number | null;
  contextChars?: number | null;
  model?: string | null;
};

export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: number;
  route: RouteKind | null;
  metadata: {
    matches?: RetrievedMatch[];
    metrics?: MessageMetrics | null;
    routingReason?: string | null;
  } | null;
};

export type ChatSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  messageCount: number;
  summary: string | null;
  preview: string | null;
};

export type ChatDetail = {
  chat: {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    lastMessageAt: number;
    messageCount: number;
    summary: string | null;
  };
  messages: ChatMessage[];
};

export type DatasetInfo = {
  key: string;
  version: string | null;
  namespace?: string | null;
  status: DatasetStatus;
  datasetName: string;
  source: string[];
  domain: string;
  datasetSize: number;
  fullSize: number | null;
  sampledSize: number | null;
  totalRecords: number | null;
  chunkCount: number;
  avgTokensPerChunk?: number | null;
  ingestedChunkCount?: number | null;
  ingestionProgressPct?: number | null;
  processedChunks?: number | null;
  progressPct?: number | null;
  ingestionStartedAt?: number | null;
  ingestionUpdatedAt?: number | null;
  queuedChunkCount?: number | null;
  pendingChunkCount?: number | null;
  failedChunkCount?: number | null;
  readyDocumentCount?: number | null;
  failedDocumentCount?: number | null;
  ingestRunId?: string | null;
  sourceDetails?: DatasetSourceDetail[];
  topTags?: DatasetStatItem[];
  topTopics?: DatasetStatItem[];
  summary: string | null;
  manifestPath: string;
  dataPath: string;
  builtAt: number;
  targetBytes?: number | null;
  toleranceBytes?: number | null;
  notes: string | null;
  errorMessage?: string | null;
};

export type StatusResponse = {
  backend: "connected";
  dataset: DatasetInfo | null;
  system: {
    usingExistingIndex: boolean;
    storageLimited: boolean;
    warning: string | null;
  };
  index: {
    namespace: string;
    modelId: string;
    dimension: number;
    hasDocuments: boolean;
    sampledDocuments: number;
    documentCount: number;
  };
  telemetry: {
    trackedQueries: number;
    averageLatencyMs: number | null;
    averageEmbeddingMs?: number | null;
    averageRetrievalMs?: number | null;
    averageGenerationMs?: number | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastQueryAt: number | null;
    routeCounts: {
      dataset_meta: number;
      rag: number;
      conversation: number;
    };
  };
};

export type AskResponse = {
  question: string;
  answer: string;
  context: string;
  chatId: string | null;
  chatTitle: string | null;
  route: RouteKind;
  routingReason: string;
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
  chunks: RetrievedChunk[];
  dataset: DatasetInfo | null;
  memory: {
    summary: string | null;
    recentMessageCount: number;
  };
  metrics: MessageMetrics;
};
