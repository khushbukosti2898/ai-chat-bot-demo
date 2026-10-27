// Stage 5: Vector Storage
// Vectra is a small file-based vector database (pure TypeScript, no server).
// Each document gets its own folder under data/indexes/<docId>: the Vectra index plus a
// chunks.json copy of every chunk (used by keyword search and section filters).
import fs from "node:fs/promises";
import path from "node:path";
import { LocalIndex } from "vectra";
import type { Chunk } from "./chunk";
import { config } from "./config";
import { embedQuery, embedTexts } from "./embeddings";
import type { Profile } from "./profiles";

export type DocInfo = {
  id: string;
  filename: string;
  profile: Profile;
  pages: number;
  chunks: number;
  characters: number;
  indexedAt: string;
};

type ChunkMeta = { id: number };

const indexesDir = () => path.join(config.dataDir, "indexes");
const registryPath = () => path.join(config.dataDir, "documents.json");
const chunksPath = (docId: string) => path.join(indexesDir(), docId, "chunks.json");

export function docIdFor(filename: string): string {
  return filename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

async function openIndex(docId: string) {
  await fs.mkdir(indexesDir(), { recursive: true });
  return new LocalIndex<ChunkMeta>(path.join(indexesDir(), docId));
}

// Embed every chunk and store the vectors. Embedding runs first, so a quota failure
// leaves the previous index untouched.
export async function buildVectorStore(
  docId: string,
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const vectors = await embedTexts(chunks.map((c) => c.embedText), "document", onProgress);

  const index = await openIndex(docId);
  if (await index.isIndexCreated()) await index.deleteIndex(); // re-upload replaces old chunks
  await index.createIndex();
  await index.beginUpdate();
  for (let i = 0; i < chunks.length; i++) {
    await index.insertItem({ vector: vectors[i], metadata: { id: chunks[i].id } });
  }
  await index.endUpdate();
  await fs.writeFile(chunksPath(docId), JSON.stringify(chunks));
}

export async function loadChunks(docId: string): Promise<Chunk[]> {
  try {
    return JSON.parse(await fs.readFile(chunksPath(docId), "utf-8")) as Chunk[];
  } catch {
    throw new Error(`No index found for document "${docId}". Ingest it first.`);
  }
}

// Cosine-similarity search. Returns chunk ids with scores, best first.
export async function vectorSearch(docId: string, question: string, k: number, ids?: Set<number>) {
  const index = await openIndex(docId);
  if (!(await index.isIndexCreated())) throw new Error(`No index found for document "${docId}"`);
  const filter = ids ? { id: { $in: [...ids] } } : undefined;
  const results = await index.queryItems(await embedQuery(question), question, k, filter);
  return results.map((r) => ({ id: r.item.metadata.id, score: r.score }));
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
