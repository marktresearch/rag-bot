import type {
  EmbeddingModelV3,
  EmbeddingModelV3Result,
} from "@ai-sdk/provider";
import {
  LOCAL_EMBEDDING_MODEL_ID,
  embedLocalText,
  embedLocalTexts,
} from "../shared/localEmbeddings";

export const EMBEDDING_MODEL_ID = LOCAL_EMBEDDING_MODEL_ID;

export async function embedTexts(texts: string[]) {
  return embedLocalTexts(texts);
}

export async function embedText(text: string) {
  return embedLocalText(text);
}

export function getRagEmbeddingModel(): EmbeddingModelV3 {
  return {
    specificationVersion: "v3",
    provider: "local-hash",
    modelId: LOCAL_EMBEDDING_MODEL_ID,
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    async doEmbed({ values }) {
      const embeddings = await embedTexts(values);
      return {
        embeddings,
        warnings: [],
      } satisfies EmbeddingModelV3Result;
    },
  };
}
