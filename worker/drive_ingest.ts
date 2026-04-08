import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import dotenv from "dotenv";
import { GoogleAuth } from "google-auth-library";
import { parseOffice } from "officeparser";
import { PDFParse } from "pdf-parse";
import sharp from "sharp";
import { createScheduler, createWorker, PSM } from "tesseract.js";
import { ConvexHttpClient } from "convex/browser";

dotenv.config({ path: ".env.local", override: false, quiet: true });
dotenv.config({ override: false, quiet: true });

const DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_LIST_PAGE_SIZE = Math.min(
  1_000,
  getIntegerEnv("DRIVE_LIST_PAGE_SIZE", 200, 1)
);
const MIN_CHUNK_SIZE = 100;
const TRANSIENT_MAX_ATTEMPTS = 5;
const HIGH_ERROR_WINDOW_MS = 10 * 60 * 1000;
const HIGH_ERROR_THRESHOLD = 8;

type SupportedFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  md5Checksum?: string;
  sizeBytes?: number;
  webViewLink?: string;
  relativePath: string;
};

type ChunkPayload = {
  order: number;
  text: string;
};

type ParsedFileResult = {
  text: string;
  parserMode: "text" | "ocr-pdf" | "ocr-image";
  skipReason?: string;
};

type WorkerTarget = {
  folderId: string;
  namespace: string;
  namespaceId: string;
};

type FileState = {
  fileId: string;
  status: "processing" | "done" | "completed" | "failed";
  lastProcessedAt: number;
  updatedAt: number;
  attempts: number;
  retryAfter: number | null;
  terminalFailure: boolean;
  claimedByWorkerId: number | null;
  tokenCount: number;
  indexedTokenCount?: number;
  chunkCount: number;
  indexedChunkCount?: number;
  batchCount: number;
  completedBatchCount: number;
  expectedChunkCount: number;
  skipReason: string | null;
};

type ClaimResult = {
  claimed: boolean;
  reason: string;
  attempts: number;
  previousBatchCount: number;
  previousChunkCount: number;
};

type CompleteResult = {
  fileId: string;
  status: "done";
  chunkCount: number;
  batchCount: number;
  processedChunks: number | null;
};

type FailureResult = {
  fileId: string;
  status: "failed";
  attempts: number;
  willRetry: boolean;
  retryAfter: number | null;
  terminalFailure: boolean;
};

type DriveListResponse = {
  files?: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    md5Checksum?: string;
    size?: string;
    webViewLink?: string;
  }>;
  nextPageToken?: string;
};

type ScanSummary = {
  totalSupportedFiles: number;
  totalPages: number;
  matchedFiles: number;
  attemptedFiles: number;
};

type RuntimeStats = {
  startedAt: number;
  lastRateLogAt: number;
  filesDone: number;
  filesSkipped: number;
  filesFailed: number;
  filesRetried: number;
  chunksIndexed: number;
};

const convexUrl = mustGetEnv("CONVEX_URL");
const driveFolderId = process.env.DRIVE_FOLDER_ID?.trim() || null;
const serviceAccountJson =
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim() ||
  null;

const BATCH_SIZE = getIntegerEnv(["BATCH_SIZE", "DRIVE_CHUNK_BATCH_SIZE"], 40, 1);
const FILE_CONCURRENCY = getIntegerEnv(
  ["FILE_CONCURRENCY", "DRIVE_FILE_CONCURRENCY"],
  1,
  1
);
const UPLOAD_CONCURRENCY = getIntegerEnv(
  ["UPLOAD_CONCURRENCY", "DRIVE_UPLOAD_CONCURRENCY"],
  3,
  1
);
const TOTAL_WORKERS = getIntegerEnv("TOTAL_WORKERS", 5, 1);
const WORKER_ID = getIntegerEnv("WORKER_ID", 0, 0);
const POLL_INTERVAL_MS = getIntegerEnv("POLL_INTERVAL_MS", 5_000, 1_000);
const MAX_RETRIES = getIntegerEnv("MAX_RETRIES", 2, 1);
const OCR_MAX_MB = getIntegerEnv("OCR_MAX_MB", 8, 1);
const OCR_MAX_BYTES = OCR_MAX_MB * 1024 * 1024;
const CLAIM_TIMEOUT_MS = getIntegerEnv(
  ["PROCESSING_CLAIM_TIMEOUT_MS", "CLAIM_TIMEOUT_MS"],
  30 * 60 * 1000,
  60_000
);
const PDF_RENDER_DPI = getIntegerEnv(["PDF_RENDER_DPI", "LITEPARSE_DPI"], 150, 72);
const PDF_MAX_PAGES = getIntegerEnv(["PDF_MAX_PAGES", "LITEPARSE_MAX_PAGES"], 10_000, 1);
const SMALL_PDF_WINDOW_PAGES = getIntegerEnv("DRIVE_SMALL_PDF_WINDOW_PAGES", 160, 10);
const MEDIUM_PDF_WINDOW_PAGES = getIntegerEnv("DRIVE_MEDIUM_PDF_WINDOW_PAGES", 96, 10);
const LARGE_PDF_WINDOW_PAGES = getIntegerEnv("DRIVE_LARGE_PDF_WINDOW_PAGES", 48, 10);
const MEDIUM_PDF_BYTES = getIntegerEnv("DRIVE_MEDIUM_PDF_BYTES", 20 * 1024 * 1024, 1);
const LARGE_PDF_BYTES = getIntegerEnv("DRIVE_LARGE_PDF_BYTES", 60 * 1024 * 1024, 1);
const OCR_TEXT_THRESHOLD_CHARS = getIntegerEnv("OCR_TEXT_THRESHOLD_CHARS", 150, 1);
const OCR_TEXT_THRESHOLD_TOKENS = getIntegerEnv("OCR_TEXT_THRESHOLD_TOKENS", 20, 1);
const POLL_STAGGER_MS = getIntegerEnv("POLL_STAGGER_MS", 1_500, 0);
const POLL_JITTER_MS = getIntegerEnv("POLL_JITTER_MS", 1_500, 0);
const WORKER_LABEL = `${WORKER_ID}/${TOTAL_WORKERS}`;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL?.trim() || null;
const TESSDATA_PATH = existsSync(path.join(process.cwd(), "eng.traineddata"))
  ? process.cwd()
  : undefined;
