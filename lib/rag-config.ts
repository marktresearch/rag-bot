export const EXISTING_INDEXED_DATASET_MESSAGE = "Using existing indexed dataset";
export const STORAGE_LIMIT_REACHED_MESSAGE =
  "Storage limit reached. Using existing indexed data.";
export const CHAT_READY_CHUNK_THRESHOLD = 100;

type DatasetChunkState =
  | {
      processedChunks?: number | null;
      ingestedChunkCount?: number | null;
      chunkCount?: number | null;
      status?: string | null;
    }
  | null
  | undefined;

function coerceChunkCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.floor(value));
}

export function getProcessedChunkCount(dataset: DatasetChunkState) {
  if (!dataset) {
    return 0;
  }

  const processedChunks = coerceChunkCount(dataset.processedChunks);
  if (processedChunks !== null) {
    return processedChunks;
  }

  const ingestedChunkCount = coerceChunkCount(dataset.ingestedChunkCount);
  if (ingestedChunkCount !== null) {
    return ingestedChunkCount;
  }

  return 0;
}

export function hasIndexedChunks(dataset: DatasetChunkState) {
  return getProcessedChunkCount(dataset) > 0;
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isStorageLimitErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  return [
    "storage limit",
    "usage limit",
    "quota",
    "read-only",
    "readonly",
    "disabled due to",
    "limit reached",
    "paused due to",
    "exceeded your",
  ].some((pattern) => normalized.includes(pattern));
}

export function isStorageLimitError(error: unknown) {
  return isStorageLimitErrorMessage(getErrorMessage(error));
}

export function isChatReadyForIndexedDataset(dataset: DatasetChunkState) {
  return getProcessedChunkCount(dataset) > CHAT_READY_CHUNK_THRESHOLD;
}
