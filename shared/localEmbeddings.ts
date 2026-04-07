import { EMBEDDING_DIMENSION } from "./ingestion";
import { buildSearchFeatureWeights } from "./retrieval";

export const LOCAL_EMBEDDING_MODEL_ID = "local-hash-embedding-003";

const HOT_CACHE_LIMIT = 256;
const hotEmbeddingCache = new Map<string, number[]>();

function hashToken(token: string, seed: number) {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalize(values: number[]) {
  let sumSquares = 0;
  for (const value of values) {
    sumSquares += value * value;
  }

  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

function normalizeCacheText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function buildCacheKey(text: string) {
  return `${LOCAL_EMBEDDING_MODEL_ID}:${normalizeCacheText(text).toLowerCase()}`;
}

function rememberHotEmbedding(cacheKey: string, embedding: number[]) {
  if (hotEmbeddingCache.has(cacheKey)) {
    hotEmbeddingCache.delete(cacheKey);
  }
  hotEmbeddingCache.set(cacheKey, embedding);

  if (hotEmbeddingCache.size <= HOT_CACHE_LIMIT) {
    return;
  }

  const firstKey = hotEmbeddingCache.keys().next().value;
  if (firstKey) {
    hotEmbeddingCache.delete(firstKey);
  }
}

function generateLocalEmbedding(text: string) {
  const vector = new Array(EMBEDDING_DIMENSION).fill(0);
  const { weights } = buildSearchFeatureWeights(text);

  if (weights.size === 0) {
    return vector;
  }

  for (const [feature, weight] of weights) {
    const primaryIndex = hashToken(feature, 0) % EMBEDDING_DIMENSION;
    const secondaryIndex = hashToken(feature, 1) % EMBEDDING_DIMENSION;
    const tertiaryIndex = hashToken(feature, 2) % EMBEDDING_DIMENSION;
    const primarySign = hashToken(feature, 3) % 2 === 0 ? 1 : -1;
    const secondarySign = hashToken(feature, 4) % 2 === 0 ? 1 : -1;
    const tertiarySign = hashToken(feature, 5) % 2 === 0 ? 1 : -1;

    vector[primaryIndex] += primarySign * weight;
    vector[secondaryIndex] += secondarySign * weight * 0.7;
    vector[tertiaryIndex] += tertiarySign * weight * 0.45;
  }

  return normalize(vector);
}

export function embedLocalTexts(texts: string[]) {
  return texts.map((rawText) => {
    const text = normalizeCacheText(rawText);
    if (!text) {
      return new Array(EMBEDDING_DIMENSION).fill(0);
    }

    const cacheKey = buildCacheKey(text);
    const cached = hotEmbeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const embedding = generateLocalEmbedding(text);
    rememberHotEmbedding(cacheKey, embedding);
    return embedding;
  });
}

export function embedLocalText(text: string) {
  const [embedding] = embedLocalTexts([text]);
  return embedding ?? new Array(EMBEDDING_DIMENSION).fill(0);
}
