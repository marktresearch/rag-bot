export const INGEST_STATUS_VERSION = 1;
export const INGEST_STATUS_FILENAME = "ingest_status.json";

export type IngestRunPhase = "queued" | "ingesting" | "completed" | "failed";

export type IngestErrorSample = {
  entryKey: string;
  message: string;
};

export type IngestStatusSnapshot = {
  version: typeof INGEST_STATUS_VERSION;
  runId: string;
  namespaceName: string;
  datasetPath: string;
  phase: IngestRunPhase;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  scannedRows: number;
  skippedRows: number;
  acceptedDocuments: number;
  acceptedChunks: number;
  acceptedBytes: number;
  enqueuedDocuments: number;
  readyDocuments: number;
  failedDocuments: number;
  pendingDocuments: number;
  readyChunks: number;
  failedChunks: number;
  pendingChunks: number;
  errorSamples: IngestErrorSample[];
  lastError: string | null;
};

type MutableSnapshot = Partial<IngestStatusSnapshot> &
  Pick<IngestStatusSnapshot, "runId" | "namespaceName" | "datasetPath">;

function normalizeCount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function normalizePhase(value: unknown): IngestRunPhase {
  if (
    value === "queued" ||
    value === "ingesting" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }

  return "queued";
}

function normalizeErrorSamples(value: unknown): IngestErrorSample[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const entryKey =
      typeof (item as { entryKey?: unknown }).entryKey === "string"
        ? (item as { entryKey: string }).entryKey
        : null;
    const message =
      typeof (item as { message?: unknown }).message === "string"
        ? (item as { message: string }).message
        : null;

    if (!entryKey || !message) {
      return [];
    }

    return [{ entryKey, message }];
  });
}

export function createIngestStatusSnapshot(
  args: MutableSnapshot
): IngestStatusSnapshot {
  const now = Date.now();

  return {
    version: INGEST_STATUS_VERSION,
    runId: args.runId,
    namespaceName: args.namespaceName,
    datasetPath: args.datasetPath,
    phase: normalizePhase(args.phase),
    startedAt: normalizeTimestamp(args.startedAt) ?? now,
    updatedAt: normalizeTimestamp(args.updatedAt) ?? now,
    completedAt: normalizeTimestamp(args.completedAt),
    scannedRows: normalizeCount(args.scannedRows),
    skippedRows: normalizeCount(args.skippedRows),
    acceptedDocuments: normalizeCount(args.acceptedDocuments),
    acceptedChunks: normalizeCount(args.acceptedChunks),
    acceptedBytes: normalizeCount(args.acceptedBytes),
    enqueuedDocuments: normalizeCount(args.enqueuedDocuments),
    readyDocuments: normalizeCount(args.readyDocuments),
    failedDocuments: normalizeCount(args.failedDocuments),
    pendingDocuments: normalizeCount(args.pendingDocuments),
    readyChunks: normalizeCount(args.readyChunks),
    failedChunks: normalizeCount(args.failedChunks),
    pendingChunks: normalizeCount(args.pendingChunks),
    errorSamples: normalizeErrorSamples(args.errorSamples),
    lastError: typeof args.lastError === "string" ? args.lastError : null,
  };
}

export function parseIngestStatusSnapshot(
  value: unknown
): IngestStatusSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<IngestStatusSnapshot>;
  if (typeof raw.runId !== "string" || typeof raw.namespaceName !== "string") {
    return null;
  }

  if (typeof raw.datasetPath !== "string") {
    return null;
  }

  return createIngestStatusSnapshot({
    ...raw,
    runId: raw.runId,
    namespaceName: raw.namespaceName,
    datasetPath: raw.datasetPath,
  });
}
