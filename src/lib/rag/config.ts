// Central place for every tunable knob. Override any of these in .env.local.
import path from "node:path";

export const config = {
  llmModel: process.env.LLM_MODEL ?? "gemini-3.1-flash-lite",
  // Low temperature keeps answers grounded in the retrieved context (0-2, Gemini default ~1).
  temperature: Number(process.env.TEMPERATURE ?? 0.1),
  embeddingModel: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001",
  chunkSize: Number(process.env.CHUNK_SIZE ?? 500),
  chunkOverlap: Number(process.env.CHUNK_OVERLAP ?? 80),
  topK: Number(process.env.TOP_K ?? 3),
  // Drop retrieved chunks below this cosine score. 0 keeps everything the top-k search
  // returned; raise it (try 0.4-0.6) to let weak matches fall away instead of
  // padding the prompt. Scores are shown per chunk in the UI, so tune by observation.
  minScore: Number(process.env.MIN_SCORE ?? 0),
  // Where vectors + document registry are persisted on disk.
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? "data"),
};
