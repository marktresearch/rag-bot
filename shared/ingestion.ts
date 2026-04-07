export const EMBEDDING_DIMENSION = 768;
export const DEFAULT_CHUNK_SIZE_TOKENS = 100;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 5;
export const MIN_PRECHUNKED_TOKENS = 20;
export const MIN_DOCUMENT_TOKENS = 20;
export const MIN_DOCUMENT_CHARS = 100;
export const DEFAULT_MAX_SOURCE_BYTES = 1_000_000_000;
export const DEFAULT_MAX_DOCUMENTS = 50_000;
export const DEFAULT_MAX_CHUNKS = 6000;
export const DEFAULT_INGEST_BATCH_SIZE = 16;
export const DEFAULT_MATCH_LIMIT = 10;

export type JsonMetadata = Record<string, unknown>;

export type PreparedChunk = {
  text: string;
  order: number;
};

export type PreparedIngestItem = {
  metadata?: JsonMetadata;
  chunks: PreparedChunk[];
  sourceBytes: number;
  tokenCount: number;
};

export function approximateBytes(text: string) {
  return new TextEncoder().encode(text).length;
}

export function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function tokenize(text: string) {
  return text.match(/\S+/g) ?? [];
}

export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE_TOKENS,
  overlap = DEFAULT_CHUNK_OVERLAP_TOKENS
) {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return [];
  }

  if (tokens.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < tokens.length) {
    const end = Math.min(tokens.length, start + chunkSize);
    const chunk = tokens.slice(start, end).join(" ").trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= tokens.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

export function prepareIngestItem(args: {
  text: string;
  metadata?: JsonMetadata;
  chunkSize?: number;
  overlap?: number;
}): PreparedIngestItem | null {
  const text = normalizeText(args.text);
  if (text.length < MIN_DOCUMENT_CHARS) {
    return null;
  }

  const tokenCount = tokenize(text).length;
  if (tokenCount < MIN_DOCUMENT_TOKENS) {
    return null;
  }

  const chunkTexts = chunkText(
    text,
    args.chunkSize ?? DEFAULT_CHUNK_SIZE_TOKENS,
    args.overlap ?? DEFAULT_CHUNK_OVERLAP_TOKENS
  );

  if (chunkTexts.length === 0) {
    return null;
  }

  return {
    metadata: args.metadata,
    chunks: chunkTexts.map((chunkTextValue, index) => ({
      text: chunkTextValue,
      order: index,
    })),
    sourceBytes: approximateBytes(text),
    tokenCount,
  };
}

export function preparePreChunkedItem(args: {
  metadata?: JsonMetadata;
  chunks: Array<{
    text: string;
    order?: number;
  }>;
}): PreparedIngestItem | null {
  const normalizedChunks = [...args.chunks]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((chunk, index) => {
      const text = normalizeText(chunk.text);
      const tokenCount = tokenize(text).length;
      return {
        text,
        order: index,
        tokenCount,
      };
    })
    .filter(
      (chunk) =>
        chunk.text.length >= MIN_DOCUMENT_CHARS / 4 &&
        chunk.tokenCount >= MIN_PRECHUNKED_TOKENS
    )
    .map(({ text, order }) => ({
      text,
      order,
    }));

  if (normalizedChunks.length === 0) {
    return null;
  }

  const sourceBytes = normalizedChunks.reduce(
    (total, chunk) => total + approximateBytes(chunk.text),
    0
  );
  const tokenCount = normalizedChunks.reduce(
    (total, chunk) => total + tokenize(chunk.text).length,
    0
  );

  return {
    metadata: args.metadata,
    chunks: normalizedChunks,
    sourceBytes,
    tokenCount,
  };
}
