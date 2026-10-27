// Stage 4: Embeddings
// The model that turns a piece of text into a vector of numbers capturing its meaning.
// Texts with similar meaning end up with vectors that are close together.
//
// Gemini embeddings are asymmetric: documents and queries are embedded with different task
// types, which improves question -> passage matching. Every vector is cached on disk keyed by
// (model, task, text), so re-ingesting after a chunking tweak only pays for chunks that changed.
// The free tier allows 100 embeddings/min, ~30k tokens/min and 1000/day, so uncached work is
// sent in batches throttled on both count and size. LangChain reports a rate-limited batch as empty vectors instead of an error, so we
// check for that and fail loudly rather than storing empty vectors.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { config } from "./config";

type Task = "document" | "query";
type TaskType = NonNullable<NonNullable<ConstructorParameters<typeof GoogleGenerativeAIEmbeddings>[0]>["taskType"]>;

const models = new Map<Task, GoogleGenerativeAIEmbeddings>();

function getModel(task: Task): GoogleGenerativeAIEmbeddings {
  let model = models.get(task);
  if (!model) {
    model = new GoogleGenerativeAIEmbeddings({
      model: config.embeddingModel,
      taskType: (task === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY") as TaskType,
    });
    models.set(task, model);
  }
  return model;
}

const cacheDir = () => path.join(config.dataDir, "embed-cache");
const cacheKey = (task: Task, text: string) =>
  crypto.createHash("sha1").update(`${config.embeddingModel}\n${task}\n${text}`).digest("hex");

async function readCache(key: string): Promise<number[] | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(cacheDir(), `${key}.json`), "utf-8")) as number[];
  } catch {
    return null;
  }
}

async function writeCache(key: string, vector: number[]): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.writeFile(path.join(cacheDir(), `${key}.json`), JSON.stringify(vector));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sliding one-minute window shared by every call in this process, so back-to-back
// documents (or ingest + queries) can't burst past the per-minute quota together.
const sent: { at: number; chars: number }[] = [];

async function waitForQuota(texts: string[]): Promise<void> {
  const chars = texts.reduce((n, t) => n + t.length, 0);
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0].at > 61_000) sent.shift();
    const usedChars = sent.reduce((n, s) => n + s.chars, 0);
    if (sent.length === 0 || (sent.length + texts.length <= config.embedPerMinute && usedChars + chars <= config.embedCharsPerMinute)) break;
    await sleep(61_000 - (now - sent[0].at) + 100);
  }
  const now = Date.now();
  texts.forEach((t) => sent.push({ at: now, chars: t.length }));
}

// Split work into batches that each fit inside one minute's quota on their own.
function batches(indexes: number[], texts: string[]): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  for (const i of indexes) {
    if (current.length && (current.length >= config.embedPerMinute || chars + texts[i].length > config.embedCharsPerMinute)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(i);
    chars += texts[i].length;
  }
  if (current.length) out.push(current);
  return out;
}

const isEmpty = (result: number[][]) => result.some((v) => !v || v.length === 0);

async function embedBatch(texts: string[], task: Task): Promise<number[][]> {
  await waitForQuota(texts);
  const result = await getModel(task).embedDocuments(texts);
  if (!isEmpty(result)) return result;
  // Possibly a burst from another process: wait a full minute and try once more.
  await sleep(61_000);
  return getModel(task).embedDocuments(texts);
}

export async function embedTexts(
  texts: string[],
  task: Task,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const keys = texts.map((t) => cacheKey(task, t));
  const vectors = await Promise.all(keys.map(readCache));
  const missing = vectors.flatMap((v, i) => (v ? [] : [i]));

  let done = 0;
  for (const batch of batches(missing, texts)) {
    const result = await embedBatch(batch.map((i) => texts[i]), task);
    if (isEmpty(result)) {
      throw new Error(
        `Embedding API returned empty vectors (${done} of ${missing.length} new chunks embedded so far). ` +
          "This usually means the Gemini free-tier quota (100/min, 1000/day) is exhausted. " +
          "Already-embedded chunks are cached, so re-run later to continue.",
      );
    }
    await Promise.all(batch.map((i, j) => writeCache(keys[i], result[j])));
    batch.forEach((i, j) => (vectors[i] = result[j]));
    done += batch.length;
    onProgress?.(done, missing.length);
  }
  return vectors as number[][];
}

export async function embedQuery(text: string): Promise<number[]> {
  return (await embedTexts([text], "query"))[0];
}
