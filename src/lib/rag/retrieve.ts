// Stage 6: Retrieval (+ Stage 7: Reranking)
//   1. Scope   - if the question names a chapter ("Chapter 3") or a section title ("South Asia",
//                "executive summary"), search only inside it. This is what stops region A's
//                numbers from answering a question about region B.
//   2. Hybrid  - vector search (meaning) and BM25 (exact words/numbers) run side by side and
//                are merged with Reciprocal Rank Fusion, which needs no score calibration.
//   3. Rerank  - Gemini scores the merged candidates; weak ones are dropped.
import { bm25Rank } from "./bm25";
import type { Chunk } from "./chunk";
import { config } from "./config";
import type { Profile } from "./profiles";
import { rerank } from "./rerank";
import { loadChunks, vectorSearch } from "./vectorstore";

export type RetrievedChunk = Chunk & { score: number };
export type Retrieval = { chunks: RetrievedChunk[]; scope: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findScope(question: string, chunks: Chunk[]): { label: string; ids: Set<number> } | null {
  const q = ` ${norm(question)} `;
  let matched = chunks;
  const labels: string[] = [];

  const chapterNo = question.match(/\bchapter\s+(\d+)\b/i)?.[1];
  if (chapterNo) {
    const re = new RegExp(`^(ch\\.?|chapter)\\s*${chapterNo}\\b`, "i");
    const inChapter = matched.filter((c) => re.test(c.chapter));
    if (inChapter.length) {
      matched = inChapter;
      labels.push(inChapter[0].chapter);
    }
  }

  // Longest section title that appears verbatim in the question wins ("South Asia" over "Asia").
  const titles = [...new Set(chunks.flatMap((c) => c.section.split(" > ")))]
    .map((t) => ({ t, n: norm(t.replace(/^(ch\.?|chapter)\s*\d+\s*/i, "")) }))
    .filter((x) => x.n.length >= 6 && q.includes(` ${x.n} `))
    .sort((a, b) => b.n.length - a.n.length);
  if (titles.length) {
    const inSection = matched.filter((c) => c.section.split(" > ").includes(titles[0].t));
    if (inSection.length) {
      matched = inSection;
      labels.push(titles[0].t);
    }
  }

  return labels.length ? { label: labels.join(" / "), ids: new Set(matched.map((c) => c.id)) } : null;
}

export async function retrieve(docId: string, profile: Profile, question: string, k = config.topK): Promise<Retrieval> {
  const all = await loadChunks(docId);
  const byId = new Map(all.map((c) => [c.id, c]));
  const scope = profile === "structured" ? findScope(question, all) : null;
  const pool = scope ? all.filter((c) => scope.ids.has(c.id)) : all;

  const n = config.candidateK;
  const [vector, keyword] = await Promise.all([
    vectorSearch(docId, question, n, scope?.ids),
    Promise.resolve(bm25Rank(pool.map((c) => ({ id: c.id, text: c.embedText })), question).slice(0, n)),
  ]);

  // Reciprocal Rank Fusion: score = sum over lists of 1 / (60 + rank).
  const fused = new Map<number, number>();
  for (const list of [vector, keyword]) {
    list.forEach((r, rank) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (60 + rank + 1)));
  }
  // The opening of a scoped section is usually its summary, which broad questions
  // ("What does Chapter 3 say about...") need even when no single sentence matches well.
  if (scope && !fused.has(pool[0].id)) fused.set(pool[0].id, 0);

  const candidates = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, score]) => ({ ...byId.get(id)!, score }));

  if (!config.rerank) return { chunks: candidates.slice(0, k), scope: scope?.label ?? null };

  const reranked = await rerank(question, candidates);
  const chunks = reranked
    ? reranked.filter((r) => r.score >= config.minRerankScore).slice(0, k).map((r) => ({ ...r.chunk, score: r.score }))
    : candidates.slice(0, k);
  return { chunks, scope: scope?.label ?? null };
}
