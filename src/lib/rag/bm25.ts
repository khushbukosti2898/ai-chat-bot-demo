// Keyword search (BM25). Vectors are good at meaning but fuzzy on exact tokens: a question
// about "FDsys", "FY 2018" or "ENERGY STAR" should rank the chunk containing those exact
// words first. BM25 scores a chunk by how often it contains the query's rare words.
import { tokenize } from "./text";

const K1 = 1.2;
const B = 0.75;

export function bm25Rank(docs: { id: number; text: string }[], query: string): { id: number; score: number }[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || docs.length === 0) return [];

  const tokenized = docs.map((d) => tokenize(d.text));
  const avgLen = tokenized.reduce((n, t) => n + t.length, 0) / docs.length;
  const docFreq = new Map<string, number>();
  for (const tokens of tokenized) for (const t of new Set(tokens)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);

  return docs
    .map((doc, i) => {
      const tokens = tokenized[i];
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of terms) {
        const f = tf.get(term);
        if (!f) continue;
        const df = docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * tokens.length) / avgLen)));
      }
      return { id: doc.id, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
