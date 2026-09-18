// Stage 5-6: Vector Storage + Retrieval
// Vectra is a small file-based vector database (pure TypeScript, no server).
// Each uploaded document gets its own index folder under data/indexes/<docId>.
import fs from "node:fs/promises";
import path from "node:path";
import { Document } from "@langchain/core/documents";
import { LocalIndex } from "vectra";
import { config } from "./config";
import { getEmbeddings } from "./embeddings";

export type DocInfo = {
  id: string;
  filename: string;
  pages: number;
  chunks: number;
  characters: number;
  indexedAt: string;
};

type ChunkMeta = { text: string; source: string; page: number; chunk: number };

const indexesDir = () => path.join(config.dataDir, "indexes");
const registryPath = () => path.join(config.dataDir, "documents.json");

export function docIdFor(filename: string): string {
  return filename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

async function openIndex(docId: string) {
  await fs.mkdir(indexesDir(), { recursive: true });
  return new LocalIndex<ChunkMeta>(path.join(indexesDir(), docId));
}

// ---- Stage 5: embed every chunk and store the vectors -------------------
export async function buildVectorStore(docId: string, chunks: Document[]): Promise<void> {
  const index = await openIndex(docId);
  if (await index.isIndexCreated()) await index.deleteIndex(); // re-upload replaces old chunks
  await index.createIndex();

  // One batched call to the embedding API for all chunks.
  const vectors = await getEmbeddings().embedDocuments(chunks.map((c) => c.pageContent));

  await index.beginUpdate();
  for (let i = 0; i < chunks.length; i++) {
    await index.insertItem({
      vector: vectors[i],
      metadata: {
        text: chunks[i].pageContent,
        source: String(chunks[i].metadata.source ?? ""),
        page: Number(chunks[i].metadata.page ?? 0),
        chunk: i + 1,
      },
    });
  }
  await index.endUpdate();
}

// ---- Stage 6: embed the question and find the most similar chunks -------
export type RetrievedChunk = { text: string; page: number; chunk: number; score: number };

export async function retrieve(docId: string, question: string, k = config.topK): Promise<RetrievedChunk[]> {
  const index = await openIndex(docId);
  if (!(await index.isIndexCreated())) throw new Error(`No index found for document "${docId}"`);

  const queryVector = await getEmbeddings().embedQuery(question);
  const results = await index.queryItems(queryVector, question, k);
  // k is an upper bound, not a quota: anything that scores too low is dropped rather
  // than padding the prompt with text that does not answer the question.
  return results
    .map((r) => ({
      text: r.item.metadata.text,
      page: r.item.metadata.page,
      chunk: r.item.metadata.chunk,
      score: r.score,
    }))
    .filter((c) => c.score >= config.minScore);
}

// ---- Tiny registry of what has been indexed ------------------------------
export async function listDocuments(): Promise<DocInfo[]> {
  try {
    return JSON.parse(await fs.readFile(registryPath(), "utf-8")) as DocInfo[];
  } catch {
    return [];
  }
}

export async function registerDocument(info: DocInfo): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const docs = (await listDocuments()).filter((d) => d.id !== info.id);
  docs.unshift(info);
  await fs.writeFile(registryPath(), JSON.stringify(docs, null, 2));
}
