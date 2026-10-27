// npm run eval  -> run every question in eval/questions.json and score it.
//   retrieval hit : at least one retrieved chunk comes from a page where the answer is printed
//   answer pass   : every "mustInclude" pattern appears in the answer (or, for questions that
//                   are not answerable from the document, the bot refuses)
// Results are saved to eval/results/<timestamp>.json so runs can be compared over time.
import fs from "node:fs/promises";
import path from "node:path";
import { answerQuestion, NOT_FOUND } from "../src/lib/rag/llm";
import { docIdFor } from "../src/lib/rag/vectorstore";

type Case = { doc: string; question: string; mustInclude?: string[]; pages?: number[]; expectRefusal?: boolean };

async function main() {
  const filter = process.argv[2]?.toLowerCase();
  const cases = (JSON.parse(await fs.readFile("eval/questions.json", "utf-8")) as Case[]).filter(
    (c) => !filter || c.doc.toLowerCase().includes(filter),
  );

  const results = [];
  for (const c of cases) {
    const { answer, chunks, scope } = await answerQuestion(docIdFor(c.doc), c.question, []);
    const refused = answer.includes(NOT_FOUND);
    const missing = (c.mustInclude ?? []).filter((p) => !new RegExp(p, "i").test(answer));
    const pass = c.expectRefusal ? refused : !refused && missing.length === 0;
    const retrievalHit = c.pages ? chunks.some((ch) => c.pages!.some((p) => p >= ch.page && p <= ch.pageEnd)) : null;

    console.log(`${pass ? "PASS" : "FAIL"}  [${c.doc}] ${c.question}`);
    if (retrievalHit !== null) console.log(`      retrieval ${retrievalHit ? "hit" : "MISS"} · pages ${chunks.map((ch) => ch.page).join(", ")}${scope ? ` · scope: ${scope}` : ""}`);
    if (missing.length) console.log(`      missing: ${missing.join(", ")}`);
    console.log(`      ${answer.replace(/\s+/g, " ").slice(0, 300)}\n`);
    results.push({ ...c, pass, retrievalHit, missing, scope, answer, retrievedPages: chunks.map((ch) => ch.page) });
  }

  const passed = results.filter((r) => r.pass).length;
  const withPages = results.filter((r) => r.retrievalHit !== null);
  console.log(`Answers: ${passed}/${results.length} passed`);
  console.log(`Retrieval: ${withPages.filter((r) => r.retrievalHit).length}/${withPages.length} hit the expected page`);

  const out = path.join("eval", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(results, null, 2));
  console.log(`Saved ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
