// Central place for every tunable knob. Override any of these in .env.local.
import path from "node:path";

export const config = {
  llmModel: process.env.LLM_MODEL ?? "gemini-3.1-flash-lite",
  // Model that reads PDF pages visually (charts, tables, icons) for the "visual" profile.
  visionModel: process.env.VISION_MODEL ?? process.env.LLM_MODEL ?? "gemini-3.1-flash-lite",
  // Low temperature keeps answers grounded in the retrieved context (0-2, Gemini default ~1).
  temperature: Number(process.env.TEMPERATURE ?? 0.1),
  embeddingModel: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001",
  // Gemini free tier allows 100 embeddings/min, ~30k tokens/min and 1000/day. We stay under the per-minute
  // cap and cache every vector on disk so re-ingesting costs nothing.
  embedPerMinute: Number(process.env.EMBED_PER_MINUTE ?? 90),
  // The free tier also caps tokens per minute (~30k). ~4 chars per token, with headroom.
  embedCharsPerMinute: Number(process.env.EMBED_CHARS_PER_MINUTE ?? 70_000),
  // Final number of chunks sent to the LLM (after reranking).
  topK: Number(process.env.TOP_K ?? 6),
  // Candidates pulled from vector + keyword search before reranking.
  candidateK: Number(process.env.CANDIDATE_K ?? 20),
  // LLM reranking of the candidates. Set RERANK=false to use the hybrid order as-is.
  rerank: (process.env.RERANK ?? "true") !== "false",
  // Rerank scores are 0-10; candidates below this are dropped instead of padding the prompt.
  minRerankScore: Number(process.env.MIN_RERANK_SCORE ?? 3),
  // Where vectors, chunks, parse cache and the document registry are persisted on disk.
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? "data"),
};