const OCR_CACHE_PATH = path.join(tmpdir(), "ragbot-tesseract-cache");
const PDF_RENDER_SCALE = Math.max(1, Number((PDF_RENDER_DPI / 72).toFixed(2)));

if (WORKER_ID < 0 || WORKER_ID >= TOTAL_WORKERS) {
  throw new Error(`WORKER_ID must be between 0 and ${TOTAL_WORKERS - 1}.`);
}

const convex = new ConvexHttpClient(convexUrl);
const auth =
  driveFolderId && serviceAccountJson
    ? new GoogleAuth({
        credentials: parseServiceAccountJson(serviceAccountJson),
        scopes: [DRIVE_READONLY_SCOPE],
      })
    : null;

const cpuCount = Math.max(1, cpus().length);
const ocrWorkerCount = Math.max(
  1,
  Math.min(
    2,
    getIntegerEnv(["OCR_NUM_WORKERS", "LITEPARSE_NUM_WORKERS"], Math.max(1, cpuCount - 1), 1)
  )
);

let authClientPromise: Promise<Awaited<ReturnType<GoogleAuth["getClient"]>>> | null = null;
let ocrSchedulerPromise: Promise<ReturnType<typeof createScheduler>> | null = null;
let namespaceIdCache: string | null = null;
let shuttingDown = false;
let lastHighErrorNotificationAt = 0;
const recentFailureTimestamps: number[] = [];
const stats: RuntimeStats = {
  startedAt: Date.now(),
  lastRateLogAt: 0,
  filesDone: 0,
  filesSkipped: 0,
  filesFailed: 0,
  filesRetried: 0,
  chunksIndexed: 0,
};

function mustGetEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function getOptionalEnv(names: string | string[]) {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function getIntegerEnv(names: string | string[], fallback: number, minimum = 0) {
  const rawValue = getOptionalEnv(names);
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
}

function parseServiceAccountJson(rawValue: string) {
  const trimmed = rawValue.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const normalized = unquoted.startsWith("$/") ? unquoted.slice(1) : unquoted;
  const base64Candidate = normalized.replace(/\s+/g, "");
  const jsonText = existsSync(normalized)
    ? readFileSync(normalized, "utf8")
    : normalized.startsWith("{")
      ? normalized
      : Buffer.from(base64Candidate, "base64").toString("utf8");

  let parsed: {
    client_email?: string;
    private_key?: string;
  };

  try {
    parsed = JSON.parse(jsonText) as {
      client_email?: string;
      private_key?: string;
    };
  } catch (error) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON must be valid raw JSON, base64-encoded JSON, or a readable file path. ${formatError(error)}`
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing required fields.");
  }

  return {
    ...parsed,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getNextPollDelayMs() {
  return POLL_INTERVAL_MS + WORKER_ID * POLL_STAGGER_MS + randomBetween(0, POLL_JITTER_MS);
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "download";
}

function countTokens(text: string) {
  return text.match(/\S+/g)?.length ?? 0;
}

function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text: string) {
  const normalized = normalizeText(text);
  if (normalized.length < MIN_CHUNK_SIZE) {
    return [];
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const chunks: ChunkPayload[] = [];
  let current = "";
  let order = 0;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= 500) {
      current = candidate;
      continue;
    }

    if (current.length >= MIN_CHUNK_SIZE) {
      chunks.push({ order, text: current });
      order += 1;
    }

    if (word.length > 500) {
      let remainder = word;
      while (remainder.length > 500) {
        const slice = remainder.slice(0, 500).trim();
        if (slice.length >= MIN_CHUNK_SIZE) {
          chunks.push({ order, text: slice });
          order += 1;
        }
        remainder = remainder.slice(500).trim();
      }
      current = remainder;
      continue;
    }

    current = word;
  }

  if (current.length >= MIN_CHUNK_SIZE) {
    chunks.push({ order, text: current });
  }

  return chunks;
}

function buildDriveBatchKey(fileId: string, batchIndex: number) {
  return `${fileId}::batch::${batchIndex}`;
}

function buildBatchContentHash(
  file: SupportedFile,
  batchIndex: number,
  chunks: ChunkPayload[]
) {
  const hash = createHash("sha256");
  hash.update(file.id);
  hash.update("\n");
  hash.update(file.md5Checksum ?? "");
  hash.update("\n");
  hash.update(file.modifiedTime ?? "");
  hash.update("\n");
  hash.update(String(file.sizeBytes ?? 0));
  hash.update("\n");
  hash.update(String(batchIndex));
  hash.update("\n");

  for (const chunk of chunks) {
    hash.update(String(chunk.order));
    hash.update("\n");
    hash.update(chunk.text);
    hash.update("\n");
  }

  return hash.digest("hex");
}

function simpleHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isMyFile(fileId: string, workerId: number, totalWorkers: number) {
  return simpleHash(fileId) % totalWorkers === workerId;
}

function isPdfFile(file: Pick<SupportedFile, "mimeType" | "name">) {
  return file.mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isImageFile(file: Pick<SupportedFile, "mimeType" | "name">) {
  return (
    file.mimeType.startsWith("image/") ||
    /\.(png|jpe?g|gif|bmp|tiff?|webp|heic)$/i.test(file.name)
  );
}

function isPlainTextFile(file: Pick<SupportedFile, "mimeType" | "name">) {
  return (
    /^text\//i.test(file.mimeType) ||
    /\.(txt|md|csv)$/i.test(file.name)
  );
}

function isOfficeDocumentFile(file: Pick<SupportedFile, "mimeType" | "name">) {
  return /\.(docx|pptx|xlsx)$/i.test(file.name);
}

function isSupportedFile(file: Pick<SupportedFile, "mimeType" | "name">) {
  if (isPdfFile(file) || isImageFile(file)) {
    return true;
  }

  return /\.(docx|pptx|xlsx|txt|md|csv)$/i.test(file.name);
}

function looksScanned(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.length < OCR_TEXT_THRESHOLD_CHARS ||
    countTokens(normalized) < OCR_TEXT_THRESHOLD_TOKENS
  );
}

function getPdfWindowPageSize(file: SupportedFile) {
  const sizeBytes = file.sizeBytes ?? 0;
  if (sizeBytes >= LARGE_PDF_BYTES) {
    return LARGE_PDF_WINDOW_PAGES;
  }
  if (sizeBytes >= MEDIUM_PDF_BYTES) {
    return MEDIUM_PDF_WINDOW_PAGES;
  }
  return SMALL_PDF_WINDOW_PAGES;
}

function shouldTreatAsDone(status: FileState["status"] | undefined) {
  return status === "done" || status === "completed";
}

function shouldRetryFile(state: FileState | undefined) {
  if (!state) {
    return true;
  }

  if (shouldTreatAsDone(state.status)) {
    return false;
  }

  if (state.status === "processing") {
    return Date.now() - state.updatedAt >= CLAIM_TIMEOUT_MS;
  }

  if (state.terminalFailure || state.attempts >= MAX_RETRIES) {
    return false;
  }

  if (typeof state.retryAfter === "number" && state.retryAfter > Date.now()) {
    return false;
  }

  return true;
}

function pruneFailureWindow() {
  const cutoff = Date.now() - HIGH_ERROR_WINDOW_MS;
  while (recentFailureTimestamps.length > 0 && recentFailureTimestamps[0] < cutoff) {
    recentFailureTimestamps.shift();
  }
}

async function notify(message: string) {
  if (!DISCORD_WEBHOOK_URL) {
    return;
  }

  try {
    await retryTransient("discord notify", async () => {
      const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: message.slice(0, 1900),
        }),
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed (${response.status})`);
      }
    }, 3);
  } catch (error) {
    console.error(
      `[worker ${WORKER_LABEL}] failed to send Discord notification: ${formatError(error)}`
    );
  }
}

