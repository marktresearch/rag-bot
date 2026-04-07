import { RAG } from "@convex-dev/rag";
import { components } from "./_generated/api";
import { EMBEDDING_DIMENSION } from "../shared/ingestion";
import { getRagEmbeddingModel } from "./embeddings";

export const rag = new RAG(components.rag, {
  textEmbeddingModel: getRagEmbeddingModel(),
  embeddingDimension: EMBEDDING_DIMENSION,
});
