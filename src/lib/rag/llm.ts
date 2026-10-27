// Stage 8-9: Context + LLM Response
// The reranked chunks become numbered sources ([S1], [S2] ...) labelled with page, section and
// element type, so the model can tell a table from a footnote and South Asia from East Asia.
// The rules make the model answer only from those sources, copy numbers exactly, cite them,
// and refuse when the sources don't contain the answer.
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { config } from "./config";
import { retrieve, type RetrievedChunk } from "./retrieve";
import { getText } from "./text";
import { listDocuments } from "./vectorstore";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const NOT_FOUND = "I don't have that information in the document.";

const SYSTEM_PROMPT = `You answer questions about one document using ONLY the SOURCES below.

Rules:
- Use only facts stated in the SOURCES (and facts already established earlier in this conversation).
- Copy numbers, units, percentages and dates exactly as written in the sources. Never round or convert.
- If the question is about a specific chapter, section, region, product or year, use only sources
  labelled with that chapter/section, and never mix in figures from a different one.
- Facts may come from tables, charts, callouts or footnotes: use them, and mention a footnote's
  caveat when it limits the claim.
- Cite every fact with its source tag, e.g. [S2]. Mention the page number.
- If the sources do not contain the answer, reply exactly: "${NOT_FOUND}"
- Do not use outside knowledge and do not guess. Keep answers concise.
{scope}
SOURCES:
{context}`;

function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const pages = c.pageEnd > c.page ? `pages ${c.page}-${c.pageEnd}` : `page ${c.page}`;
      const where = [pages, c.section, c.kind !== "text" ? c.kind : ""].filter(Boolean).join(" | ");
      return `[S${i + 1}] (${where})\n${c.text}`;
    })
    .join("\n\n");
}

export async function answerQuestion(
  docId: string,
  question: string,
  history: ChatTurn[],
  k = config.topK,
): Promise<{ answer: string; chunks: RetrievedChunk[]; scope: string | null }> {
  const doc = (await listDocuments()).find((d) => d.id === docId);
  const { chunks, scope } = await retrieve(docId, doc?.profile ?? "narrative", question, k);

  // Nothing relevant survived reranking: refuse without asking the model to improvise.
  if (chunks.length === 0) return { answer: NOT_FOUND, chunks, scope };

  const system = SYSTEM_PROMPT.replace("{scope}", scope ? `\nThe question was matched to the section: ${scope}.\n` : "").replace(
    "{context}",
    formatContext(chunks),
  );
  const messages = [
    new SystemMessage(system),
    ...history.map((t) => (t.role === "user" ? new HumanMessage(t.content) : new AIMessage(t.content))),
    new HumanMessage(question),
  ];

  const llm = new ChatGoogleGenerativeAI({
    model: config.llmModel,
    temperature: config.temperature,
  });
  const response = await llm.invoke(messages);
  return { answer: getText(response.content), chunks, scope };
}
