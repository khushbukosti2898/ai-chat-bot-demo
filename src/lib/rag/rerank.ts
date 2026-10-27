// Stage 7: Reranking
// Vector + keyword search are fast but shallow: they return chunks that *look* related.
// A reranker reads the question and each candidate together and judges whether the chunk
// actually answers it. Here Gemini scores ~20 candidates in a single call, which is what
// separates "East Asia growth forecast" from "South Asia growth forecast" when both match.
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { Chunk } from "./chunk";
import { config } from "./config";
import { getText } from "./text";

const RERANK_PROMPT = `Rate how useful each passage is for answering the question, from 0 to 10.
10 = contains the exact facts needed. 5 = related background. 0 = unrelated, or about a different
region, chapter, product or year than the question asks about.

Question: {question}

Passages:
{passages}

Return ONLY a JSON array like [{"id": 3, "score": 8}], one entry per passage.`;

export type Scored = { chunk: Chunk; score: number };

export async function rerank(question: string, candidates: Chunk[]): Promise<Scored[] | null> {
  if (candidates.length === 0) return [];
  const passages = candidates
    .map((c) => `[id ${c.id}] (page ${c.page}${c.section ? `, ${c.section}` : ""}, ${c.kind})\n${c.text.slice(0, 900)}`)
    .join("\n\n");

  try {
    const llm = new ChatGoogleGenerativeAI({ model: config.llmModel, temperature: 0 });
    const response = await llm.invoke(RERANK_PROMPT.replace("{question}", question).replace("{passages}", passages));
    const text = getText(response.content);
    const scores = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { id: number; score: number }[];
    const byId = new Map(scores.map((s) => [Number(s.id), Number(s.score)]));
    return candidates
      .map((chunk) => ({ chunk, score: byId.get(chunk.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return null; // caller falls back to the hybrid-search order
  }
}
