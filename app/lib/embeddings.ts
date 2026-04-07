import { embedLocalText, embedLocalTexts } from "../../shared/localEmbeddings";

export async function generateEmbedding(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT"
): Promise<number[]> {
  void taskType;
  return embedLocalText(text);
}

export async function generateEmbeddingsBatch(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  void taskType;
  return embedLocalTexts(texts);
}