async function recordFailure(kind: string, message: string) {
  recentFailureTimestamps.push(Date.now());
  pruneFailureWindow();

  if (
    recentFailureTimestamps.length >= HIGH_ERROR_THRESHOLD &&
    Date.now() - lastHighErrorNotificationAt > HIGH_ERROR_WINDOW_MS
  ) {
    lastHighErrorNotificationAt = Date.now();
    await notify(
      `High error rate on worker ${WORKER_LABEL}: ${recentFailureTimestamps.length} ${kind} failures in the last 10 minutes. Latest: ${message}`
    );
  }
}

function computeBackoffDelayMs(attempt: number) {
  return Math.min(30_000, 1_000 * 2 ** (attempt - 1)) + randomBetween(50, 300);
}

function isRetriableError(error: unknown) {
  const message = formatError(error).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500") ||
    message.includes("temporarily unavailable")
  );
}

async function retryTransient<T>(
  label: string,
  operation: () => Promise<T>,
  maxAttempts = TRANSIENT_MAX_ATTEMPTS
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetriableError(error) || attempt >= maxAttempts) {
        break;
      }

      const delayMs = computeBackoffDelayMs(attempt);
      console.warn(
        `[worker ${WORKER_LABEL}] ${label} failed on attempt ${attempt}/${maxAttempts}: ${formatError(error)}`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function createLimiter(concurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  function flushQueue() {
    while (activeCount < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      activeCount += 1;
      next();
    }
  }

  return async function runLimited<T>(task: () => Promise<T>) {
    return await new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void task()
          .then(resolve, reject)
          .finally(() => {
            activeCount = Math.max(0, activeCount - 1);
            flushQueue();
          });
      });
      flushQueue();
    });
  };
}

const scheduleUpload = createLimiter(UPLOAD_CONCURRENCY);

function makeBatches<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  if (items.length === 0) {
    return;
  }

  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) {
          return;
        }
        await worker(items[currentIndex], currentIndex);
      }
    }
  );

  await Promise.all(runners);
}

async function getAuthClient() {
  if (!auth) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON and DRIVE_FOLDER_ID are required.");
  }

  if (!authClientPromise) {
    authClientPromise = auth.getClient();
  }

  return await authClientPromise;
}

async function getAccessToken() {
  const client = await getAuthClient();
  const token = await client.getAccessToken();
  const value = typeof token === "string" ? token : token?.token;

  if (!value) {
    throw new Error("Unable to acquire a Google Drive access token.");
  }

  return value;
}

async function driveFetch(pathname: string, init: RequestInit = {}, retryUnauthorized = true) {
  const url = pathname.startsWith("http") ? pathname : `${DRIVE_API_BASE_URL}${pathname}`;
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status === 401 && retryUnauthorized) {
    authClientPromise = null;
    return await driveFetch(pathname, init, false);
  }

  if (!response.ok) {
    throw new Error(`Drive API request failed (${response.status}): ${await response.text()}`);
  }

  return response;
}

async function driveJson<T>(pathname: string, params: Record<string, string | undefined>) {
  const url = new URL(`${DRIVE_API_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await retryTransient("drive json", async () => await driveFetch(url.toString()));
  return (await response.json()) as T;
}

async function runQuery<T>(name: string, args: Record<string, unknown>) {
  return await retryTransient(
    `convex query ${name}`,
    async () => (await convex.query(name as never, args as never)) as T
  );
}

async function runMutation<T>(name: string, args: Record<string, unknown>) {
  return (await convex.mutation(name as never, args as never)) as T;
}

async function runSafeMutation<T>(name: string, args: Record<string, unknown>) {
  return await retryTransient(
    `convex mutation ${name}`,
    async () => (await convex.mutation(name as never, args as never)) as T
  );
}

async function runSafeAction<T>(name: string, args: Record<string, unknown>) {
  return await retryTransient(
    `convex action ${name}`,
    async () => (await convex.action(name as never, args as never)) as T
  );
}

function buildPdfPageList(startPage: number, endPage: number) {
  const pages: number[] = [];
  for (let page = startPage; page <= endPage && page <= PDF_MAX_PAGES; page += 1) {
    pages.push(page);
  }
  return pages;
}

async function withPdfParser<T>(buffer: Buffer, work: (parser: PDFParse) => Promise<T>) {
  const parser = new PDFParse({ data: buffer });
  try {
    return await work(parser);
  } finally {
    await parser.destroy();
  }
}

async function getOcrScheduler() {
  if (!ocrSchedulerPromise) {
    ocrSchedulerPromise = (async () => {
      await mkdir(OCR_CACHE_PATH, { recursive: true });

      const scheduler = createScheduler();
      for (let index = 0; index < ocrWorkerCount; index += 1) {
        const worker = await createWorker("eng", 1, {
          cachePath: OCR_CACHE_PATH,
          gzip: !TESSDATA_PATH,
          ...(TESSDATA_PATH ? { langPath: TESSDATA_PATH } : {}),
          errorHandler: (error) => {
            console.error(
              `[worker ${WORKER_LABEL}] tesseract worker error: ${formatError(error)}`
            );
          },
        });
        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: PSM.AUTO,
          user_defined_dpi: String(PDF_RENDER_DPI),
        });
        scheduler.addWorker(worker);
      }

      return scheduler;
    })();
  }

  return await ocrSchedulerPromise;
}

async function terminateOcrScheduler() {
  if (!ocrSchedulerPromise) {
    return;
  }

  try {
    const scheduler = await ocrSchedulerPromise;
    await scheduler.terminate();
  } catch (error) {
    console.warn(
      `[worker ${WORKER_LABEL}] failed to terminate OCR scheduler: ${formatError(error)}`
    );
  } finally {
    ocrSchedulerPromise = null;
  }
}

async function recognizeImageBuffer(imageBuffer: Buffer, label: string) {
  const scheduler = await getOcrScheduler();
  const preparedImage = await sharp(imageBuffer).rotate().grayscale().normalize().png().toBuffer();
  const result = await retryTransient(`ocr ${label}`, async () => {
    return await scheduler.addJob("recognize", preparedImage, { rotateAuto: true });
  });
  return normalizeText(result.data.text ?? "");
}

async function parseOfficeDocument(filePath: string) {
  const buffer = await readFile(filePath);
  const ast = await parseOffice(buffer, {
    extractAttachments: false,
    includeRawContent: false,
    ocr: false,
    outputErrorToConsole: false,
  });
  return normalizeText(ast.toText());
}

async function parseTextFile(filePath: string) {
  return normalizeText(await readFile(filePath, "utf8"));
}

async function parseFile(filePath: string, file: SupportedFile): Promise<ParsedFileResult> {
  if (isImageFile(file)) {
    if ((file.sizeBytes ?? 0) > OCR_MAX_BYTES) {
      return {
        text: "",
        parserMode: "ocr-image",
        skipReason: `image exceeds OCR max size of ${OCR_MAX_MB}MB`,
      };
    }

    const imageBuffer = await readFile(filePath);
    return {
      text: await recognizeImageBuffer(imageBuffer, file.relativePath),
      parserMode: "ocr-image",
    };
  }

  if (isPlainTextFile(file)) {
    return {
      text: await parseTextFile(filePath),
      parserMode: "text",
    };
  }

  if (isOfficeDocumentFile(file)) {
    return {
      text: await retryTransient("office parse", async () => await parseOfficeDocument(filePath)),
      parserMode: "text",
    };
  }

  return {
    text: "",
    parserMode: "text",
    skipReason: `unsupported file type: ${file.mimeType}`,
  };
}

async function parsePdfWindow(fileBuffer: Buffer, startPage: number, endPage: number) {
  const pageRange = `${startPage}-${endPage}`;
  const partialPages = buildPdfPageList(startPage, endPage);

  if (partialPages.length === 0) {
    return {
      pageCount: 0,
      parserMode: "text" as const,
      text: "",
    };
  }

  return await retryTransient(`pdf window ${pageRange}`, async () => {
    return await withPdfParser(fileBuffer, async (parser) => {
      const textResult = await parser.getText({ partial: partialPages });
      const pageCount = textResult.pages.length;
      const primaryText = normalizeText(textResult.text ?? "");

      if (pageCount === 0) {
        return {
          pageCount: 0,
          parserMode: "text" as const,
          text: "",
        };
      }

      if (!looksScanned(primaryText)) {
        return {
          pageCount,
          parserMode: "text" as const,
          text: primaryText,
        };
      }

      const screenshots = await parser.getScreenshot({
        partial: partialPages,
        imageBuffer: true,
        imageDataUrl: false,
        scale: PDF_RENDER_SCALE,
      });

      const ocrText = normalizeText(
        (
          await Promise.all(
            screenshots.pages.map(async (page, index) => {
              const pageBuffer = Buffer.from(page.data);
              return await recognizeImageBuffer(pageBuffer, `${pageRange}:${index + 1}`);
            })
          )
        )
          .filter(Boolean)
          .join("\n\n")
      );
      const bestText = ocrText.length >= primaryText.length ? ocrText : primaryText;

      return {
        pageCount,
        parserMode:
          ocrText.length >= primaryText.length ? ("ocr-pdf" as const) : ("text" as const),
        text: bestText,
      };
    });
  });
}

async function ensureNamespaceId(namespace: string) {
  if (namespaceIdCache) {
    return namespaceIdCache;
  }

  const result = await runSafeAction<{ namespaceId: string }>("ingest:ensureNamespaceId", {
    namespace,
  });
  namespaceIdCache = result.namespaceId;
  return namespaceIdCache;
}

async function resolveTarget(): Promise<WorkerTarget | null> {
  if (!auth || !driveFolderId) {
    return null;
  }

  const namespace = `drive_${driveFolderId}`;
  const namespaceId = await ensureNamespaceId(namespace);
  return {
    folderId: driveFolderId,
    namespace,
    namespaceId,
  };
}

async function listFolderPage(
  folderIdValue: string,
  pageToken: string | undefined
): Promise<DriveListResponse> {
  return await driveJson<DriveListResponse>("/files", {
    q: `'${folderIdValue}' in parents and trashed = false`,
    fields:
      "nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size,webViewLink)",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    pageSize: String(DRIVE_LIST_PAGE_SIZE),
    pageToken,
  });
}

async function downloadFileToTemp(file: SupportedFile) {
  const directory = await mkdtemp(path.join(tmpdir(), "ragbot-drive-"));
  const filePath = path.join(directory, `${file.id}-${sanitizeFileName(file.name)}`);

  try {
    await retryTransient(`download ${file.relativePath}`, async () => {
      const response = await driveFetch(`/files/${file.id}?alt=media`, {
        method: "GET",
      });

      if (!response.body) {
        throw new Error("Drive download response had no body.");
      }

      await pipeline(
        Readable.fromWeb(response.body as NodeReadableStream),
        createWriteStream(filePath)
      );
    });

    return {
      directory,
      filePath,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function pruneFileBatches(
  target: WorkerTarget,
  file: SupportedFile,
  fromBatchIndex: number,
  toBatchIndexExclusive: number
) {
  if (toBatchIndexExclusive <= fromBatchIndex) {
    return;
  }

  await runSafeAction("ingest:pruneFileBatches", {
    namespace: target.namespace,
    fileId: file.id,
    fromBatchIndex,
    toBatchIndexExclusive,
  });
}

async function touchFileProcessing(
  target: WorkerTarget,
  file: SupportedFile,
  progress?: Partial<{
    batchCount: number;
    chunkCount: number;
    expectedChunkCount: number;
  }>
) {
  try {
    await runSafeMutation("drive:touchFileProcessing", {
      namespace: target.namespace,
      fileId: file.id,
      workerId: WORKER_ID,
      batchCount: progress?.batchCount,
      chunkCount: progress?.chunkCount,
      expectedChunkCount: progress?.expectedChunkCount,
    });
  } catch (error) {
    console.warn(
      `[worker ${WORKER_LABEL}] failed to refresh lease for ${file.relativePath}: ${formatError(error)}`
    );
  }
}

function startLeaseHeartbeat(target: WorkerTarget, file: SupportedFile) {
  const intervalMs = Math.max(10_000, Math.min(30_000, Math.floor(CLAIM_TIMEOUT_MS / 3)));
  const timer = setInterval(() => {
    void touchFileProcessing(target, file);
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => clearInterval(timer);
}

async function claimFile(target: WorkerTarget, file: SupportedFile) {
  return await runMutation<ClaimResult>("drive:claimFileForProcessing", {
    namespace: target.namespace,
    folderId: target.folderId,
    fileId: file.id,
    fileName: file.name,
    relativePath: file.relativePath,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink,
    modifiedTime: file.modifiedTime,
    md5Checksum: file.md5Checksum,
    sizeBytes: file.sizeBytes,
    workerId: WORKER_ID,
    maxRetries: MAX_RETRIES,
    claimTimeoutMs: CLAIM_TIMEOUT_MS,
  });
}

async function completeFile(
  target: WorkerTarget,
  file: SupportedFile,
  args: {
    chunkCount: number;
    batchCount: number;
    tokenCount: number;
    indexedChunkCount: number;
    indexedTokenCount: number;
    skipReason?: string;
  }
) {
  return await runSafeMutation<CompleteResult>("drive:completeFileProcessing", {
    namespace: target.namespace,
    folderId: target.folderId,
    fileId: file.id,
    fileName: file.name,
    relativePath: file.relativePath,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink,
    modifiedTime: file.modifiedTime,
    md5Checksum: file.md5Checksum,
    sizeBytes: file.sizeBytes,
    chunkCount: args.chunkCount,
    batchCount: args.batchCount,
    tokenCount: args.tokenCount,
    indexedChunkCount: args.indexedChunkCount,
    indexedTokenCount: args.indexedTokenCount,
    workerId: WORKER_ID,
    skipReason: args.skipReason,
  });
}

async function failFile(
  target: WorkerTarget,
  file: SupportedFile,
  errorMessage: string,
  batchCount: number,
  attempt: number
) {
  const retryAfterMs = computeBackoffDelayMs(Math.max(1, attempt));
  return await runSafeMutation<FailureResult>("drive:failFileProcessing", {
    namespace: target.namespace,
    folderId: target.folderId,
    fileId: file.id,
    fileName: file.name,
    relativePath: file.relativePath,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink,
    modifiedTime: file.modifiedTime,
    md5Checksum: file.md5Checksum,
    sizeBytes: file.sizeBytes,
    errorMessage,
    batchCount,
    workerId: WORKER_ID,
    maxRetries: MAX_RETRIES,
    retryAfterMs,
  });
}

async function uploadChunkBatches(
  target: WorkerTarget,
  file: SupportedFile,
  chunks: ChunkPayload[],
  batchIndexOffset: number
) {
  if (chunks.length === 0) {
    return {
      batchCount: 0,
      tokenCount: 0,
      indexedChunkCount: 0,
      indexedTokenCount: 0,
      createdBatches: 0,
    };
  }

  const chunkBatches = makeBatches(chunks, BATCH_SIZE);
  const results = await Promise.all(
    chunkBatches.map((chunkBatch, batchOffset) =>
      scheduleUpload(async () => {
        const batchIndex = batchIndexOffset + batchOffset;
        const tokenCount = chunkBatch.reduce((total, chunk) => total + countTokens(chunk.text), 0);
        const highestChunkCount = (chunkBatch[chunkBatch.length - 1]?.order ?? -1) + 1;

        const result = await runSafeAction<{
          batchIndex: number;
          created: boolean;
          insertedChunks: number;
          status: string;
        }>("ingest:addChunksBatch", {
          namespaceId: target.namespaceId,
          fileId: file.id,
          fileName: file.name,
          relativePath: file.relativePath,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          modifiedTime: file.modifiedTime,
          batchIndex,
          totalBatches: chunkBatches.length + batchIndexOffset,
          contentHash: buildBatchContentHash(file, batchIndex, chunkBatch),
          chunks: chunkBatch,
          namespace: target.namespace,
        });

        await touchFileProcessing(target, file, {
          batchCount: batchIndex + 1,
          chunkCount: highestChunkCount,
        });

        return {
          batchIndex: result.batchIndex,
          created: result.created,
          tokenCount,
          insertedChunks: result.insertedChunks,
        };
      })
    )
  );

  return results.reduce(
    (accumulator, result) => ({
      batchCount: accumulator.batchCount + 1,
      tokenCount: accumulator.tokenCount + result.tokenCount,
      indexedChunkCount: accumulator.indexedChunkCount + result.insertedChunks,
      indexedTokenCount:
        accumulator.indexedTokenCount + (result.created ? result.tokenCount : 0),
      createdBatches: accumulator.createdBatches + (result.created ? 1 : 0),
    }),
    {
      batchCount: 0,
      tokenCount: 0,
      indexedChunkCount: 0,
      indexedTokenCount: 0,
      createdBatches: 0,
    }
  );
}

async function uploadPdfFileInWindows(
  target: WorkerTarget,
  fileBuffer: Buffer,
  file: SupportedFile
) {
  const pageWindowSize = getPdfWindowPageSize(file);
  let nextChunkOrder = 0;
  let nextBatchIndex = 0;
  let totalTokenCount = 0;
  let indexedChunkCount = 0;
  let indexedTokenCount = 0;
  let usedOcr = false;

  for (let startPage = 1; startPage <= PDF_MAX_PAGES && !shuttingDown; startPage += pageWindowSize) {
    const endPage = startPage + pageWindowSize - 1;
    const pageRange = `${startPage}-${endPage}`;
    const windowResult = await parsePdfWindow(fileBuffer, startPage, endPage);

    if (windowResult.pageCount === 0) {
      break;
    }

    usedOcr = usedOcr || windowResult.parserMode === "ocr-pdf";
    const chunks = chunkText(windowResult.text).map((chunk, index) => ({
      order: nextChunkOrder + index,
      text: chunk.text,
    }));

    await touchFileProcessing(target, file, {
      batchCount: nextBatchIndex,
      chunkCount: nextChunkOrder,
      expectedChunkCount: nextChunkOrder + chunks.length,
    });

    const uploaded = await uploadChunkBatches(target, file, chunks, nextBatchIndex);
    nextChunkOrder += chunks.length;
    nextBatchIndex += uploaded.batchCount;
    totalTokenCount += uploaded.tokenCount;
    indexedChunkCount += uploaded.indexedChunkCount;
    indexedTokenCount += uploaded.indexedTokenCount;

    console.log(
      `[worker ${WORKER_LABEL}] ${file.relativePath} pages ${pageRange}: chunks=${chunks.length} mode=${windowResult.parserMode}`
    );

    if (windowResult.pageCount < pageWindowSize) {
      break;
    }
  }

  return {
    chunkCount: nextChunkOrder,
    batchCount: nextBatchIndex,
    tokenCount: totalTokenCount,
    indexedChunkCount,
    indexedTokenCount,
    parserMode: usedOcr ? "ocr-pdf" : "text",
  };
}

async function processFile(target: WorkerTarget, file: SupportedFile) {
  let claim: ClaimResult;
  try {
    claim = await claimFile(target, file);
  } catch (error) {
    console.error(
      `[worker ${WORKER_LABEL}] failed to claim ${file.relativePath}: ${formatError(error)}`
    );
    await recordFailure("claim", formatError(error));
    return;
  }

  if (!claim.claimed) {
    return;
  }

  const stopHeartbeat = startLeaseHeartbeat(target, file);
  let totalBatchCount = 0;

  try {
    console.log(
      `[worker ${WORKER_LABEL}] processing ${file.relativePath} attempt=${claim.attempts}/${MAX_RETRIES}`
    );

    const { directory, filePath } = await downloadFileToTemp(file);

    try {
      let chunkCount = 0;
      let tokenCount = 0;
      let indexedChunkCount = 0;
      let indexedTokenCount = 0;
      let parserMode = "text";
      let skipReason: string | undefined;

      if (isPdfFile(file)) {
        const fileBuffer = await readFile(filePath);
        const parsedPdf = await uploadPdfFileInWindows(target, fileBuffer, file);
        totalBatchCount = parsedPdf.batchCount;
        chunkCount = parsedPdf.chunkCount;
        tokenCount = parsedPdf.tokenCount;
        indexedChunkCount = parsedPdf.indexedChunkCount;
        indexedTokenCount = parsedPdf.indexedTokenCount;
        parserMode = parsedPdf.parserMode;

        if (chunkCount === 0) {
          skipReason = `no extractable text after ${parserMode}`;
        }
      } else {
        const parsed = await parseFile(filePath, file);
        parserMode = parsed.parserMode;
        skipReason = parsed.skipReason;

        if (!skipReason) {
          const chunks = chunkText(parsed.text);
          chunkCount = chunks.length;
          totalBatchCount = Math.ceil(chunks.length / BATCH_SIZE);
          tokenCount = chunks.reduce((total, chunk) => total + countTokens(chunk.text), 0);

          await touchFileProcessing(target, file, {
            batchCount: totalBatchCount,
            chunkCount,
            expectedChunkCount: chunkCount,
          });

          if (chunks.length === 0) {
            skipReason = `no extractable text after ${parserMode}`;
          } else {
            const uploaded = await uploadChunkBatches(target, file, chunks, 0);
            indexedChunkCount = uploaded.indexedChunkCount;
            indexedTokenCount = uploaded.indexedTokenCount;
          }
        }
      }

      if (claim.previousBatchCount > totalBatchCount) {
        await pruneFileBatches(target, file, totalBatchCount, claim.previousBatchCount);
      }

      const completed = await completeFile(target, file, {
        chunkCount,
        batchCount: totalBatchCount,
        tokenCount,
        indexedChunkCount,
        indexedTokenCount,
        skipReason,
      });

      if (chunkCount === 0) {
        stats.filesSkipped += 1;
        console.log(
          `[worker ${WORKER_LABEL}] skipped ${file.relativePath}: ${skipReason ?? "empty content"}`
        );
      } else {
        stats.filesDone += 1;
        stats.chunksIndexed += indexedChunkCount;
        console.log(
          `[worker ${WORKER_LABEL}] done ${file.relativePath}: chunks=${completed.chunkCount} batches=${completed.batchCount} mode=${parserMode}`
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch (error) {
    const message = formatError(error);
    console.error(`[worker ${WORKER_LABEL}] failed ${file.relativePath}: ${message}`);
    await recordFailure("file", message);

    try {
      const currentState = await runQuery<FileState[]>("drive:getProcessedFileStates", {
        namespace: target.namespace,
        fileIds: [file.id],
      });
      const latest = currentState[0];

      if (latest && shouldTreatAsDone(latest.status)) {
        stats.filesDone += 1;
        stats.chunksIndexed += latest.chunkCount;
        console.warn(
          `[worker ${WORKER_LABEL}] ${file.relativePath} was already finalized despite the error, skipping failure mark`
        );
        return;
      }
    } catch (stateError) {
      console.warn(
        `[worker ${WORKER_LABEL}] could not confirm final state for ${file.relativePath}: ${formatError(stateError)}`
      );
    }

    let failure: FailureResult;
    try {
      failure = await failFile(
        target,
        file,
        message,
        Math.max(totalBatchCount, claim.previousBatchCount),
        claim.attempts
      );
    } catch (failureError) {
      console.error(
        `[worker ${WORKER_LABEL}] failed to record failure for ${file.relativePath}: ${formatError(failureError)}`
      );
      await recordFailure("file-state", formatError(failureError));
      return;
    }

    if (failure.willRetry) {
      stats.filesRetried += 1;
      console.warn(
        `[worker ${WORKER_LABEL}] retry scheduled for ${file.relativePath}: attempt=${failure.attempts}/${MAX_RETRIES}`
      );
    } else {
      stats.filesFailed += 1;
      await notify(
        `Failed ${file.relativePath} on worker ${WORKER_LABEL} after ${failure.attempts} attempts: ${message}`
      );
    }
  } finally {
    stopHeartbeat();
    maybeLogRates(true);
  }
}

function maybeLogRates(force = false) {
  const now = Date.now();
  if (!force && now - stats.lastRateLogAt < 60_000) {
    return;
  }

  const elapsedMinutes = Math.max(1 / 60, (now - stats.startedAt) / 60_000);
  const filesResolved = stats.filesDone + stats.filesSkipped + stats.filesFailed;
  const filesPerMinute = (filesResolved / elapsedMinutes).toFixed(2);
  const chunksPerMinute = (stats.chunksIndexed / elapsedMinutes).toFixed(2);

  console.log(
    `[worker ${WORKER_LABEL}] rate files=${filesResolved} chunks=${stats.chunksIndexed} fpm=${filesPerMinute} cpm=${chunksPerMinute} retried=${stats.filesRetried}`
  );
  stats.lastRateLogAt = now;
}

async function scanDriveFiles(target: WorkerTarget): Promise<ScanSummary> {
  const queue: Array<{ folderId: string; relativePrefix: string; pageToken?: string }> = [
    { folderId: target.folderId, relativePrefix: "" },
  ];

  let totalSupportedFiles = 0;
  let totalPages = 0;
  let matchedFiles = 0;
  let attemptedFiles = 0;

  while (queue.length > 0 && !shuttingDown) {
    const current = queue[0];
    const response = await listFolderPage(current.folderId, current.pageToken);
    totalPages += 1;
    current.pageToken = response.nextPageToken;

    const candidateFiles: SupportedFile[] = [];

    for (const child of response.files ?? []) {
      const relativePath = current.relativePrefix
        ? `${current.relativePrefix}/${child.name}`
        : child.name;

      if (child.mimeType === DRIVE_FOLDER_MIME_TYPE) {
        queue.push({
          folderId: child.id,
          relativePrefix: relativePath,
        });
        continue;
      }

      const file: SupportedFile = {
        id: child.id,
        name: child.name,
        mimeType: child.mimeType,
        modifiedTime: child.modifiedTime,
        md5Checksum: child.md5Checksum,
        sizeBytes:
          typeof child.size === "string" && child.size.length > 0
            ? Number.parseInt(child.size, 10)
            : undefined,
        webViewLink: child.webViewLink,
        relativePath,
      };

      if (!isSupportedFile(file)) {
        continue;
      }

      totalSupportedFiles += 1;
      if (!isMyFile(file.id, WORKER_ID, TOTAL_WORKERS)) {
        continue;
      }

      matchedFiles += 1;
      candidateFiles.push(file);
    }

    if (!current.pageToken) {
      queue.shift();
    }

    if (candidateFiles.length > 0) {
      const stateList = await runQuery<FileState[]>("drive:getProcessedFileStates", {
        namespace: target.namespace,
        fileIds: candidateFiles.map((file) => file.id),
      });
      const states = new Map(stateList.map((state) => [state.fileId, state]));
      const filesToProcess = candidateFiles.filter((file) => shouldRetryFile(states.get(file.id)));
      attemptedFiles += filesToProcess.length;

      await mapWithConcurrency(filesToProcess, FILE_CONCURRENCY, async (file) => {
        await processFile(target, file);
      });
    }
  }

  return {
    totalSupportedFiles,
    totalPages,
    matchedFiles,
    attemptedFiles,
  };
}

async function markDatasetStatus(
  target: WorkerTarget,
  totalFiles: number | undefined,
  status: "ingesting" | "ready" | "failed",
  errorMessage?: string
) {
  await runSafeMutation("drive:ensureDriveDataset", {
    folderId: target.folderId,
    totalFiles,
    status,
    errorMessage,
  });
}

async function main() {
  console.log(
    `[worker ${WORKER_LABEL}] starting distributed Drive ingestion worker batchSize=${BATCH_SIZE} fileConcurrency=${FILE_CONCURRENCY} uploadConcurrency=${UPLOAD_CONCURRENCY} listPageSize=${DRIVE_LIST_PAGE_SIZE} pollIntervalMs=${POLL_INTERVAL_MS} ocrMaxMb=${OCR_MAX_MB} ocrWorkers=${ocrWorkerCount}`
  );

  while (!shuttingDown) {
    try {
      const target = await resolveTarget();
      if (!target) {
        console.log(
          `[worker ${WORKER_LABEL}] waiting for DRIVE_FOLDER_ID and GOOGLE_SERVICE_ACCOUNT_JSON`
        );
        await sleep(getNextPollDelayMs());
        continue;
      }

      const scanSummary = await scanDriveFiles(target);
      await markDatasetStatus(target, scanSummary.totalSupportedFiles, "ingesting");

      const progress = await runQuery<{
        namespace: string;
        totalFiles: number;
        completedFiles: number;
        processingFiles: number;
        failedFiles: number;
        retryableFailedFiles: number;
        terminalFailedFiles: number;
        remainingFiles: number;
      }>("drive:getDriveIngestionProgress", {
        namespace: target.namespace,
      });

      if (progress.processingFiles === 0 && progress.remainingFiles === 0) {
        await markDatasetStatus(target, scanSummary.totalSupportedFiles, "ready");
      }

      console.log(
        `[worker ${WORKER_LABEL}] scan complete files=${scanSummary.totalSupportedFiles} matched=${scanSummary.matchedFiles} attempted=${scanSummary.attemptedFiles} pages=${scanSummary.totalPages} remaining=${progress.remainingFiles} failed=${progress.failedFiles}`
      );
    } catch (error) {
      const message = formatError(error);
      console.error(`[worker ${WORKER_LABEL}] loop failure: ${message}`);
      await recordFailure("loop", message);

      const target = await resolveTarget().catch(() => null);
      if (target) {
        await markDatasetStatus(target, undefined, "failed", message).catch((datasetError) => {
          console.error(
            `[worker ${WORKER_LABEL}] failed to record dataset error: ${formatError(datasetError)}`
          );
        });
      }
    }

    if (shuttingDown) {
      break;
    }

    await sleep(getNextPollDelayMs());
  }

  await terminateOcrScheduler();
  console.log(`[worker ${WORKER_LABEL}] stopped`);
}

async function handleFatalError(kind: string, error: unknown) {
  const message = formatError(error);
  console.error(`[worker ${WORKER_LABEL}] ${kind}: ${message}`);
  await notify(`Worker ${WORKER_LABEL} crashed with ${kind}: ${message}`);
  await terminateOcrScheduler();
}

process.on("SIGTERM", () => {
  shuttingDown = true;
  console.log(`[worker ${WORKER_LABEL}] received SIGTERM`);
});

process.on("SIGINT", () => {
  shuttingDown = true;
  console.log(`[worker ${WORKER_LABEL}] received SIGINT`);
});

process.on("unhandledRejection", (error) => {
  console.error(`[worker ${WORKER_LABEL}] unhandled rejection: ${formatError(error)}`);
});

process.on("uncaughtException", (error) => {
  shuttingDown = true;
  void handleFatalError("uncaught exception", error).finally(() => {
    process.exit(1);
  });
});

main().catch((error) => {
  shuttingDown = true;
  void handleFatalError("fatal startup failure", error).finally(() => {
    process.exit(1);
  });
});
